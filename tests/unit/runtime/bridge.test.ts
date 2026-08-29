import { describe, expect, it } from 'vitest';

import {
  DEBUGGER_CAPABILITY_NAMES,
  DEBUGGER_COMMAND_CAPABILITY_MAP,
} from '../../../src/runtime/capabilities.js';
import { DebuggerRuntimeBridge, unwrapDebuggerBridgeOutput } from '../../../src/runtime/bridge.js';
import type { InvocationContext } from '../../../src/runtime/contracts.js';
import { deriveDebuggerScope } from '../../../src/runtime/scope.js';
import { FakeRuntimeHost } from '../../helpers/fake-runtime-host.js';

function context(
  executionId: string,
  sessionId = 'marshal-session-1',
  chatId = 'chat-1',
): InvocationContext {
  return {
    principal: { id: 'agent-1', kind: 'agent' },
    executionId,
    scope: { sessionId, chatId },
    metadata: { marshalWorkspaceName: 'workspace-1' },
  };
}

function inputFor(capability: string, sessionId: string): Record<string, unknown> {
  const common = { sessionId };
  switch (capability) {
    case 'debug.breakpoint.set':
      return { ...common, file: 'Q:\\fixture\\app.ts', line: 2 };
    case 'debug.breakpoint.remove':
    case 'debug.breakpoint.enable':
    case 'debug.breakpoint.disable':
      return { ...common, file: 'Q:\\fixture\\app.ts', line: 2 };
    case 'debug.breakpoint.setFunction':
      return { ...common, name: 'main' };
    case 'debug.breakpoint.setException':
      return { ...common, filters: ['all'] };
    case 'debug.breakpoint.setData':
      return { ...common, dataId: 'value' };
    case 'debug.execution.restartFrame':
      return { ...common, frameId: 11 };
    case 'debug.execution.setNextStatement':
      return { ...common, file: 'Q:\\fixture\\app.ts', line: 2 };
    case 'debug.inspect.evaluate':
      return { ...common, expression: 'answer + 1' };
    case 'debug.inspect.variables':
      return { ...common, variablesReference: 1 };
    case 'debug.inspect.callStack':
      return { ...common, threadId: 7 };
    case 'debug.inspect.scopes':
      return { ...common, frameId: 11 };
    case 'debug.watch.manage':
      return { ...common, action: 'list' };
    case 'debug.inspect.exceptionInfo':
      return { ...common, threadId: 7 };
    default:
      return common;
  }
}

describe('DebuggerRuntimeBridge', () => {
  it('declares a one-to-one mapping for all 31 original debugger commands', () => {
    const entries = Object.entries(DEBUGGER_COMMAND_CAPABILITY_MAP);
    expect(entries).toHaveLength(31);
    expect(new Set(entries.map((entry) => entry[1])).size).toBe(31);
    for (const capability of Object.values(DEBUGGER_COMMAND_CAPABILITY_MAP)) {
      expect(DEBUGGER_CAPABILITY_NAMES).toContain(capability);
    }
  });

  it('maps every original debugger command through a scoped execution block', async () => {
    const host = new FakeRuntimeHost();
    const bridge = new DebuggerRuntimeBridge({ host });
    const launched = await bridge.invoke(
      'debug.session.launch',
      { program: 'Q:\\fixture\\app.ts', language: 'typescript' },
      context('block-launch'),
    );
    const launchValue = unwrapDebuggerBridgeOutput<{ sessionId: string }>(launched);
    const debuggerSessionId = launchValue.sessionId;
    expect(
      (launched.output as { executionBlock: { capability: string } }).executionBlock.capability,
    ).toBe('debug.session.launch');

    const attached = await bridge.invoke(
      'debug.session.attach',
      { language: 'typescript', host: '127.0.0.1', port: 9229 },
      context('block-attach'),
    );
    expect(
      (attached.output as { executionBlock: { capability: string } }).executionBlock.capability,
    ).toBe('debug.session.attach');

    let index = 0;
    for (const capability of Object.values(DEBUGGER_COMMAND_CAPABILITY_MAP)) {
      if (
        capability === 'debug.session.launch' ||
        capability === 'debug.session.attach' ||
        capability === 'debug.session.disconnect' ||
        capability === 'debug.session.terminate'
      ) {
        continue;
      }
      const result = await bridge.invoke(
        capability,
        capability === 'debug.session.list' ? {} : inputFor(capability, debuggerSessionId),
        context(`block-${++index}`),
      );
      expect(
        (result.output as { executionBlock: { capability: string } }).executionBlock.capability,
      ).toBe(capability);
    }

    for (const capability of ['debug.session.disconnect', 'debug.session.terminate'] as const) {
      const fresh = await bridge.invoke(
        'debug.session.launch',
        { program: 'Q:\\fixture\\app.ts' },
        context(`block-${capability}-launch`),
      );
      const freshSessionId = unwrapDebuggerBridgeOutput<{ sessionId: string }>(fresh).sessionId;
      const result = await bridge.invoke(
        capability,
        { sessionId: freshSessionId },
        context(`block-${capability}`),
      );
      expect(
        (result.output as { executionBlock: { capability: string } }).executionBlock.capability,
      ).toBe(capability);
    }
  });

  it('isolates sessions across chats and Marshal sessions', async () => {
    const host = new FakeRuntimeHost();
    const bridge = new DebuggerRuntimeBridge({ host });
    const launched = await bridge.invoke(
      'debug.session.launch',
      { program: 'Q:\\fixture\\app.ts' },
      context('launch-a', 'marshal-a', 'chat-a'),
    );
    const { sessionId } = unwrapDebuggerBridgeOutput<{ sessionId: string }>(launched);

    await expect(
      bridge.invoke('debug.session.get', { sessionId }, context('read-b', 'marshal-b', 'chat-b')),
    ).rejects.toMatchObject({ code: 'SCOPE_MISMATCH' });
    await expect(
      bridge.invoke(
        'debug.session.get',
        { sessionId },
        {
          ...context('read-other-workspace', 'marshal-a', 'chat-a'),
          metadata: { marshalWorkspaceName: 'workspace-2' },
        },
      ),
    ).rejects.toMatchObject({ code: 'SCOPE_MISMATCH' });

    const scopeA = deriveDebuggerScope(context('scope-a', 'marshal-a', 'chat-a'));
    const scopeB = deriveDebuggerScope(context('scope-b', 'marshal-b', 'chat-b'));
    expect(bridge.listSessions(scopeA.scopeKey)).toHaveLength(1);
    expect(bridge.listSessions(scopeB.scopeKey)).toHaveLength(0);
  });

  it('rejects unsafe watch expressions before they reach the native host', async () => {
    const host = new FakeRuntimeHost();
    const bridge = new DebuggerRuntimeBridge({ host });
    const launched = await bridge.invoke(
      'debug.session.launch',
      { program: 'Q:\\fixture\\app.ts' },
      context('launch-watch'),
    );
    const { sessionId } = unwrapDebuggerBridgeOutput<{ sessionId: string }>(launched);

    await expect(
      bridge.invoke(
        'debug.watch.manage',
        { sessionId, action: 'add', expression: 'process.exit()' },
        context('unsafe-watch'),
      ),
    ).rejects.toMatchObject({ code: 'EXPRESSION_NOT_SAFE' });
    expect(
      host.invocations.some((invocation) => invocation.capability === 'debug.watch.manage'),
    ).toBe(false);
  });

  it('stops subscriptions and clears scoped state when a session completes', async () => {
    const host = new FakeRuntimeHost();
    const bridge = new DebuggerRuntimeBridge({ host });
    const launched = await bridge.invoke(
      'debug.session.launch',
      { program: 'Q:\\fixture\\app.ts' },
      context('launch'),
    );
    const { sessionId } = unwrapDebuggerBridgeOutput<{ sessionId: string }>(launched);
    await bridge.invoke('debug.session.terminate', { sessionId }, context('terminate'));

    const scope = deriveDebuggerScope(context('scope'));
    expect(bridge.getSession(scope.scopeKey, sessionId)?.completed).toBe(true);
    await expect(
      bridge.invoke(
        'debug.execution.continue',
        { sessionId, threadId: 7 },
        context('continue-after-completion'),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await bridge.disposeScope(scope.scopeKey);
    expect(bridge.listSessions(scope.scopeKey)).toEqual([]);
    expect(host.disposedScopes).toEqual([scope.scopeKey]);
  });
});

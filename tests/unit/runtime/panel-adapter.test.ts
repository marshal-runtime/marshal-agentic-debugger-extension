import { describe, expect, it } from 'vitest';

import { DebuggerRuntimeBridge, unwrapDebuggerBridgeOutput } from '../../../src/runtime/bridge.js';
import { createDebuggerPanelBridgeAdapter } from '../../../src/runtime/panel-adapter.js';
import { deriveDebuggerScope } from '../../../src/runtime/scope.js';
import type { InvocationContext } from '../../../src/runtime/contracts.js';
import { FakeRuntimeHost } from '../../helpers/fake-runtime-host.js';

const launchContext: InvocationContext = {
  principal: { id: 'agent-1', kind: 'agent' },
  executionId: 'launch-block',
  scope: {
    sessionId: 'marshal-session',
    chatId: 'chat-1',
  },
  metadata: { marshalWorkspaceName: 'workspace-1' },
};

describe('Debugger panel bridge adapter', () => {
  it('maps UI execution, breakpoint, watch, and console commands to runtime capabilities', async () => {
    const host = new FakeRuntimeHost();
    const bridge = new DebuggerRuntimeBridge({ host });
    const launch = await bridge.invoke(
      'debug.session.launch',
      { program: 'Q:\\fixture\\app.ts' },
      launchContext,
    );
    const { sessionId } = unwrapDebuggerBridgeOutput<{ sessionId: string }>(launch);
    const runtimeScope = deriveDebuggerScope(launchContext);
    const panelScope = {
      chatId: runtimeScope.chatId,
      sessionId,
      executionBlockId: 'panel-block',
      runtimeSessionId: runtimeScope.sessionId,
      workspaceName: runtimeScope.workspaceName,
      scopeKey: runtimeScope.scopeKey,
    };
    const adapter = createDebuggerPanelBridgeAdapter(bridge, {
      runtimeScope: { ...runtimeScope, executionBlockId: 'panel-block' },
      panelScope,
      debuggerSessionId: sessionId,
    });

    await adapter.getSnapshot(panelScope);
    await adapter.dispatch(panelScope, { type: 'continue', threadId: 7 });
    await adapter.dispatch(panelScope, {
      type: 'set-breakpoint',
      file: 'Q:\\fixture\\app.ts',
      line: 2,
      origin: 'human',
    });
    await adapter.dispatch(panelScope, {
      type: 'add-watch',
      expression: 'answer',
      frameId: 11,
      origin: 'human',
    });
    await adapter.dispatch(panelScope, {
      type: 'evaluate',
      expression: 'answer + 1',
      frameId: 11,
      origin: 'human',
    });

    expect(host.invocations.map((invocation) => invocation.capability)).toEqual(
      expect.arrayContaining([
        'debug.execution.continue',
        'debug.breakpoint.set',
        'debug.watch.manage',
        'debug.inspect.evaluate',
      ]),
    );
  });
});

import { describe, expect, it, vi } from 'vitest';

import { createAgenticDebuggerRuntimeExtension } from '../../src/runtime/activation.js';
import { unwrapDebuggerBridgeOutput } from '../../src/runtime/bridge.js';
import type {
  InvocationContext,
  RuntimeExecuteRequest,
  RuntimeExtensionActivationContext,
} from '../../src/runtime/contracts.js';
import { FakeRuntimeHost } from '../helpers/fake-runtime-host.js';

describe('Marshal debugger extension acceptance fixture', () => {
  it('opens, updates, and focuses the debugger panel and reflects debugger events', async () => {
    const host = new FakeRuntimeHost();
    const executed: string[] = [];
    const activationContext: RuntimeExtensionActivationContext = {
      manifest: {
        schemaVersion: 1,
        identity: '@marshal/agentic-debugger-extension',
        version: '1.0.0',
        entrypoint: 'dist/runtime-extension.cjs',
        moduleFormat: 'commonjs-bundle-v1',
      },
      search: vi.fn(),
      execute: vi.fn().mockImplementation(async (request: RuntimeExecuteRequest) => {
        executed.push(request.target);
        const output =
          request.target === 'ui.application.list'
            ? {
                instances:
                  executed.filter((target) => target === 'ui.application.open').length > 0
                    ? [{ instanceId: 'debugger-panel-1' }]
                    : [],
              }
            : { instance: { instanceId: 'debugger-panel-1' } };
        return {
          protocolVersion: '1.0.0',
          status: 'success',
          result: {
            output: {
              value: output,
            },
          },
          receipt: {},
        };
      }),
    };
    const activation = await createAgenticDebuggerRuntimeExtension({ host }).activate(
      activationContext,
    );
    const provider = activation.capabilityProviders?.[0];
    expect(provider).toBeDefined();
    const invocationContext: InvocationContext = {
      principal: { id: 'agent-1', kind: 'agent' },
      executionId: 'execution-block-1',
      scope: {
        sessionId: 'marshal-session-1',
        chatId: 'chat-1',
      },
      metadata: { marshalWorkspaceName: 'workspace-1' },
    };

    const launched = await provider!.invoke(
      'debug.session.launch',
      { program: 'Q:\\fixture\\app.ts' },
      invocationContext,
    );
    const { sessionId } = unwrapDebuggerBridgeOutput<{ sessionId: string }>(launched);
    expect(executed).toEqual([
      'ui.application.list',
      'ui.application.open',
      'ui.application.update',
      'ui.application.focus',
    ]);

    host.emit(sessionId, {
      state: 'paused',
      statusMessage: 'Paused on breakpoint',
      currentLocation: { file: 'Q:\\fixture\\app.ts', line: 2 },
    });

    const refreshed = await provider!.invoke(
      'debug.session.get',
      { sessionId },
      {
        ...invocationContext,
        executionId: 'execution-block-2',
      },
    );
    const value = unwrapDebuggerBridgeOutput<{
      snapshot: { state: string; currentLocation?: { line: number } };
    }>(refreshed);
    expect(value.snapshot.state).toBe('paused');
    expect(value.snapshot.currentLocation?.line).toBe(2);
    expect(executed.slice(-3)).toEqual([
      'ui.application.list',
      'ui.application.update',
      'ui.application.focus',
    ]);

    await activation.dispose?.();
  });
});

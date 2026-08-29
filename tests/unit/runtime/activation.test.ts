import { describe, expect, it, vi } from 'vitest';

import {
  createAgenticDebuggerRuntimeExtension,
  DEBUGGER_HOST_ADAPTER_SERVICE,
  registerRuntimeDebuggerHostAdapter,
} from '../../../src/runtime/activation.js';
import type {
  DebuggerHostAdapter,
  InvocationContext,
  RuntimeExtensionActivationContext,
  RuntimeServiceAccessor,
  RuntimeServiceToken,
} from '../../../src/runtime/contracts.js';
import { FakeRuntimeHost } from '../../helpers/fake-runtime-host.js';

function activationContext(services?: RuntimeServiceAccessor): RuntimeExtensionActivationContext {
  return {
    manifest: {
      schemaVersion: 1,
      identity: '@marshal/agentic-debugger-extension',
      version: '1.0.0',
      entrypoint: 'dist/runtime-extension.cjs',
      moduleFormat: 'commonjs-bundle-v1',
    },
    ...(services ? { services } : {}),
    search: vi.fn(),
    execute: vi.fn().mockResolvedValue({
      protocolVersion: '1.0.0',
      status: 'success',
      result: { output: { value: { instance: { instanceId: 'debugger-ui-1' } } } },
      receipt: {},
    }),
  };
}

function invocationContext(executionId: string): InvocationContext {
  return {
    principal: { id: 'agent-1', kind: 'agent' },
    executionId,
    scope: { sessionId: 'session-1', chatId: 'chat-1' },
    metadata: { marshalWorkspaceName: 'workspace-1' },
  };
}

function mutableDebuggerServices(initial: DebuggerHostAdapter): {
  readonly services: RuntimeServiceAccessor;
  replace(adapter: DebuggerHostAdapter): void;
} {
  let current = initial;
  const value = <T>(token: RuntimeServiceToken<T>): T | undefined =>
    token === DEBUGGER_HOST_ADAPTER_SERVICE ? (current as T) : undefined;
  return {
    services: {
      get: <T>(token: RuntimeServiceToken<T>) => {
        const service = value(token);
        if (service === undefined) throw new Error('Runtime service is unavailable.');
        return service;
      },
      tryGet: value,
      getAll: <T>(token: RuntimeServiceToken<T>) => {
        const service = value(token);
        return service === undefined ? [] : [service];
      },
    },
    replace(adapter) {
      current = adapter;
    },
  };
}

describe('runtime extension activation', () => {
  it('registers a capability provider and debugger UI application', async () => {
    const host = new FakeRuntimeHost();
    const restore = registerRuntimeDebuggerHostAdapter(host);
    try {
      const activation =
        await createAgenticDebuggerRuntimeExtension().activate(activationContext());
      expect(activation.capabilityProviders).toHaveLength(1);
      expect(activation.uiApplications).toMatchObject([
        {
          id: 'debugger',
          renderId: 'marshal.agentic-debugger.v1',
          application: {
            version: '1.0.0',
            presentationModes: ['inline', 'fullscreen'],
          },
        },
      ]);
      await activation.capabilityProviders?.[0]?.invoke(
        'debug.adapter.list',
        {},
        invocationContext('global-fallback'),
      );
      expect(host.invocations).toHaveLength(1);
      await activation.dispose?.();
    } finally {
      restore();
    }
  });

  it('resolves the injected host at call time without a global registration', async () => {
    const registry = globalThis as typeof globalThis & Record<symbol, unknown>;
    const previous = registry[DEBUGGER_HOST_ADAPTER_SERVICE];
    delete registry[DEBUGGER_HOST_ADAPTER_SERVICE];
    const hostA = new FakeRuntimeHost();
    const hostB = new FakeRuntimeHost();
    const injected = mutableDebuggerServices(hostA);

    try {
      const activation = await createAgenticDebuggerRuntimeExtension().activate(
        activationContext(injected.services),
      );
      const provider = activation.capabilityProviders?.[0];
      expect(provider).toBeDefined();

      await provider!.invoke('debug.adapter.list', {}, invocationContext('execution-a'));
      injected.replace(hostB);
      await provider!.invoke('debug.adapter.list', {}, invocationContext('execution-b'));

      expect(hostA.invocations.map(({ capability }) => capability)).toEqual(['debug.adapter.list']);
      expect(hostB.invocations.map(({ capability }) => capability)).toEqual(['debug.adapter.list']);
      await activation.dispose?.();
    } finally {
      if (previous === undefined) delete registry[DEBUGGER_HOST_ADAPTER_SERVICE];
      else registry[DEBUGGER_HOST_ADAPTER_SERVICE] = previous;
    }
  });

  it('fails closed when activation is already cancelled', async () => {
    const context = { ...activationContext(), signal: { aborted: true } };
    await expect(createAgenticDebuggerRuntimeExtension().activate(context)).rejects.toMatchObject({
      code: 'CANCELLED',
    });
  });

  it('retains ownership of an injected host adapter during extension disposal', async () => {
    const host = new FakeRuntimeHost();
    const dispose = vi.fn().mockResolvedValue(undefined);
    const activation = await createAgenticDebuggerRuntimeExtension({
      host: Object.assign(host, { dispose }),
    }).activate(activationContext());

    await activation.dispose?.();
    expect(dispose).not.toHaveBeenCalled();
  });
});

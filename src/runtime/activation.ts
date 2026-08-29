import { DEBUGGER_PROVIDER_ID } from './capabilities.js';
import { DebuggerRuntimeBridge } from './bridge.js';
import { createDebuggerServiceContribution } from './debugger-service.js';
import type {
  DebuggerHostAdapter,
  RuntimeExtensionActivationContext,
  RuntimeExtensionModule,
  RuntimeServiceAccessor,
  RuntimeServiceToken,
} from './contracts.js';
import { MarshalDebuggerUiCoordinator } from './ui-coordinator.js';
import { createDebuggerUiApplication } from './ui-application.js';

export const DEBUGGER_HOST_ADAPTER_SERVICE = Symbol.for(
  'marshal.agentic-debugger.host-adapter',
) as RuntimeServiceToken<DebuggerHostAdapter>;

/** @deprecated Bind DEBUGGER_HOST_ADAPTER_SERVICE in activationContext.services instead. */
export const DEBUGGER_HOST_ADAPTER_SYMBOL = DEBUGGER_HOST_ADAPTER_SERVICE;

class UnavailableDebuggerHostAdapter implements DebuggerHostAdapter {
  async invoke(): Promise<never> {
    throw Object.assign(
      new Error(
        'No debugger host adapter is available. Bind DEBUGGER_HOST_ADAPTER_SERVICE or pass options.host.',
      ),
      { code: 'WORKER_UNAVAILABLE' },
    );
  }
}

const unavailableHostAdapter = new UnavailableDebuggerHostAdapter();

function globalHostAdapter(): DebuggerHostAdapter | undefined {
  const registry = globalThis as typeof globalThis & {
    readonly [key: symbol]: unknown;
  };
  const value = registry[DEBUGGER_HOST_ADAPTER_SERVICE];
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<DebuggerHostAdapter>;
  return typeof candidate.invoke === 'function' ? (candidate as DebuggerHostAdapter) : undefined;
}

function resolveHostAdapter(services: RuntimeServiceAccessor | undefined): DebuggerHostAdapter {
  return (
    services?.tryGet(DEBUGGER_HOST_ADAPTER_SERVICE) ?? globalHostAdapter() ?? unavailableHostAdapter
  );
}

function callTimeHostAdapter(services: RuntimeServiceAccessor | undefined): DebuggerHostAdapter {
  const adapter: DebuggerHostAdapter = {
    invoke: (invocation) => resolveHostAdapter(services).invoke(invocation),
    readSource: (scope, debuggerSessionId, path) => {
      const host = resolveHostAdapter(services);
      if (!host.readSource) {
        throw Object.assign(new Error('The debugger host does not expose source reads.'), {
          code: 'CAPABILITY_NOT_SUPPORTED',
        });
      }
      return host.readSource(scope, debuggerSessionId, path);
    },
    subscribe: (scope, debuggerSessionId, listener) =>
      resolveHostAdapter(services).subscribe?.(scope, debuggerSessionId, listener) ?? (() => {}),
    disposeScope: (scopeKey) => resolveHostAdapter(services).disposeScope?.(scopeKey),
  };
  return Object.freeze(adapter);
}

/** @deprecated Bind DEBUGGER_HOST_ADAPTER_SERVICE in activationContext.services instead. */
export function registerRuntimeDebuggerHostAdapter(adapter: DebuggerHostAdapter): () => void {
  const registry = globalThis as typeof globalThis & {
    [key: symbol]: unknown;
  };
  const previous = registry[DEBUGGER_HOST_ADAPTER_SERVICE];
  registry[DEBUGGER_HOST_ADAPTER_SERVICE] = adapter;
  return () => {
    if (previous === undefined) {
      delete registry[DEBUGGER_HOST_ADAPTER_SERVICE];
    } else {
      registry[DEBUGGER_HOST_ADAPTER_SERVICE] = previous;
    }
  };
}

export interface AgenticDebuggerRuntimeExtensionOptions {
  readonly host?: DebuggerHostAdapter;
  readonly surface?: 'panel' | 'tab';
}

export function createAgenticDebuggerRuntimeExtension(
  options: AgenticDebuggerRuntimeExtensionOptions = {},
): RuntimeExtensionModule {
  return Object.freeze({
    async activate(context: RuntimeExtensionActivationContext) {
      if (context.signal?.aborted) {
        throw Object.assign(new Error('Debugger extension activation was cancelled.'), {
          code: 'CANCELLED',
        });
      }
      if (context.manifest.identity !== DEBUGGER_PROVIDER_ID) {
        throw new Error(`Unexpected debugger extension identity: ${context.manifest.identity}`);
      }

      const host = options.host ?? callTimeHostAdapter(context.services);
      const ui = new MarshalDebuggerUiCoordinator(context, {
        surface: options.surface,
      });
      const bridge = new DebuggerRuntimeBridge({ host, ui });

      return Object.freeze({
        capabilityProviders: Object.freeze([bridge.createProvider()]),
        serviceContributions: Object.freeze([createDebuggerServiceContribution(bridge)]),
        uiApplications: Object.freeze([createDebuggerUiApplication()]),
        dispose: () => bridge.dispose(),
      });
    },
  });
}

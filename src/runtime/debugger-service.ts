import { DEBUGGER_SERVICE_ID } from './capabilities.js';
import type {
  DebuggerInvokeInput,
  DebuggerInvokeOutput,
  DebuggerServiceProvider,
  IDebugger,
  InvocationContext,
  RuntimeServiceContribution,
} from './contracts.js';
import type { DebuggerRuntimeBridge } from './bridge.js';

export const DEBUGGER_SERVICE_SYMBOL = Symbol.for(
  DEBUGGER_SERVICE_ID,
) as import('./contracts.js').RuntimeServiceToken<IDebugger>;

export function createDebuggerServiceProvider(bridge: DebuggerRuntimeBridge): DebuggerServiceProvider {
  return Object.freeze({
    invoke: async (input: DebuggerInvokeInput, context?: InvocationContext) => {
      if (!input || typeof input.capability !== 'string' || !input.input) {
        throw new TypeError('Debugger service invoke input must contain capability and input.');
      }
      if (!context) {
        throw new TypeError('Debugger service invoke requires an InvocationContext.');
      }
      return bridge.invoke(input.capability, input.input, context);
    },
  });
}

export function createDebuggerServiceContribution(
  bridge: DebuggerRuntimeBridge,
): RuntimeServiceContribution<IDebugger> {
  return Object.freeze({
    token: DEBUGGER_SERVICE_SYMBOL,
    binding: Object.freeze({
      useValue: createDebuggerServiceProvider(bridge),
    }),
  });
}

export type { DebuggerInvokeInput, DebuggerInvokeOutput, IDebugger };

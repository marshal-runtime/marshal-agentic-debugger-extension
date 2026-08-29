import { createAgenticDebuggerRuntimeExtension } from './activation.js';

const extension = createAgenticDebuggerRuntimeExtension();

export const activate = extension.activate.bind(extension);
export {
  createAgenticDebuggerRuntimeExtension,
  DEBUGGER_HOST_ADAPTER_SERVICE,
  DEBUGGER_HOST_ADAPTER_SYMBOL,
  registerRuntimeDebuggerHostAdapter,
} from './activation.js';
export { DEBUGGER_SERVICE_ID, DEBUGGER_SERVICE_VERSION } from './capabilities.js';
export { DEBUGGER_SERVICE_SYMBOL } from './debugger-service.js';
export type {
  DebuggerHostAdapter,
  DebuggerInvokeInput,
  DebuggerInvokeOutput,
  IDebugger,
  RuntimeServiceContribution,
  RuntimeServiceToken,
} from './contracts.js';

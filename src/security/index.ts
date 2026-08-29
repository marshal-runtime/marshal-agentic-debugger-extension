export { redactValue } from './redaction.js';
export type { RedactionResult } from './redaction.js';

export { isProcessAllowed, isSystemProcess } from './process-guard.js';
export type { ProcessGuardResult, ProcessGuardOptions, AttachPolicy } from './process-guard.js';

export { isSafeExpression } from './eval-safety.js';
export type {
  ExpressionSafetyResult,
  EvalSafetyOptions,
  SafetyMode,
  InterfaceContext,
} from './eval-safety.js';

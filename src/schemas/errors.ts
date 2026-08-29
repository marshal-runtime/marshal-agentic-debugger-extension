import { z } from 'zod';

/** All predefined error codes from the error code catalog (Appendix F). */
export enum ErrorCode {
  SessionNotFound = 'SESSION_NOT_FOUND',
  AdapterNotAvailable = 'ADAPTER_NOT_AVAILABLE',
  LaunchFailed = 'LAUNCH_FAILED',
  AttachFailed = 'ATTACH_FAILED',
  BreakpointNotFound = 'BREAKPOINT_NOT_FOUND',
  BreakpointInvalid = 'BREAKPOINT_INVALID',
  CapabilityNotSupported = 'CAPABILITY_NOT_SUPPORTED',
  ExpressionEvalFailed = 'EXPRESSION_EVAL_FAILED',
  ExpressionEvalTimeout = 'EXPRESSION_EVAL_TIMEOUT',
  DapProtocolError = 'DAP_PROTOCOL_ERROR',
  LanguageNotDetected = 'LANGUAGE_NOT_DETECTED',
  PathOutsideWorkspace = 'PATH_OUTSIDE_WORKSPACE',
  ProcessRestricted = 'PROCESS_RESTRICTED',
  FileNotFound = 'FILE_NOT_FOUND',
  InvalidState = 'INVALID_STATE',
  ThreadNotFound = 'THREAD_NOT_FOUND',
  AdapterNotFound = 'ADAPTER_NOT_FOUND',
  ProtocolMismatch = 'PROTOCOL_MISMATCH',
  RuntimeIncompatible = 'RUNTIME_INCOMPATIBLE',
  ProcessNotFound = 'PROCESS_NOT_FOUND',
  ConnectionRefused = 'CONNECTION_REFUSED',
}

/** Schema for structured error responses. */
export const errorResponseSchema = z.object({
  code: z.nativeEnum(ErrorCode),
  message: z.string(),
  resolution: z.string().optional(),
});

/** Inferred type from the error response schema. */
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

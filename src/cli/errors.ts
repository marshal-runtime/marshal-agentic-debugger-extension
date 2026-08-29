import { ErrorCode } from '../schemas/errors.js';

/** CLI exit codes mapped to error categories. */
export const CLI_EXIT_CODES = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  USAGE_ERROR: 2,
  SESSION_ERROR: 3,
  ADAPTER_ERROR: 4,
  DAP_ERROR: 5,
} as const;

/** Type for CLI exit code values. */
export type CliExitCode = (typeof CLI_EXIT_CODES)[keyof typeof CLI_EXIT_CODES];

/** Resolution hints keyed by error code. */
const RESOLUTION_HINTS: Record<ErrorCode, string> = {
  [ErrorCode.SessionNotFound]: 'Run "agentic-debugger attach" to start a new session, or pass --session <id> if you have the ID. The CLI auto-selects the most recent session when --session is omitted.',
  [ErrorCode.AdapterNotAvailable]: 'Ensure the debug adapter is installed and accessible on PATH.',
  [ErrorCode.LaunchFailed]: 'Check that the program path is correct and the file exists.',
  [ErrorCode.AttachFailed]: 'Verify the target process is running and the port/PID is correct.',
  [ErrorCode.DapProtocolError]: 'This may indicate an incompatible debug adapter version. Verify adapter compatibility.',
  [ErrorCode.LanguageNotDetected]: 'Specify the language explicitly with --language.',
  [ErrorCode.FileNotFound]: 'Verify the file path exists and is accessible.',
  [ErrorCode.InvalidState]: 'The session may need to be restarted. Check session state before issuing commands.',
  [ErrorCode.PathOutsideWorkspace]: 'Only files within the workspace directory are allowed. Use an absolute path within the workspace.',
  [ErrorCode.ProcessRestricted]: 'The target process is not permitted by security policy. Adjust allowAttach in configuration.',
  [ErrorCode.ExpressionEvalFailed]: 'Check expression syntax for the target language.',
  [ErrorCode.ExpressionEvalTimeout]: 'The expression took too long to evaluate. Simplify the expression or increase the timeout.',
  [ErrorCode.BreakpointNotFound]: 'The breakpoint ID does not exist. List current breakpoints to find valid IDs.',
  [ErrorCode.BreakpointInvalid]: 'The breakpoint location is invalid. Verify the file path and line number.',
  [ErrorCode.CapabilityNotSupported]: 'The debug adapter does not support this feature. Use a different adapter or remove the unsupported operation.',
  [ErrorCode.ThreadNotFound]: 'The thread ID does not exist. List active threads to find valid IDs.',
  [ErrorCode.AdapterNotFound]: 'The debug adapter binary was not found. Install it or set the appropriate environment variable (e.g., AGENTIC_JSDEBUG_PATH, AGENTIC_NETCOREDBG_PATH).',
  [ErrorCode.ProtocolMismatch]: 'The target port speaks a different protocol than expected. Use --type to specify the correct debug type (e.g., --type chrome for CDP endpoints).',
  [ErrorCode.RuntimeIncompatible]: 'The debug adapter does not support this runtime version. Check adapter compatibility with the target process.',
  [ErrorCode.ProcessNotFound]: 'No process found with the given PID. Verify the process is running.',
  [ErrorCode.ConnectionRefused]: 'Cannot connect to the target address. Verify the process is running with debugging enabled and the port is correct.',
};

/** Map ErrorCode to appropriate CLI exit code. */
export function mapErrorToExitCode(code: ErrorCode): CliExitCode {
  switch (code) {
    case ErrorCode.SessionNotFound:
    case ErrorCode.InvalidState:
      return CLI_EXIT_CODES.SESSION_ERROR;
    case ErrorCode.AdapterNotAvailable:
    case ErrorCode.AdapterNotFound:
    case ErrorCode.LanguageNotDetected:
    case ErrorCode.LaunchFailed:
    case ErrorCode.AttachFailed:
    case ErrorCode.RuntimeIncompatible:
      return CLI_EXIT_CODES.ADAPTER_ERROR;
    case ErrorCode.DapProtocolError:
    case ErrorCode.CapabilityNotSupported:
    case ErrorCode.ProtocolMismatch:
      return CLI_EXIT_CODES.DAP_ERROR;
    case ErrorCode.PathOutsideWorkspace:
    case ErrorCode.BreakpointInvalid:
    case ErrorCode.FileNotFound:
    case ErrorCode.ProcessNotFound:
    case ErrorCode.ConnectionRefused:
      return CLI_EXIT_CODES.USAGE_ERROR;
    default:
      return CLI_EXIT_CODES.GENERAL_ERROR;
  }
}

/** Look up a resolution hint for the given error code. */
export function getResolutionHint(code: ErrorCode): string {
  return RESOLUTION_HINTS[code];
}

/** Format an error for CLI output to stderr. */
export function formatCliError(code: ErrorCode, message: string, resolution?: string): string {
  const hint = resolution ?? getResolutionHint(code);
  const lines: string[] = [`Error [${code}]: ${message}`];
  if (hint) {
    lines.push(`Resolution: ${hint}`);
  }
  return lines.join('\n');
}

import type { LanguageId } from './adapter.js';

/** Error information within a command result. */
export interface CommandError {
  /** Machine-readable error code. */
  readonly code: string;
  /** Human-readable error description. */
  readonly message: string;
  /** Actionable resolution suggestion. */
  readonly resolution?: string;
}

/** Successful command result. */
export interface CommandSuccess<T = unknown> {
  /** Indicates the command succeeded. */
  readonly success: true;
  /** Target session identifier, if applicable. */
  readonly sessionId?: string;
  /** Command that was executed. */
  readonly command: string;
  /** ISO-8601 timestamp of command execution. */
  readonly timestamp: string;
  /** Command-specific result data. */
  readonly data: T;
  /** Error is always absent on success. */
  readonly error: null;
}

/** Failed command result. */
export interface CommandFailure {
  /** Indicates the command failed. */
  readonly success: false;
  /** Target session identifier, if applicable. */
  readonly sessionId?: string;
  /** Command that was executed. */
  readonly command: string;
  /** ISO-8601 timestamp of command execution. */
  readonly timestamp: string;
  /** Data is always absent on failure. */
  readonly data: null;
  /** Error details. */
  readonly error: CommandError;
}

/** Result envelope returned by all commands (discriminated union on success). */
export type CommandResult<T = unknown> = CommandSuccess<T> | CommandFailure;

/** Options for launching a debug session. */
export interface LaunchOptions {
  /** Path to the program to debug. */
  readonly program: string;
  /** Language of the program. */
  readonly language?: LanguageId;
  /** Whether to stop on the first statement. */
  readonly stopOnEntry?: boolean;
  /** Working directory for the debuggee. */
  readonly cwd?: string;
  /** Program arguments. */
  readonly args?: readonly string[];
  /** Environment variables for the debuggee. */
  readonly env?: Readonly<Record<string, string>>;
}

/** Options for attaching to a running process. */
export interface AttachOptions {
  /** Process ID to attach to. */
  readonly processId?: number;
  /** Host address for network attach. */
  readonly host?: string;
  /** Port number for network attach. */
  readonly port?: number;
  /** Language of the target process. */
  readonly language?: LanguageId;
}

/** Input for a generic command invocation. */
export type CommandInput = LaunchOptions | AttachOptions;

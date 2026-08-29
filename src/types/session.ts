import type { LanguageId, AdapterConfig } from './adapter.js';

/** States a debug session can be in. */
export enum SessionState {
  /** Session created but not yet initialized. */
  Idle = 'idle',
  /** DAP initialize handshake in progress. */
  Initializing = 'initializing',
  /** Debuggee launched/attached and running. */
  Running = 'running',
  /** Debuggee paused at breakpoint, step, or exception. */
  Stopped = 'stopped',
  /** Session is shutting down. */
  Terminating = 'terminating',
  /** Session fully closed. */
  Terminated = 'terminated',
}

/** Configuration options for creating a new debug session. */
export interface SessionConfig {
  /** Unique session identifier. */
  readonly sessionId: string;
  /** Path to the program to debug. */
  readonly program: string;
  /** Language of the debuggee program. */
  readonly language: LanguageId;
  /** Program arguments. */
  readonly args?: readonly string[];
  /** Working directory for the debuggee. */
  readonly cwd?: string;
  /** Environment variables for the debuggee. */
  readonly env?: Readonly<Record<string, string>>;
  /** Whether to stop on the first statement. */
  readonly stopOnEntry?: boolean;
  /** Adapter-specific configuration. */
  readonly adapterConfig?: AdapterConfig;
}

/** Runtime information about an active debug session. */
export interface SessionInfo {
  /** Unique session identifier. */
  readonly sessionId: string;
  /** Current state of the session. */
  readonly state: SessionState;
  /** Language of the debuggee. */
  readonly language: LanguageId;
  /** ISO-8601 timestamp when session was created. */
  readonly createdAt: string;
  /** Path to the program being debugged. */
  readonly program: string;
}

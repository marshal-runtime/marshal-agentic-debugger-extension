import { SessionState } from '../types/session.js';
import type { SessionConfig, SessionInfo } from '../types/session.js';
import type { DapClient } from '../dap/client.js';

export type { SessionConfig, SessionInfo };
export { SessionState };

/** Valid state transitions for the session state machine. */
export const SESSION_STATE_TRANSITIONS: Readonly<Record<SessionState, readonly SessionState[]>> = {
  [SessionState.Idle]: [SessionState.Initializing],
  [SessionState.Initializing]: [SessionState.Running, SessionState.Terminated],
  [SessionState.Running]: [SessionState.Stopped, SessionState.Terminating, SessionState.Terminated],
  [SessionState.Stopped]: [SessionState.Running, SessionState.Terminating, SessionState.Terminated],
  [SessionState.Terminating]: [SessionState.Terminated],
  [SessionState.Terminated]: [],
} as const;

/** Options for creating a DebugSession instance. */
export interface DebugSessionOptions {
  readonly config: SessionConfig;
  readonly client: DapClient;
  readonly initializeTimeoutMs?: number;
}

/** Snapshot of a session's runtime state. */
export interface SessionSnapshot {
  readonly sessionId: string;
  readonly state: SessionState;
  readonly language: string;
  readonly createdAt: string;
  readonly lastStateChange?: string;
}

/** Error thrown when an invalid session state transition is attempted. */
export class SessionStateError extends Error {
  constructor(
    readonly currentState: SessionState,
    readonly targetState: SessionState,
  ) {
    super(
      `Invalid session state transition: ${currentState} \u2192 ${targetState}. ` +
        `The session cannot move between these states. ` +
        `Check the session state before issuing commands.`,
    );
    this.name = 'SessionStateError';
  }
}

/** Error thrown when a session is not found by ID. */
export class SessionNotFoundError extends Error {
  constructor(readonly sessionId: string) {
    super(
      `Session not found: ${sessionId}. ` +
        `The session may have been terminated or the ID is incorrect. ` +
        `List active sessions to find valid session IDs.`,
    );
    this.name = 'SessionNotFoundError';
  }
}

/** Error thrown when the maximum concurrent session limit is exceeded. */
export class MaxSessionsExceededError extends Error {
  constructor(readonly maxSessions: number) {
    super(
      `Maximum concurrent sessions (${maxSessions}) exceeded. ` +
        `Too many debug sessions are active. ` +
        `Terminate an existing session before starting a new one.`,
    );
    this.name = 'MaxSessionsExceededError';
  }
}

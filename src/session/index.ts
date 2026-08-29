import { nanoid } from 'nanoid';

import { SessionState } from '../types/session.js';
import type { SessionConfig } from '../types/session.js';
import type { DapClient } from '../dap/client.js';
import type { DebugSessionOptions, SessionSnapshot } from './types.js';
import { SessionNotFoundError, MaxSessionsExceededError } from './types.js';
import { DebugSession } from './session.js';

/** States from which a session can be gracefully disconnected. */
const DISCONNECTABLE_STATES: ReadonlySet<SessionState> = new Set([
  SessionState.Initializing,
  SessionState.Running,
  SessionState.Stopped,
]);

/** Default maximum number of concurrent sessions. */
const DEFAULT_MAX_SESSIONS = 10;

/** Options for creating a SessionManager. */
export interface SessionManagerOptions {
  readonly maxConcurrentSessions?: number;
}

/** Options passed to createSession for wiring a new debug session. */
export interface CreateSessionOptions {
  readonly config: Omit<SessionConfig, 'sessionId'>;
  readonly client: DapClient;
}

/**
 * Manages multiple DebugSession instances.
 *
 * Provides create, get, list, and destroy operations for debug sessions.
 * Enforces a configurable limit on concurrent sessions.
 */
export class SessionManager {
  private readonly sessions = new Map<string, DebugSession>();
  private readonly maxSessions: number;

  constructor(options?: SessionManagerOptions) {
    this.maxSessions = options?.maxConcurrentSessions ?? DEFAULT_MAX_SESSIONS;
  }

  /**
   * Create a new debug session with a unique ID.
   *
   * @param options - Session configuration and pre-constructed DapClient.
   * @returns The newly created DebugSession.
   * @throws MaxSessionsExceededError if the concurrent session limit is reached.
   */
  createSession(options: CreateSessionOptions): DebugSession {
    if (this.sessions.size >= this.maxSessions) {
      throw new MaxSessionsExceededError(this.maxSessions);
    }

    const sessionId = `sess-${nanoid(8)}`;

    const config: SessionConfig = {
      ...options.config,
      sessionId,
    };

    const sessionOptions: DebugSessionOptions = {
      config,
      client: options.client,
    };

    const session = new DebugSession(sessionOptions);
    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Get a session by its identifier.
   *
   * @param sessionId - The session identifier.
   * @returns The DebugSession.
   * @throws SessionNotFoundError if no session exists with that ID.
   */
  getSession(sessionId: string): DebugSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }
    return session;
  }

  /**
   * List snapshots of all active sessions.
   *
   * @returns Array of session snapshots.
   */
  listSessions(): SessionSnapshot[] {
    return Array.from(this.sessions.values()).map((s) => s.snapshot());
  }

  /**
   * Destroy a session by its identifier.
   *
   * Gracefully disconnects the session (if in a disconnectable state)
   * before removing it from management.
   *
   * @param sessionId - The session to destroy.
   * @throws SessionNotFoundError if no session exists with that ID.
   */
  async destroySession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }

    try {
      if (DISCONNECTABLE_STATES.has(session.state)) {
        await session.disconnect();
      }
    } finally {
      this.sessions.delete(sessionId);
    }
  }

  /** Number of active sessions. */
  get activeCount(): number {
    return this.sessions.size;
  }
}

// Re-export session layer types
export { DebugSession } from './session.js';
export { SESSION_STATE_TRANSITIONS, SessionNotFoundError, MaxSessionsExceededError } from './types.js';
export type { DebugSessionOptions, SessionSnapshot } from './types.js';
export { SessionEventType } from './events.js';
export type {
  SessionEvent,
  SessionStateChangedEvent,
  SessionErrorEvent,
  SessionEventHandler,
  SessionEventEmitter,
} from './events.js';

// Re-export core session types from types layer
export type { SessionState, SessionConfig, SessionInfo } from '../types/session.js';

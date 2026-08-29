import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Check whether a process with the given PID is still running.
 * Uses `process.kill(pid, 0)` which sends no signal but throws
 * if the process doesn't exist.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Persisted session state for cross-process CLI communication. */
export interface PersistedSession {
  /** Session identifier. */
  readonly sessionId: string;
  /** Transport type for reconnecting. */
  readonly transport: 'tcp' | 'stdio';
  /** TCP host (for TCP transport). */
  readonly host?: string;
  /** TCP port (for TCP transport). */
  readonly port?: number;
  /** Language being debugged. */
  readonly language: string;
  /** Human-readable target description. */
  readonly target: string;
  /** Timestamp when session was created. */
  readonly createdAt: string;
  /** PID of the CLI process that owns the adapter. */
  readonly ownerPid: number;
}

/** Directory where session state files are stored. */
function getSessionDir(): string {
  const dir = join(homedir(), '.agentic-debugger', 'sessions');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Persist a session to disk so other CLI invocations can reconnect. */
export function persistSession(session: PersistedSession): void {
  const dir = getSessionDir();
  const filePath = join(dir, `${session.sessionId}.json`);
  writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
}

/** Load a persisted session by ID. Returns null if not found or if the owner process is dead. */
export function loadSession(sessionId: string): PersistedSession | null {
  const dir = getSessionDir();
  const filePath = join(dir, `${sessionId}.json`);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const session = JSON.parse(readFileSync(filePath, 'utf-8')) as PersistedSession;
    // Auto-clean sessions whose daemon is no longer running
    if (session.ownerPid && !isProcessAlive(session.ownerPid)) {
      try { unlinkSync(filePath); } catch { /* best-effort */ }
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

/** Load the most recently created session. Returns null if none exist or all are stale. */
export function loadLatestSession(): PersistedSession | null {
  const dir = getSessionDir();
  if (!existsSync(dir)) return null;

  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  if (files.length === 0) return null;

  let latest: PersistedSession | null = null;
  let latestTime = '';

  for (const file of files) {
    try {
      const session = JSON.parse(
        readFileSync(join(dir, file), 'utf-8'),
      ) as PersistedSession;

      // Skip and clean up sessions whose daemon is no longer running
      if (session.ownerPid && !isProcessAlive(session.ownerPid)) {
        try { unlinkSync(join(dir, file)); } catch { /* best-effort */ }
        continue;
      }

      if (session.createdAt > latestTime) {
        latestTime = session.createdAt;
        latest = session;
      }
    } catch {
      // Corrupted file — skip
    }
  }

  return latest;
}

/** Remove a persisted session file. */
export function removeSession(sessionId: string): void {
  const dir = getSessionDir();
  const filePath = join(dir, `${sessionId}.json`);
  try {
    unlinkSync(filePath);
  } catch {
    // File may already be gone
  }
}

/** List all persisted sessions. */
export function listPersistedSessions(): PersistedSession[] {
  const dir = getSessionDir();
  if (!existsSync(dir)) return [];

  const sessions: PersistedSession[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    try {
      sessions.push(
        JSON.parse(readFileSync(join(dir, file), 'utf-8')) as PersistedSession,
      );
    } catch {
      // skip corrupted
    }
  }
  return sessions;
}

// ── Breakpoint persistence (cross-process) ──────────────────────────

/** Serializable breakpoint entry for disk persistence. */
export interface PersistedBreakpoint {
  readonly file: string;
  readonly line: number;
  readonly condition?: string;
  readonly hitCondition?: string;
  readonly logMessage?: string;
  readonly verified: boolean;
  readonly enabled: boolean;
}

/** Serializable breakpoint state for a session. */
export interface PersistedBreakpointState {
  /** Map of file path → breakpoints. JSON-serialized as Record<string, PersistedBreakpoint[]>. */
  readonly lineBreakpoints: Record<string, PersistedBreakpoint[]>;
  /** Function breakpoints. */
  readonly functionBreakpoints: Array<{
    readonly name: string;
    readonly condition?: string;
    readonly hitCondition?: string;
    readonly verified: boolean;
    readonly enabled: boolean;
  }>;
}

/** Directory for breakpoint state files. */
function getBreakpointDir(): string {
  const dir = join(homedir(), '.agentic-debugger', 'breakpoints');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Persist breakpoint state for a session. */
export function persistBreakpoints(sessionId: string, state: PersistedBreakpointState): void {
  const dir = getBreakpointDir();
  const filePath = join(dir, `${sessionId}.json`);
  writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
}

/** Load persisted breakpoint state for a session. Returns null if not found. */
export function loadBreakpoints(sessionId: string): PersistedBreakpointState | null {
  const dir = getBreakpointDir();
  const filePath = join(dir, `${sessionId}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as PersistedBreakpointState;
  } catch {
    return null;
  }
}

/**
 * Reconnection helper for CLI commands.
 *
 * Connects to a running session host daemon (started by the attach command)
 * and sends DAP requests. This enables cross-process session persistence:
 * each CLI invocation is a short-lived process that talks to the long-lived
 * session host daemon via TCP.
 */

import { Socket } from 'node:net';

import { loadSession, loadLatestSession, type PersistedSession } from './session-persist.js';

/** Response from the session host daemon. */
export interface SessionHostResponse {
  readonly success: boolean;
  readonly body?: unknown;
  readonly message?: string;
  readonly command?: string;
}

/** Result of resolving a session and sending a command. */
export interface CommandResult {
  readonly sessionId: string;
  readonly response: SessionHostResponse;
}

/**
 * Load a persisted session by ID, or fall back to the latest session.
 *
 * @param sessionId - Optional session ID. If not provided, uses the latest.
 * @returns The persisted session, or null if none found.
 */
export function resolvePersistedSession(
  sessionId?: string,
): PersistedSession | null {
  if (sessionId) {
    return loadSession(sessionId);
  }
  return loadLatestSession();
}

/**
 * Send a DAP command to the session host daemon.
 *
 * Connects to the session host's TCP command port, sends the command,
 * and returns the response.
 *
 * @param persisted - The persisted session containing connection details.
 * @param command - The DAP command name (e.g., 'threads', 'stackTrace').
 * @param args - Optional command arguments.
 * @returns The response from the session host.
 */
export async function sendSessionCommand(
  persisted: PersistedSession,
  command: string,
  args?: unknown,
): Promise<SessionHostResponse> {
  const { host, port } = persisted;

  if (!port) {
    throw new Error(
      'Session does not have a command port. It may have been created ' +
        'before the session host daemon was implemented. Re-attach to create a new session.',
    );
  }

  return new Promise<SessionHostResponse>((resolve, reject) => {
    const socket = new Socket();
    const chunks: Buffer[] = [];

    socket.connect(port, host ?? '127.0.0.1', () => {
      // Send the command and half-close
      const payload = JSON.stringify({ command, args });
      socket.end(payload);
    });

    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });

    socket.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8').trim();
      if (!raw) {
        reject(new Error('Session host returned empty response'));
        return;
      }
      try {
        resolve(JSON.parse(raw) as SessionHostResponse);
      } catch {
        reject(new Error(`Session host returned invalid JSON: ${raw}`));
      }
    });

    socket.on('error', (err: Error) => {
      if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
        reject(
          new Error(
            `No active session found (session host not running on port ${port}). ` +
              'The debug session may have ended. Run "agentic-debugger attach" to start a new session.',
          ),
        );
      } else {
        reject(new Error(`Failed to connect to session host: ${err.message}`));
      }
    });

    // Timeout after 30 seconds
    socket.setTimeout(30_000, () => {
      socket.destroy();
      reject(new Error('Timed out waiting for session host response'));
    });
  });
}

/**
 * Convenience function: resolve a session and send a command in one call.
 *
 * @param sessionId - Optional session ID. If not provided, uses the latest.
 * @param command - The DAP command name.
 * @param args - Optional command arguments.
 * @returns The session ID and the response.
 */
export async function sendCommand(
  sessionId: string | undefined,
  command: string,
  args?: unknown,
): Promise<CommandResult> {
  const persisted = resolvePersistedSession(sessionId);
  if (!persisted) {
    throw new Error(
      sessionId
        ? `Session not found: ${sessionId}`
        : 'No active session found. Run "agentic-debugger attach" first.',
    );
  }

  const response = await sendSessionCommand(persisted, command, args);
  return { sessionId: persisted.sessionId, response };
}

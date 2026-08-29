/**
 * Session host — a persistent background process that maintains a DAP client
 * connection and accepts forwarded DAP requests from CLI invocations.
 *
 * Protocol (CLI client → session host):
 * 1. Client connects via TCP
 * 2. Client writes a JSON object and half-closes the socket (socket.end)
 *    Format: { "command": "<dap-command>", "args": { ... } }
 * 3. Server reads, parses, forwards as a DAP request, gets the response
 * 4. Server writes a JSON response line and closes:
 *    Success: { "success": true, "body": { ... } }
 *    Error:   { "success": false, "message": "..." }
 *
 * Special commands:
 * - { "command": "_shutdown" }  → disconnect from adapter, clean up, exit
 * - { "command": "_ping" }     → respond with { "success": true, "alive": true }
 */

import { createServer, type Server, type Socket } from 'node:net';

import type { DapClient } from '../dap/client.js';
import type { DapResponse } from '../dap/types.js';
import { persistSession, removeSession } from './session-persist.js';

export interface SessionHostInfo {
  /** TCP port the command server is listening on. */
  readonly commandPort: number;
  /** The server instance (for cleanup). */
  readonly server: Server;
}

/**
 * Start a TCP command server that proxies DAP requests from CLI clients
 * to the given DapClient.
 *
 * @param activeDapClient - A mutable reference holder for the active DapClient.
 *   For CDP attach, the active client may be swapped from the parent session
 *   to a child session after startDebugging.
 * @param sessionId - The session identifier.
 * @param language - Language being debugged.
 * @param target - Human-readable target description.
 * @returns The command port and server instance.
 */
export async function startSessionHost(
  activeDapClient: { client: DapClient },
  sessionId: string,
  language: string,
  target: string,
): Promise<SessionHostInfo> {
  // Capture recent output events from the DAP adapter for diagnostics.
  // Limited to the last 200 entries to prevent unbounded memory growth.
  const MAX_EVENTS = 200;
  const recentEvents: Array<{ event: string; body: unknown; timestamp: string }> = [];

  // Register event listener for 'output' events (module loading, engine logs, etc.)
  activeDapClient.client.onEvent('output', (event) => {
    const body = (event.body ?? {}) as Record<string, unknown>;
    recentEvents.push({
      event: 'output',
      body,
      timestamp: new Date().toISOString(),
    });
    if (recentEvents.length > MAX_EVENTS) {
      recentEvents.shift();
    }
  });

  // Register event listener for 'breakpoint' events (verification updates)
  activeDapClient.client.onEvent('breakpoint', (event) => {
    const body = (event.body ?? {}) as Record<string, unknown>;
    recentEvents.push({
      event: 'breakpoint',
      body,
      timestamp: new Date().toISOString(),
    });
    if (recentEvents.length > MAX_EVENTS) {
      recentEvents.shift();
    }
  });

  // Register event listener for 'module' events
  activeDapClient.client.onEvent('module', (event) => {
    const body = (event.body ?? {}) as Record<string, unknown>;
    recentEvents.push({
      event: 'module',
      body,
      timestamp: new Date().toISOString(),
    });
    if (recentEvents.length > MAX_EVENTS) {
      recentEvents.shift();
    }
  });

  // Track the last stopped thread so CLI commands like callstack/step/pause can
  // default to it. Some adapters (notably netcoredbg) return OS thread IDs that
  // an agent has no way to discover except by reading the threads list first.
  const stoppedState: { threadId: number | undefined; reason: string | undefined; at: string | undefined } = {
    threadId: undefined,
    reason: undefined,
    at: undefined,
  };
  const registerStoppedTracking = (c: DapClient): void => {
    c.onEvent('stopped', (event) => {
      const body = (event.body ?? {}) as { threadId?: number; reason?: string };
      if (typeof body.threadId === 'number') {
        stoppedState.threadId = body.threadId;
      }
      stoppedState.reason = body.reason;
      stoppedState.at = new Date().toISOString();
    });
    c.onEvent('continued', () => {
      // Keep threadId as the "most recent stopped" hint, but mark the run state.
      stoppedState.reason = 'continued';
      stoppedState.at = new Date().toISOString();
    });
    c.onEvent('terminated', () => {
      stoppedState.reason = 'terminated';
      stoppedState.at = new Date().toISOString();
    });
  };
  registerStoppedTracking(activeDapClient.client);

  return new Promise<SessionHostInfo>((resolve, reject) => {
    // allowHalfOpen is critical: the CLI client writes a JSON command then
    // calls socket.end() (half-close). Without allowHalfOpen, Node.js
    // automatically destroys the socket when the readable side ends,
    // closing it before the async DAP response can be written back.
    const server = createServer({ allowHalfOpen: true }, (socket: Socket) => {
      handleClientConnection(socket, activeDapClient, sessionId, server, recentEvents, stoppedState);
    });

    server.on('error', (err) => {
      reject(err);
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to bind session host command server'));
        return;
      }

      const commandPort = addr.port;

      // Persist session with the command server port
      persistSession({
        sessionId,
        transport: 'tcp',
        host: '127.0.0.1',
        port: commandPort,
        language,
        target,
        createdAt: new Date().toISOString(),
        ownerPid: process.pid,
      });

      resolve({ commandPort, server });
    });
  });
}

/** Snapshot of the most recent stopped event, exposed via the `_stopped` command. */
interface StoppedStateSnapshot {
  threadId: number | undefined;
  reason: string | undefined;
  at: string | undefined;
}

/** Handle a single client connection to the session host. */
function handleClientConnection(
  socket: Socket,
  activeDapClient: { client: DapClient },
  sessionId: string,
  server: Server,
  recentEvents?: Array<{ event: string; body: unknown; timestamp: string }>,
  stoppedState?: StoppedStateSnapshot,
): void {
  const chunks: Buffer[] = [];

  socket.on('data', (chunk: Buffer) => {
    chunks.push(chunk);
  });

  socket.on('end', () => {
    void (async () => {
      const raw = Buffer.concat(chunks).toString('utf-8').trim();
      if (!raw) {
        socket.end(JSON.stringify({ success: false, message: 'Empty request' }));
        return;
      }

      let request: { command: string; args?: unknown };
      try {
        request = JSON.parse(raw) as { command: string; args?: unknown };
      } catch {
        socket.end(JSON.stringify({ success: false, message: 'Invalid JSON' }));
        return;
      }

      const { command, args } = request;

      // Special: ping
      if (command === '_ping') {
        socket.end(JSON.stringify({ success: true, alive: true }));
        return;
      }

      // Special: stopped — expose the most recent stopped thread so callers
      // (and the CLI itself) can default threadId without re-querying threads.
      if (command === '_stopped') {
        socket.end(
          JSON.stringify({
            success: true,
            body: {
              threadId: stoppedState?.threadId ?? null,
              reason: stoppedState?.reason ?? null,
              at: stoppedState?.at ?? null,
            },
          }),
        );
        return;
      }

      // Default thread-scoped DAP commands to the last stopped thread when the
      // caller did not supply one. Adapters like netcoredbg return OS TIDs that
      // no agent could guess; defaulting here removes a hard-to-debug INVALID_STATE.
      const threadScopedCommands = new Set(['stackTrace', 'continue', 'next', 'stepIn', 'stepOut', 'pause', 'gotoTargets', 'goto']);
      let effectiveArgs = args;
      if (
        threadScopedCommands.has(command) &&
        stoppedState?.threadId !== undefined &&
        typeof args === 'object' &&
        args !== null &&
        (args as Record<string, unknown>)['threadId'] === undefined
      ) {
        effectiveArgs = { ...(args as Record<string, unknown>), threadId: stoppedState.threadId };
      }

      // Special: events — return captured DAP events for diagnostics
      if (command === '_events') {
        const filterType = (args as Record<string, unknown>)?.['type'] as string | undefined;
        const filterText = (args as Record<string, unknown>)?.['filter'] as string | undefined;
        let events = recentEvents ?? [];
        if (filterType) {
          events = events.filter((e) => e.event === filterType);
        }
        if (filterText) {
          const lower = filterText.toLowerCase();
          events = events.filter((e) =>
            JSON.stringify(e.body).toLowerCase().includes(lower),
          );
        }
        socket.end(JSON.stringify({ success: true, events, totalCount: events.length }));
        return;
      }

      // Special: shutdown (disconnect + exit)
      if (command === '_shutdown') {
        socket.end(JSON.stringify({ success: true, message: 'Shutting down' }));
        try {
          await activeDapClient.client.disconnect(
            (args as Record<string, unknown>) ?? {},
          );
        } catch { /* best-effort */ }
        try {
          activeDapClient.client.dispose();
        } catch { /* best-effort */ }
        removeSession(sessionId);
        server.close();
        // Give a moment for the socket to flush, then exit
        setTimeout(() => process.exit(0), 200);
        return;
      }

      // Forward as a DAP request
      try {
        const response: DapResponse = await activeDapClient.client.sendRequest(
          command,
          effectiveArgs,
        );
        socket.end(
          JSON.stringify({
            success: response.success,
            body: response.body,
            message: response.message,
            command: response.command,
          }),
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        socket.end(JSON.stringify({ success: false, message }));
      }
    })();
  });

  socket.on('error', () => {
    // Client disconnected abruptly — nothing to do
  });
}

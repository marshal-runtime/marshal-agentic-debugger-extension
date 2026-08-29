import { Socket } from 'node:net';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

import { startSessionHost } from '../../../src/cli/session-host.js';
import type { DapClient } from '../../../src/dap/client.js';
import type { DapResponse, DapEvent } from '../../../src/dap/types.js';

/**
 * Regression coverage for the host-side half of commit 21ff1e1.
 *
 * The session host watches DAP `stopped` events and remembers the most recent
 * threadId. When a client sends a thread-scoped DAP request with no `threadId`
 * in its args, the host injects the remembered one before forwarding to the
 * adapter. Without this injection, adapters like netcoredbg (which return OS
 * thread IDs, not 1) reject the request with an opaque `INVALID_STATE`.
 */

/** Minimal stand-in for DapClient that exposes the surface session-host uses. */
function makeFakeClient(): {
  client: DapClient;
  emitter: EventEmitter;
  sendRequestCalls: Array<{ command: string; args: unknown }>;
  setNextResponse: (resp: Partial<DapResponse>) => void;
} {
  const emitter = new EventEmitter();
  const sendRequestCalls: Array<{ command: string; args: unknown }> = [];
  let nextResponse: Partial<DapResponse> = { success: true, body: {} };

  const fake = {
    onEvent(event: string, handler: (e: DapEvent) => void): void {
      emitter.on(event, handler);
    },
    async sendRequest(command: string, args: unknown): Promise<DapResponse> {
      sendRequestCalls.push({ command, args });
      return {
        seq: sendRequestCalls.length,
        type: 'response',
        request_seq: sendRequestCalls.length,
        success: true,
        command,
        body: {},
        ...nextResponse,
      } as DapResponse;
    },
    async disconnect(): Promise<DapResponse> {
      return { success: true } as DapResponse;
    },
    dispose(): void {
      // no-op
    },
  };

  return {
    client: fake as unknown as DapClient,
    emitter,
    sendRequestCalls,
    setNextResponse: (resp) => {
      nextResponse = resp;
    },
  };
}

/** Send one JSON command frame to the session host and read the JSON reply. */
function sendHostCommand(
  port: number,
  payload: { command: string; args?: unknown },
): Promise<{ success: boolean; body?: unknown; message?: string }> {
  return new Promise((resolve, reject) => {
    const socket = new Socket();
    const chunks: Buffer[] = [];
    socket.connect(port, '127.0.0.1', () => {
      socket.end(JSON.stringify(payload));
    });
    socket.on('data', (c: Buffer) => chunks.push(c));
    socket.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8').trim();
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error(`bad host reply: ${raw}`));
      }
    });
    socket.on('error', reject);
    socket.setTimeout(5_000, () => {
      socket.destroy();
      reject(new Error('host reply timeout'));
    });
  });
}

describe('session host injects last stopped threadId for thread-scoped DAP commands', () => {
  let fake: ReturnType<typeof makeFakeClient>;
  let hostInfo: Awaited<ReturnType<typeof startSessionHost>>;

  beforeEach(async () => {
    fake = makeFakeClient();
    hostInfo = await startSessionHost(
      { client: fake.client },
      `sess-test-${Date.now()}`,
      'csharp',
      'pid:12345',
    );
  });

  afterEach(() => {
    hostInfo.server.close();
  });

  it('stackTrace without threadId picks up the last stopped thread', async () => {
    // Simulate the adapter emitting a stopped event with a netcoredbg-style OS TID.
    fake.emitter.emit('stopped', { body: { threadId: 58132, reason: 'breakpoint' } });

    // Client sends stackTrace with no threadId (mirrors `agentic-debugger callstack`
    // invoked without --thread-id).
    const reply = await sendHostCommand(hostInfo.commandPort, {
      command: 'stackTrace',
      args: { startFrame: 0, levels: 20 },
    });
    expect(reply.success).toBe(true);

    // The host must have injected threadId=58132 into the forwarded request.
    const forwarded = fake.sendRequestCalls.find((c) => c.command === 'stackTrace');
    expect(forwarded).toBeDefined();
    expect((forwarded!.args as Record<string, unknown>)['threadId']).toBe(58132);
    expect((forwarded!.args as Record<string, unknown>)['startFrame']).toBe(0);
  });

  it('explicit threadId in args is preserved (never overwritten)', async () => {
    fake.emitter.emit('stopped', { body: { threadId: 58132, reason: 'breakpoint' } });

    await sendHostCommand(hostInfo.commandPort, {
      command: 'continue',
      args: { threadId: 7 },
    });

    const forwarded = fake.sendRequestCalls.find((c) => c.command === 'continue');
    expect(forwarded).toBeDefined();
    expect((forwarded!.args as Record<string, unknown>)['threadId']).toBe(7);
  });

  it('non-thread-scoped commands are never tampered with', async () => {
    fake.emitter.emit('stopped', { body: { threadId: 58132 } });

    // setBreakpoints has no threadId at all.
    const setBpArgs = { source: { path: 'X.cs' }, breakpoints: [{ line: 1 }] };
    await sendHostCommand(hostInfo.commandPort, {
      command: 'setBreakpoints',
      args: setBpArgs,
    });

    const forwarded = fake.sendRequestCalls.find((c) => c.command === 'setBreakpoints');
    expect(forwarded).toBeDefined();
    // Args object must be the original — no injected threadId.
    expect((forwarded!.args as Record<string, unknown>)['threadId']).toBeUndefined();
    expect((forwarded!.args as Record<string, unknown>)['source']).toEqual(setBpArgs.source);
  });

  it('exposes the last stopped thread via the _stopped special command', async () => {
    fake.emitter.emit('stopped', { body: { threadId: 99, reason: 'breakpoint' } });

    const reply = await sendHostCommand(hostInfo.commandPort, { command: '_stopped' });
    expect(reply.success).toBe(true);
    const body = reply.body as { threadId: number | null; reason: string | null };
    expect(body.threadId).toBe(99);
    expect(body.reason).toBe('breakpoint');
  });

  it('falls back gracefully when no stopped event has fired yet (no threadId injected)', async () => {
    // No stopped event emitted.
    await sendHostCommand(hostInfo.commandPort, {
      command: 'stackTrace',
      args: { startFrame: 0, levels: 20 },
    });

    const forwarded = fake.sendRequestCalls.find((c) => c.command === 'stackTrace');
    expect((forwarded!.args as Record<string, unknown>)['threadId']).toBeUndefined();
  });
});

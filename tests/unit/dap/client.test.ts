import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DapClient } from '../../../src/dap/client.js';
import type { DapClientOptions } from '../../../src/dap/client.js';
import type { DapResponse, DapEvent } from '../../../src/dap/types.js';
import type { Transport } from '../../../src/dap/transport/types.js';
import type { DataHandler, CloseHandler, ErrorHandler } from '../../../src/dap/transport/types.js';
import { DapFramer } from '../../../src/dap/framer.js';

function createMockTransport(): Transport & {
  dataHandler: DataHandler | undefined;
  simulateMessage: (data: Buffer) => void;
} {
  let dataHandler: DataHandler | undefined;

  return {
    connected: true,
    dataHandler: undefined,
    connect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    send: vi.fn<(data: Buffer) => void>(),
    onMessage(handler: DataHandler): void {
      dataHandler = handler;
      this.dataHandler = handler;
    },
    onClose: vi.fn<(handler: CloseHandler) => void>(),
    onError: vi.fn<(handler: ErrorHandler) => void>(),
    close: vi.fn<() => void>(),
    simulateMessage(data: Buffer): void {
      dataHandler?.(data);
    },
  };
}

function respondTo(
  transport: ReturnType<typeof createMockTransport>,
  framer: DapFramer,
  overrides: Partial<DapResponse> = {},
): void {
  const calls = (transport.send as ReturnType<typeof vi.fn>).mock.calls;
  const lastCall = calls[calls.length - 1]![0] as Buffer;
  const parsed = framer.unframe(lastCall)[0]!;

  const response: DapResponse = {
    seq: 1,
    type: 'response',
    request_seq: parsed.seq,
    success: true,
    command: (parsed as { command: string }).command,
    ...overrides,
  };
  transport.simulateMessage(framer.frame(response));
}

describe('DapClient', () => {
  let transport: ReturnType<typeof createMockTransport>;
  let framer: DapFramer;
  let client: DapClient;

  beforeEach(() => {
    transport = createMockTransport();
    framer = new DapFramer();
    client = new DapClient({ transport });
  });

  afterEach(() => {
    client.dispose();
  });

  describe('initialize', () => {
    it('should send initialize request and store capabilities', async () => {
      const promise = client.initialize({
        clientID: 'agentic-debugger',
        adapterID: 'test',
      });

      respondTo(transport, framer, {
        body: {
          supportsConfigurationDoneRequest: true,
          supportsFunctionBreakpoints: true,
        },
      });

      const result = await promise;
      expect(result.success).toBe(true);
      expect(client.getCapabilities()).toEqual({
        supportsConfigurationDoneRequest: true,
        supportsFunctionBreakpoints: true,
      });
    });

    it('should store empty capabilities when body is undefined', async () => {
      const promise = client.initialize({
        clientID: 'test',
        adapterID: 'test',
      });

      respondTo(transport, framer, { body: undefined });

      await promise;
      expect(client.getCapabilities()).toEqual({});
    });
  });

  describe('launch', () => {
    it('should send launch request with typed arguments', async () => {
      const promise = client.launch({ noDebug: false });

      const sentData = (transport.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Buffer;
      const parsed = framer.unframe(sentData)[0]!;
      expect((parsed as { command: string }).command).toBe('launch');
      expect((parsed as { arguments: unknown }).arguments).toEqual({ noDebug: false });

      respondTo(transport, framer);
      const result = await promise;
      expect(result.success).toBe(true);
    });
  });

  describe('attach', () => {
    it('should send attach request with typed arguments', async () => {
      const promise = client.attach({ __restart: 'session-1' });

      const sentData = (transport.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Buffer;
      const parsed = framer.unframe(sentData)[0]!;
      expect((parsed as { command: string }).command).toBe('attach');

      respondTo(transport, framer);
      const result = await promise;
      expect(result.success).toBe(true);
    });
  });

  describe('disconnect', () => {
    it('should send disconnect request with optional restart flag', async () => {
      const promise = client.disconnect({ restart: true });

      const sentData = (transport.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Buffer;
      const parsed = framer.unframe(sentData)[0]!;
      expect((parsed as { command: string }).command).toBe('disconnect');
      expect((parsed as { arguments: unknown }).arguments).toEqual({ restart: true });

      respondTo(transport, framer);
      const result = await promise;
      expect(result.success).toBe(true);
    });

    it('should send disconnect without arguments when none provided', async () => {
      const promise = client.disconnect();

      const sentData = (transport.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Buffer;
      const parsed = framer.unframe(sentData)[0]!;
      expect((parsed as { command: string }).command).toBe('disconnect');
      expect(parsed).not.toHaveProperty('arguments');

      respondTo(transport, framer);
      await promise;
    });
  });

  describe('execution control', () => {
    it('should send continue request with threadId', async () => {
      const promise = client.continue({ threadId: 1 });

      const sentData = (transport.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Buffer;
      const parsed = framer.unframe(sentData)[0]!;
      expect((parsed as { command: string }).command).toBe('continue');
      expect((parsed as { arguments: unknown }).arguments).toEqual({ threadId: 1 });

      respondTo(transport, framer, { body: { allThreadsContinued: true } });
      const result = await promise;
      expect(result.success).toBe(true);
    });
  });

  describe('inspection', () => {
    it('should send stackTrace request and return frames', async () => {
      const promise = client.stackTrace({ threadId: 1 });

      const sentData = (transport.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Buffer;
      const parsed = framer.unframe(sentData)[0]!;
      expect((parsed as { command: string }).command).toBe('stackTrace');

      respondTo(transport, framer, {
        body: {
          stackFrames: [{ id: 0, name: 'main', line: 1, column: 0 }],
          totalFrames: 1,
        },
      });

      const result = await promise;
      expect(result.success).toBe(true);
      expect((result.body as { totalFrames: number }).totalFrames).toBe(1);
    });
  });

  describe('events', () => {
    it('should pass through events from the router', () => {
      const handler = vi.fn();
      client.onEvent('stopped', handler);

      const event: DapEvent = {
        seq: 5,
        type: 'event',
        event: 'stopped',
        body: { reason: 'breakpoint', threadId: 1 },
      };
      transport.simulateMessage(framer.frame(event));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event);
    });
  });

  describe('dispose', () => {
    it('should clean up router, transport, and framer', () => {
      client.dispose();

      expect(transport.close).toHaveBeenCalledTimes(1);
    });

    it('should reject pending requests after dispose', async () => {
      const promise = client.sendRequest('evaluate', { expression: '1+1' });

      client.dispose();

      await expect(promise).rejects.toThrow('Router disposed');
    });
  });

  describe('navigation', () => {
    it('should send gotoTargets request', async () => {
      const promise = client.gotoTargets({
        source: { path: '/test.ts' },
        line: 10,
      });

      const sentData = (transport.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Buffer;
      const parsed = framer.unframe(sentData)[0]!;
      expect((parsed as { command: string }).command).toBe('gotoTargets');

      respondTo(transport, framer, {
        body: { targets: [{ id: 1, label: 'line 10', line: 10 }] },
      });

      const result = await promise;
      expect(result.success).toBe(true);
    });
  });
});

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DapRouter } from '../../../src/dap/router.js';
import { DapFramer } from '../../../src/dap/framer.js';
import { DapTimeoutError, DapProtocolError } from '../../../src/dap/types.js';
import type { DapResponse, DapEvent, DapMessage, DapRequest } from '../../../src/dap/types.js';
import type { Transport } from '../../../src/dap/transport/types.js';
import type { DataHandler, CloseHandler, ErrorHandler } from '../../../src/dap/transport/types.js';

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

describe('DapRouter', () => {
  let transport: ReturnType<typeof createMockTransport>;
  let framer: DapFramer;
  let router: DapRouter;

  beforeEach(() => {
    vi.useFakeTimers();
    transport = createMockTransport();
    framer = new DapFramer();
    router = new DapRouter(transport, framer);
  });

  afterEach(() => {
    router.dispose();
    vi.useRealTimers();
  });

  describe('sendRequest', () => {
    it('should assign monotonically increasing seq numbers', () => {
      const p1 = router.sendRequest('initialize').catch(() => {});
      const p2 = router.sendRequest('launch').catch(() => {});
      const p3 = router.sendRequest('setBreakpoints').catch(() => {});

      expect(transport.send).toHaveBeenCalledTimes(3);

      const calls = (transport.send as ReturnType<typeof vi.fn>).mock.calls;
      const messages = calls.map((call: [Buffer]) => {
        const parsed = framer.unframe(call[0]);
        return parsed[0];
      });

      expect(messages[0]!.seq).toBe(1);
      expect(messages[1]!.seq).toBe(2);
      expect(messages[2]!.seq).toBe(3);

      // Suppress unhandled rejections from dispose
      void p1;
      void p2;
      void p3;
    });

    it('should frame the request and send via transport', () => {
      const pending = router.sendRequest('initialize', { clientID: 'test' }).catch(() => {});

      expect(transport.send).toHaveBeenCalledTimes(1);

      const sentData = (transport.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Buffer;
      const parsed = framer.unframe(sentData);

      expect(parsed).toHaveLength(1);
      expect(parsed[0]).toEqual({
        seq: 1,
        type: 'request',
        command: 'initialize',
        arguments: { clientID: 'test' },
      });

      void pending;
    });

    it('should omit arguments field when args is undefined', () => {
      const pending = router.sendRequest('disconnect').catch(() => {});

      const sentData = (transport.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Buffer;
      const parsed = framer.unframe(sentData);

      expect(parsed[0]).toEqual({
        seq: 1,
        type: 'request',
        command: 'disconnect',
      });
      expect(parsed[0]).not.toHaveProperty('arguments');

      void pending;
    });

    it('should resolve when a matching success response arrives', async () => {
      const promise = router.sendRequest('initialize');

      const response: DapResponse = {
        seq: 1,
        type: 'response',
        request_seq: 1,
        success: true,
        command: 'initialize',
        body: { supportsConfigurationDoneRequest: true },
      };

      transport.simulateMessage(framer.frame(response));

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.body).toEqual({ supportsConfigurationDoneRequest: true });
    });

    it('should reject with DapProtocolError when error response arrives', async () => {
      const promise = router.sendRequest('evaluate');

      const response: DapResponse = {
        seq: 1,
        type: 'response',
        request_seq: 1,
        success: false,
        command: 'evaluate',
        message: 'Variable not found',
      };

      transport.simulateMessage(framer.frame(response));

      await expect(promise).rejects.toThrow(DapProtocolError);
      await expect(promise).rejects.toThrow("DAP error for 'evaluate': Variable not found");
    });
  });

  describe('whenIdle', () => {
    it('resolves immediately when no requests are pending', async () => {
      await expect(router.whenIdle()).resolves.toBeUndefined();
    });

    it('waits for pending requests to settle', async () => {
      const request = router.sendRequest('disconnect');
      let settled = false;
      const idle = router.whenIdle().then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);

      transport.simulateMessage(
        framer.frame({
          seq: 1,
          type: 'response',
          request_seq: 1,
          success: true,
          command: 'disconnect',
        }),
      );

      await request;
      await idle;
      expect(settled).toBe(true);
    });
  });

  describe('timeout', () => {
    it('should reject with DapTimeoutError after configured timeout', async () => {
      const promise = router.sendRequest('initialize');

      vi.advanceTimersByTime(10_000);

      await expect(promise).rejects.toThrow(DapTimeoutError);
      await expect(promise).rejects.toThrow("DAP request 'initialize' timed out after 10000ms");
    });

    it('should use custom timeout from config', async () => {
      const customRouter = new DapRouter(transport, framer, { requestTimeoutMs: 5000 });
      const promise = customRouter.sendRequest('launch');

      vi.advanceTimersByTime(4999);

      const response: DapResponse = {
        seq: 1,
        type: 'response',
        request_seq: 1,
        success: true,
        command: 'launch',
      };
      transport.simulateMessage(framer.frame(response));

      const result = await promise;
      expect(result.success).toBe(true);

      customRouter.dispose();
    });

    it('should not timeout if response arrives before deadline', async () => {
      const promise = router.sendRequest('initialize');

      vi.advanceTimersByTime(5000);

      const response: DapResponse = {
        seq: 1,
        type: 'response',
        request_seq: 1,
        success: true,
        command: 'initialize',
      };
      transport.simulateMessage(framer.frame(response));

      const result = await promise;
      expect(result.success).toBe(true);
    });
  });

  describe('handleMessage', () => {
    it('should correlate responses via request_seq', async () => {
      const promise1 = router.sendRequest('initialize');
      const promise2 = router.sendRequest('launch');

      const response2: DapResponse = {
        seq: 2,
        type: 'response',
        request_seq: 2,
        success: true,
        command: 'launch',
      };
      const response1: DapResponse = {
        seq: 3,
        type: 'response',
        request_seq: 1,
        success: true,
        command: 'initialize',
      };

      transport.simulateMessage(framer.frame(response2));
      transport.simulateMessage(framer.frame(response1));

      const result1 = await promise1;
      const result2 = await promise2;

      expect(result1.command).toBe('initialize');
      expect(result2.command).toBe('launch');
    });

    it('should ignore responses with no matching pending request', () => {
      const response: DapResponse = {
        seq: 99,
        type: 'response',
        request_seq: 999,
        success: true,
        command: 'unknown',
      };

      expect(() => {
        router.handleMessage(response);
      }).not.toThrow();
    });
  });

  describe('onEvent', () => {
    it('should dispatch events to registered handlers', () => {
      const handler = vi.fn();
      router.onEvent('stopped', handler);

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

    it('should dispatch to multiple handlers for the same event type', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      router.onEvent('output', handler1);
      router.onEvent('output', handler2);

      const event: DapEvent = {
        seq: 10,
        type: 'event',
        event: 'output',
        body: { category: 'console', output: 'hello\n' },
      };

      transport.simulateMessage(framer.frame(event));

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it('should not dispatch events to handlers for different event types', () => {
      const stoppedHandler = vi.fn();
      router.onEvent('stopped', stoppedHandler);

      const event: DapEvent = {
        seq: 7,
        type: 'event',
        event: 'terminated',
      };

      transport.simulateMessage(framer.frame(event));

      expect(stoppedHandler).not.toHaveBeenCalled();
    });
  });

  describe('reverse requests', () => {
    it('should dispatch reverse requests to registered handlers', () => {
      const handler = vi.fn().mockReturnValue({
        seq: 0,
        type: 'response',
        request_seq: 10,
        command: 'runInTerminal',
        success: true,
        body: { shellProcessId: 1234 },
      });
      router.onReverseRequest('runInTerminal', handler);

      const request: DapRequest = {
        seq: 10,
        type: 'request',
        command: 'runInTerminal',
        arguments: { kind: 'integrated', cwd: '/tmp' },
      };

      transport.simulateMessage(framer.frame(request as DapMessage));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(request);
      // Verify a response was sent back
      expect(transport.send).toHaveBeenCalledTimes(1);
    });

    it('should handle the vsdbg handshake reverse request automatically', () => {
      const request: DapRequest = {
        seq: 2,
        type: 'request',
        command: 'handshake',
        arguments: { value: 'GQhO6vy/TestChallenge==' },
      };

      transport.simulateMessage(framer.frame(request as DapMessage));

      // Verify a response was sent
      expect(transport.send).toHaveBeenCalledTimes(1);

      // Parse the response that was sent
      const sentData = (transport.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Buffer;
      const parsed = framer.unframe(sentData);
      expect(parsed).toHaveLength(1);

      const response = parsed[0] as DapResponse;
      expect(response.type).toBe('response');
      expect(response.request_seq).toBe(2);
      expect(response.command).toBe('handshake');
      expect(response.success).toBe(true);
      expect(response.body).toEqual({ signature: 'GQhO6vy/TestChallenge==' });
    });

    it('should silently ignore reverse requests with no registered handler', () => {
      const request: DapRequest = {
        seq: 5,
        type: 'request',
        command: 'unknownReverse',
      };

      expect(() => {
        transport.simulateMessage(framer.frame(request as DapMessage));
      }).not.toThrow();

      // No response should be sent for unhandled reverse requests
      expect(transport.send).not.toHaveBeenCalled();
    });

    it('should allow overriding the built-in handshake handler', () => {
      const customHandler = vi.fn().mockReturnValue({
        seq: 0,
        type: 'response',
        request_seq: 3,
        command: 'handshake',
        success: true,
        body: { signature: 'custom-response' },
      });
      router.onReverseRequest('handshake', customHandler);

      const request: DapRequest = {
        seq: 3,
        type: 'request',
        command: 'handshake',
        arguments: { value: 'challenge123' },
      };

      transport.simulateMessage(framer.frame(request as DapMessage));

      expect(customHandler).toHaveBeenCalledTimes(1);
      expect(transport.send).toHaveBeenCalledTimes(1);

      const sentData = (transport.send as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Buffer;
      const parsed = framer.unframe(sentData);
      const response = parsed[0] as DapResponse;
      expect(response.body).toEqual({ signature: 'custom-response' });
    });

    it('should not confuse reverse requests with pending outbound request responses', async () => {
      // Send an outbound request (seq=1)
      const promise = router.sendRequest('initialize');

      // Receive a reverse request from the adapter (should not resolve the pending request)
      const reverseRequest: DapRequest = {
        seq: 2,
        type: 'request',
        command: 'handshake',
        arguments: { value: 'test' },
      };
      transport.simulateMessage(framer.frame(reverseRequest as DapMessage));

      // The outbound request should still be pending
      // Now send the actual response
      const response: DapResponse = {
        seq: 3,
        type: 'response',
        request_seq: 1,
        success: true,
        command: 'initialize',
        body: { supportsConfigurationDoneRequest: true },
      };
      transport.simulateMessage(framer.frame(response));

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.command).toBe('initialize');
    });
  });

  describe('dispose', () => {
    it('should reject all pending requests with dispose error', async () => {
      const promise1 = router.sendRequest('initialize');
      const promise2 = router.sendRequest('launch');

      router.dispose();

      await expect(promise1).rejects.toThrow('Router disposed');
      await expect(promise2).rejects.toThrow('Router disposed');
    });

    it('should clear event handlers after dispose', () => {
      const handler = vi.fn();
      router.onEvent('stopped', handler);

      router.dispose();

      const event: DapEvent = {
        seq: 1,
        type: 'event',
        event: 'stopped',
        body: { reason: 'breakpoint' },
      };

      router.handleMessage(event);

      expect(handler).not.toHaveBeenCalled();
    });
  });
});

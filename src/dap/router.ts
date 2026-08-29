import type { Transport } from './transport/types.js';
import { DapFramer } from './framer.js';
import { DapTimeoutError, DapProtocolError } from './types.js';
import type {
  DapEvent,
  DapEventHandler,
  DapMessage,
  DapRequest,
  DapResponse,
  DapReverseRequestHandler,
  DapTimeoutConfig,
} from './types.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

/** Pending request entry tracked for response correlation. */
interface PendingRequest {
  readonly command: string;
  readonly resolve: (response: DapResponse) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

/**
 * DAP message router handling request-response correlation and event dispatch.
 *
 * The router sits between the framer and the high-level DapClient. It:
 * - Assigns sequence numbers to outgoing requests
 * - Correlates incoming responses to pending requests via `request_seq`
 * - Dispatches incoming events to registered event handlers
 * - Manages request timeouts
 */
export class DapRouter {
  private seq = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly idleWaiters = new Set<() => void>();
  private readonly eventHandlers = new Map<string, DapEventHandler[]>();
  private readonly reverseRequestHandlers = new Map<string, DapReverseRequestHandler>();
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly transport: Transport,
    private readonly framer: DapFramer,
    timeoutConfig?: DapTimeoutConfig,
  ) {
    this.requestTimeoutMs = timeoutConfig?.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

    this.transport.onMessage((data: Buffer) => {
      const messages = this.framer.unframe(data);
      for (const message of messages) {
        this.handleMessage(message);
      }
    });

    // Built-in handler for vsdbg handshake reverse request.
    // After initialize, vsdbg sends a challenge value that the client must echo back.
    this.onReverseRequest('handshake', (request) => {
      const args = (request.arguments ?? {}) as Record<string, unknown>;
      const challengeValue = args['value'];
      return {
        seq: 0, // seq is overwritten by sendResponse
        type: 'response',
        request_seq: request.seq,
        command: request.command,
        success: true,
        body: { signature: challengeValue },
      };
    });
  }

  /**
   * Send a DAP request and wait for its response.
   *
   * @param command - The DAP command name.
   * @param args - Command-specific arguments.
   * @returns The DAP response for the request.
   */
  sendRequest(command: string, args?: unknown): Promise<DapResponse> {
    const seqNum = this.seq++;

    const request: DapRequest = {
      seq: seqNum,
      type: 'request',
      command,
      ...(args !== undefined && { arguments: args }),
    };

    return new Promise<DapResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(seqNum);
        reject(new DapTimeoutError(command, this.requestTimeoutMs));
        this.notifyIdle();
      }, this.requestTimeoutMs);

      this.pending.set(seqNum, { command, resolve, reject, timeout });

      const framed = this.framer.frame(request);
      this.transport.send(framed);
    });
  }

  /** Resolve once all currently pending requests have received responses or timed out. */
  whenIdle(): Promise<void> {
    if (this.pending.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  /**
   * Send a DAP response back to the adapter (for reverse requests).
   *
   * @param response - The DAP response to send.
   */
  sendResponse(response: DapResponse): void {
    const seqNum = this.seq++;
    const framedResponse: DapResponse = {
      ...response,
      seq: seqNum,
    };
    const framed = this.framer.frame(framedResponse);
    this.transport.send(framed);
  }

  /**
   * Register a handler for a specific DAP reverse request command.
   *
   * Reverse requests are sent by the debug adapter back to the client.
   * Common examples include vsdbg's "handshake" and "runInTerminal".
   *
   * @param command - The reverse request command name.
   * @param handler - Callback that must return a DAP response.
   */
  onReverseRequest(command: string, handler: DapReverseRequestHandler): void {
    this.reverseRequestHandlers.set(command, handler);
  }

  /**
   * Register a handler for a specific DAP event type.
   *
   * @param eventType - The event type to listen for (e.g., "stopped", "output").
   * @param handler - Callback invoked when the event is received.
   */
  onEvent(eventType: string, handler: DapEventHandler): void {
    const handlers = this.eventHandlers.get(eventType) ?? [];
    handlers.push(handler);
    this.eventHandlers.set(eventType, handlers);
  }

  /**
   * Process an incoming DAP message (called by the framer pipeline).
   *
   * Routes responses to their pending request and dispatches events
   * to registered handlers.
   *
   * @param message - The parsed DAP message.
   */
  handleMessage(message: DapMessage): void {
    if (message.type === 'response') {
      const response = message as DapResponse;
      const entry = this.pending.get(response.request_seq);
      if (!entry) {
        return;
      }

      clearTimeout(entry.timeout);
      this.pending.delete(response.request_seq);

      if (response.success) {
        entry.resolve(response);
      } else {
        entry.reject(
          new DapProtocolError(
            response.command,
            response.message ?? 'Unknown error',
            response.request_seq,
          ),
        );
      }
      this.notifyIdle();
      return;
    }

    if (message.type === 'request') {
      const request = message as DapRequest;
      const handler = this.reverseRequestHandlers.get(request.command);
      if (handler) {
        const result = handler(request);
        if (result instanceof Promise) {
          result
            .then((response) => this.sendResponse(response))
            .catch(() => {
              // Send an error response if the handler rejects
              this.sendResponse({
                seq: 0,
                type: 'response',
                request_seq: request.seq,
                command: request.command,
                success: false,
                message: 'Reverse request handler failed',
              });
            });
        } else {
          this.sendResponse(result);
        }
      }
      return;
    }

    if (message.type === 'event') {
      const event = message as DapEvent;
      const handlers = this.eventHandlers.get(event.event);
      if (handlers) {
        for (const handler of handlers) {
          handler(event);
        }
      }
    }
  }

  /**
   * Cancel all pending requests and clean up resources.
   */
  dispose(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timeout);
      entry.reject(new Error('Router disposed'));
    }
    this.pending.clear();
    this.notifyIdle();
    this.eventHandlers.clear();
    this.reverseRequestHandlers.clear();
  }

  private notifyIdle(): void {
    if (this.pending.size !== 0) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
  }
}

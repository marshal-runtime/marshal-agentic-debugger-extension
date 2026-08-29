/**
 * DAP message types as defined by the Debug Adapter Protocol.
 * These complement the types from @vscode/debugprotocol with
 * application-specific extensions.
 */

/** The three DAP message categories. */
export type DapMessageType = 'request' | 'response' | 'event';

/** Base shape of a DAP protocol message. */
export interface DapMessage {
  /** Sequence number for request-response correlation. */
  readonly seq: number;
  /** Message category: request, response, or event. */
  readonly type: DapMessageType;
}

/** A DAP request message sent from client to adapter. */
export interface DapRequest extends DapMessage {
  readonly type: 'request';
  /** The DAP command name (e.g., "initialize", "setBreakpoints"). */
  readonly command: string;
  /** Command-specific arguments. */
  readonly arguments?: unknown;
}

/** A DAP response message sent from adapter to client. */
export interface DapResponse extends DapMessage {
  readonly type: 'response';
  /** Sequence number of the corresponding request. */
  readonly request_seq: number;
  /** Whether the request was successful. */
  readonly success: boolean;
  /** The DAP command this response is for. */
  readonly command: string;
  /** Response body with command-specific data. */
  readonly body?: unknown;
  /** Error message if success is false. */
  readonly message?: string;
}

/** A DAP event message sent asynchronously from adapter to client. */
export interface DapEvent extends DapMessage {
  readonly type: 'event';
  /** The event type (e.g., "stopped", "output", "terminated"). */
  readonly event: string;
  /** Event-specific data. */
  readonly body?: unknown;
}

/** Handler function for DAP events. */
export type DapEventHandler = (event: DapEvent) => void;

/** Handler function for DAP reverse requests (sent from adapter to client). */
export type DapReverseRequestHandler = (request: DapRequest) => DapResponse | Promise<DapResponse>;

/** Timeout configuration for DAP operations. */
export interface DapTimeoutConfig {
  /** Timeout for the initialize handshake in milliseconds. */
  readonly initializeTimeoutMs?: number;
  /** Default timeout for DAP requests in milliseconds. */
  readonly requestTimeoutMs?: number;
  /** Timeout for detecting adapter crashes in milliseconds. */
  readonly crashDetectionMs?: number;
}

/** Error thrown when a DAP request times out. */
export class DapTimeoutError extends Error {
  constructor(
    readonly command: string,
    readonly timeoutMs: number,
  ) {
    super(
      `DAP request '${command}' timed out after ${timeoutMs}ms. ` +
        `The debug adapter did not respond in time. ` +
        `Increase the timeout or check that the adapter process is responsive.`,
    );
    this.name = 'DapTimeoutError';
  }
}

/** Error thrown when the DAP adapter returns an error response. */
export class DapProtocolError extends Error {
  constructor(
    readonly command: string,
    readonly dapMessage: string,
    readonly requestSeq: number,
  ) {
    super(
      `DAP error for '${command}': ${dapMessage}. ` +
        `The debug adapter rejected the request. ` +
        `Verify the command arguments and adapter compatibility.`,
    );
    this.name = 'DapProtocolError';
  }
}

/** Error thrown when DAP message framing is invalid. */
export class DapFramingError extends Error {
  constructor(message: string) {
    super(
      `${message}. ` +
        `The data from the debug adapter is malformed. ` +
        `Ensure the adapter sends valid DAP-framed messages.`,
    );
    this.name = 'DapFramingError';
  }
}

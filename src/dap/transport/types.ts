/** Callback for receiving raw data from a transport. */
export type DataHandler = (data: Buffer) => void;

/** Callback for transport close events. */
export type CloseHandler = (hadError: boolean) => void;

/** Callback for transport error events. */
export type ErrorHandler = (error: Error) => void;

/** Options for establishing a transport connection. */
export interface TransportConnectOptions {
  /** Timeout in milliseconds for the connection attempt. */
  readonly timeoutMs?: number;
}

/**
 * Abstract transport interface for DAP communication.
 *
 * Implementations provide the raw byte-level I/O channel over which
 * Content-Length framed DAP messages are exchanged. The two built-in
 * transports are stdio (child process pipes) and TCP sockets.
 */
export interface Transport {
  /** Whether the transport is currently connected. */
  readonly connected: boolean;

  /**
   * Open the transport connection.
   *
   * @param options - Optional connection parameters.
   */
  connect(options?: TransportConnectOptions): Promise<void>;

  /**
   * Send raw bytes over the transport.
   *
   * @param data - The data buffer to send.
   */
  send(data: Buffer): void;

  /**
   * Register a handler for incoming data.
   *
   * @param handler - Callback invoked with each received data buffer.
   */
  onMessage(handler: DataHandler): void;

  /**
   * Register a handler for transport close events.
   *
   * @param handler - Callback invoked when the transport closes.
   */
  onClose(handler: CloseHandler): void;

  /**
   * Register a handler for transport errors.
   *
   * @param handler - Callback invoked on transport-level errors.
   */
  onError(handler: ErrorHandler): void;

  /**
   * Shut down the transport and release resources.
   */
  close(): void;
}

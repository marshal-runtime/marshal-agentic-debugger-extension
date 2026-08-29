import { Socket } from 'node:net';

import { createLogger, type Logger } from '../../logging/index.js';

import type {
  CloseHandler,
  DataHandler,
  ErrorHandler,
  Transport,
  TransportConnectOptions,
} from './types.js';

/** Default TCP connection timeout in milliseconds. */
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

/** Options for connecting to a debug adapter over TCP. */
export interface TcpTransportOptions {
  /** Hostname or IP address of the adapter. */
  readonly host: string;
  /** TCP port number the adapter is listening on. */
  readonly port: number;
}

/**
 * TCP socket-based DAP transport.
 *
 * Connects to a debug adapter listening on a TCP port. Used for
 * remote attach scenarios or adapters that expose a TCP endpoint
 * instead of stdio.
 */
export class TcpTransport implements Transport {
  private socket: Socket | undefined;
  private readonly logger: Logger;

  private dataHandler: DataHandler | undefined;
  private closeHandler: CloseHandler | undefined;
  private errorHandler: ErrorHandler | undefined;

  private _connected = false;

  constructor(private readonly options: TcpTransportOptions) {
    this.logger = createLogger({ name: 'TcpTransport' });
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(options?: TransportConnectOptions): Promise<void> {
    if (this._connected) {
      return;
    }

    const timeoutMs = options?.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;

    return new Promise<void>((resolve, reject) => {
      const socket = new Socket();
      this.socket = socket;

      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`TCP connection to ${this.options.host}:${this.options.port} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      socket.connect(this.options.port, this.options.host, () => {
        clearTimeout(timer);
        this._connected = true;
        socket.setKeepAlive(true);
        this.logger.debug('connected to adapter', {
          host: this.options.host,
          port: this.options.port,
        });
        resolve();
      });

      socket.on('data', (chunk: Buffer) => {
        this.dataHandler?.(chunk);
      });

      socket.on('close', (hadError: boolean) => {
        const wasConnected = this._connected;
        this._connected = false;
        if (wasConnected) {
          this.logger.debug('socket closed', { hadError });
          this.closeHandler?.(hadError);
        }
      });

      socket.on('error', (err: Error) => {
        clearTimeout(timer);
        if (!this._connected) {
          reject(err);
          return;
        }
        this.logger.error('socket error', { error: err.message });
        this.errorHandler?.(err);
      });
    });
  }

  send(data: Buffer): void {
    if (!this._connected || !this.socket || this.socket.destroyed) {
      throw new Error('Transport is not connected');
    }
    this.socket.write(data);
  }

  onMessage(handler: DataHandler): void {
    this.dataHandler = handler;
  }

  onClose(handler: CloseHandler): void {
    this.closeHandler = handler;
  }

  onError(handler: ErrorHandler): void {
    this.errorHandler = handler;
  }

  close(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = undefined;
    }
    this._connected = false;
  }
}

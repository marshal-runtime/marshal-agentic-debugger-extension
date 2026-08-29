import { spawn, type ChildProcess } from 'node:child_process';

import { createLogger, type Logger } from '../../logging/index.js';

import type {
  CloseHandler,
  DataHandler,
  ErrorHandler,
  Transport,
  TransportConnectOptions,
} from './types.js';

/** Options for spawning a debug adapter process over stdio. */
export interface StdioTransportOptions {
  /** Path to the debug adapter executable. */
  readonly command: string;
  /** Arguments to pass to the adapter process. */
  readonly args?: readonly string[];
  /** Working directory for the adapter process. */
  readonly cwd?: string;
  /** Environment variables for the adapter process. */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * Stdio-based DAP transport.
 *
 * Spawns a debug adapter as a child process and communicates over
 * stdin/stdout pipes. This is the most common transport for local
 * debug adapters (js-debug, debugpy, netcoredbg).
 */
export class StdioTransport implements Transport {
  private process: ChildProcess | undefined;
  private readonly logger: Logger;

  private dataHandler: DataHandler | undefined;
  private closeHandler: CloseHandler | undefined;
  private errorHandler: ErrorHandler | undefined;

  private _connected = false;

  constructor(private readonly options: StdioTransportOptions) {
    this.logger = createLogger({ name: 'StdioTransport' });
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(_options?: TransportConnectOptions): Promise<void> {
    if (this._connected) {
      return;
    }

    const child = spawn(this.options.command, this.options.args?.slice() ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.options.cwd,
      env: this.options.env ? { ...process.env, ...this.options.env } : undefined,
    });

    this.process = child;

    child.stdout?.on('data', (chunk: Buffer) => {
      this.dataHandler?.(chunk);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8').trimEnd();
      if (text.length > 0) {
        this.logger.warn('adapter stderr', { output: text });
      }
    });

    child.on('error', (err: Error) => {
      this._connected = false;
      this.errorHandler?.(err);
    });

    child.on('close', (code: number | null, signal: string | null) => {
      const wasConnected = this._connected;
      this._connected = false;
      if (wasConnected) {
        this.logger.debug('adapter process exited', { code, signal });
        this.closeHandler?.(code !== 0);
      }
    });

    this._connected = true;
    this.logger.debug('spawned adapter process', {
      command: this.options.command,
      pid: child.pid,
    });
  }

  send(data: Buffer): void {
    if (!this._connected || !this.process?.stdin?.writable) {
      throw new Error('Transport is not connected');
    }
    this.process.stdin.write(data);
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
    if (this.process) {
      // Close stdio pipes but don't kill the adapter process.
      // For CLR debugging, the adapter needs to stay alive briefly
      // after detach to prevent COM RCW cleanup from crashing the debuggee.
      try { this.process.stdin?.end(); } catch { /* ignore */ }
      try { this.process.stdout?.destroy(); } catch { /* ignore */ }
      try { this.process.stderr?.destroy(); } catch { /* ignore */ }
      this.process.unref();
      this.process = undefined;
    }
    this._connected = false;
  }
}

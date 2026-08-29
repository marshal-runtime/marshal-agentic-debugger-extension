import type { ChildProcess } from 'node:child_process';

import type { AdapterType, AdapterConfig, LanguageId } from '../types/adapter.js';
import { DapClient } from '../dap/client.js';
import { StdioTransport } from '../dap/transport/stdio.js';
import type { Transport } from '../dap/transport/types.js';
import { createLogger, type Logger } from '../logging/index.js';

import type { AdapterCapabilities, AttachOptions, IAdapter, LaunchOptions } from './types.js';

/** Crash detection window in milliseconds. */
const CRASH_DETECTION_MS = 500;

/** Abstract base class for all debug adapters with lifecycle management. */
export abstract class BaseAdapter implements IAdapter {
  abstract readonly type: AdapterType;
  abstract readonly languages: readonly LanguageId[];

  protected client: DapClient | undefined;
  protected transport: Transport | undefined;
  protected adapterProcess: ChildProcess | undefined;
  protected readonly logger: Logger;

  private spawnTimestamp: number | undefined;
  private disposed = false;

  constructor() {
    this.logger = createLogger({ name: this.constructor.name });
  }

  /** Returns the command to start the debug adapter process. */
  protected abstract getCommand(): string;

  /** Returns command-line arguments for a launch session. */
  protected abstract getLaunchArgs(config: AdapterConfig, options: LaunchOptions): readonly string[];

  /** Returns command-line arguments for an attach session. */
  protected abstract getAttachArgs(config: AdapterConfig, options: AttachOptions): readonly string[];

  /** Returns the adapter's declared capabilities. */
  abstract getCapabilities(): AdapterCapabilities;

  /** Launch a debug target. Subclasses may override for adapter-specific logic. */
  abstract launch(config: AdapterConfig, options: LaunchOptions): Promise<void>;

  /** Attach to a running debug target. Subclasses may override for adapter-specific logic. */
  abstract attach(config: AdapterConfig, options: AttachOptions): Promise<void>;

  /** Terminate the debug session via DAP. */
  async terminate(): Promise<void> {
    if (this.client) {
      await this.client.sendRequest('terminate');
    }
  }

  /** Send a DAP disconnect request. */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.disconnect({ terminateDebuggee: false });
    }
  }

  /**
   * Spawn the debug adapter process and create a StdioTransport connected to it.
   *
   * The spawned process communicates via stdin/stdout pipes using the
   * Content-Length framed DAP protocol.
   */
  protected async spawn(args?: readonly string[], cwd?: string): Promise<void> {
    if (this.disposed) {
      throw new Error('Adapter has been disposed');
    }

    const command = this.getCommand();
    const spawnArgs = args ?? [];

    this.logger.debug('spawning adapter process', { command, args: spawnArgs });

    this.transport = new StdioTransport({
      command,
      args: spawnArgs,
      cwd,
    });

    await this.transport.connect();

    this.spawnTimestamp = Date.now();
    this.monitorProcess();
  }

  /**
   * Create a DapClient wired to the current transport.
   *
   * Wiring chain: StdioTransport → DapFramer → DapRouter → DapClient
   * (DapClient internally creates DapFramer and DapRouter)
   */
  protected createClient(): DapClient {
    if (!this.transport) {
      throw new Error('Transport not initialized — call spawn() first');
    }

    this.client = new DapClient({ transport: this.transport });
    return this.client;
  }

  /**
   * Monitor the adapter child process for unexpected exits.
   *
   * If the process exits within the crash detection window (2s),
   * it is treated as a crash and an error is logged.
   */
  private monitorProcess(): void {
    if (!this.transport) {
      return;
    }

    this.transport.onClose((hadError: boolean) => {
      const elapsed = this.spawnTimestamp ? Date.now() - this.spawnTimestamp : Infinity;

      if (elapsed < CRASH_DETECTION_MS) {
        this.logger.error('adapter process crashed during startup', {
          elapsed,
          hadError,
        });
      } else if (!this.disposed) {
        this.logger.warn('adapter process exited unexpectedly', {
          elapsed,
          hadError,
        });
      }
    });

    this.transport.onError((error: Error) => {
      this.logger.error('adapter process error', { error: error.message });
    });
  }

  /** Returns the DapClient created by the adapter, if available. */
  getClient(): DapClient | undefined {
    return this.client;
  }

  /** Kill the child process and clean up all resources. */
  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    this.logger.debug('disposing adapter');

    if (this.client) {
      this.client.dispose();
      this.client = undefined;
    }

    if (this.transport) {
      this.transport.close();
      this.transport = undefined;
    }

    this.adapterProcess = undefined;
  }
}

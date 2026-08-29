import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';

import type { AdapterConfig, LanguageId } from '../../types/adapter.js';
import type { AdapterCapabilities, AttachOptions, LaunchOptions } from '../types.js';
import { BaseAdapter } from '../base-adapter.js';
import {
  DEBUGPY_DEFAULT_HOST,
  DEBUGPY_DEFAULT_PORT,
  DEBUGPY_MODULE,
  resolvePythonBinary,
} from './config.js';

/** Error thrown when the Python interpreter or debugpy module cannot be located. */
export class DebugpyNotFoundError extends Error {
  readonly code = 'ADAPTER_NOT_AVAILABLE' as const;

  constructor(pythonPath: string, reason: string) {
    super(
      `debugpy DAP server not available.\n\n` +
        `Python interpreter: ${pythonPath}\n` +
        `Reason: ${reason}\n\n` +
        `Installation options:\n` +
        `  1. Install debugpy: pip install debugpy\n` +
        `  2. Set AGENTIC_PYTHON_PATH environment variable to the Python interpreter path`,
    );
    this.name = 'DebugpyNotFoundError';
  }
}

/** Debug adapter for Python using debugpy. */
export class DebugpyAdapter extends BaseAdapter {
  readonly type = 'debugpy' as const;
  readonly languages: readonly LanguageId[] = ['python'];

  private resolvedCommand: string | undefined;

  protected override getCommand(): string {
    if (this.resolvedCommand) {
      return this.resolvedCommand;
    }

    const resolved = this.resolvePythonPath();
    this.resolvedCommand = resolved;
    return resolved;
  }

  protected override getLaunchArgs(
    config: AdapterConfig,
    _options: LaunchOptions,
  ): readonly string[] {
    return ['-m', DEBUGPY_MODULE, ...(config.args ?? [])];
  }

  protected override getAttachArgs(
    config: AdapterConfig,
    _options: AttachOptions,
  ): readonly string[] {
    return ['-m', DEBUGPY_MODULE, ...(config.args ?? [])];
  }

  override async launch(config: AdapterConfig, options: LaunchOptions): Promise<void> {
    const args = this.getLaunchArgs(config, options);
    await this.spawn(args, options.cwd);
    this.createClient();

    this.logger.info('debugpy launch session started', {
      program: options.program,
      cwd: options.cwd,
    });
  }

  override async attach(config: AdapterConfig, options: AttachOptions): Promise<void> {
    const args = this.getAttachArgs(config, options);
    await this.spawn(args);
    this.createClient();

    this.logger.info('debugpy attach session started', {
      port: options.port ?? DEBUGPY_DEFAULT_PORT,
      host: options.host ?? DEBUGPY_DEFAULT_HOST,
    });
  }

  override getCapabilities(): AdapterCapabilities {
    return {
      supportsConditionalBreakpoints: true,
      supportsFunctionBreakpoints: true,
      supportsEvaluateForHovers: true,
      supportsSetVariable: true,
      supportsCompletionsRequest: true,
      supportsExceptionInfoRequest: true,
      supportsExceptionOptions: true,
      supportsTerminateRequest: true,
      supportsModulesRequest: true,
      supportsConfigurationDoneRequest: true,
      supportsLogPoints: true,
      supportsHitConditionalBreakpoints: true,
      supportsSetExpression: true,
      supportsTerminateDebuggee: true,
      supportsDelayedStackTraceLoading: true,
      supportsLoadedSourcesRequest: true,
    };
  }

  /**
   * Resolve the Python interpreter and verify debugpy is installed.
   *
   * Resolution precedence:
   * 1. `AGENTIC_PYTHON_PATH` environment variable
   * 2. `python3` on PATH (unix)
   * 3. `python` on PATH (Windows / fallback)
   *
   * After resolving the interpreter, verifies debugpy is available
   * by running `python -m debugpy --version`.
   */
  private resolvePythonPath(): string {
    const pythonBinary = resolvePythonBinary();

    const resolved = this.findOnPath(pythonBinary);
    if (!resolved && !process.env['AGENTIC_PYTHON_PATH']) {
      const fallback = platform() === 'win32' ? 'python3' : 'python';
      const fallbackResolved = this.findOnPath(fallback);
      if (fallbackResolved) {
        this.verifyDebugpy(fallbackResolved);
        this.logger.debug('using Python interpreter from PATH fallback', {
          path: fallbackResolved,
        });
        return fallbackResolved;
      }
      throw new DebugpyNotFoundError(pythonBinary, 'Python interpreter not found on PATH');
    }

    const interpreterPath = resolved ?? pythonBinary;
    this.verifyDebugpy(interpreterPath);
    this.logger.debug('using Python interpreter', { path: interpreterPath });
    return interpreterPath;
  }

  /** Verify that debugpy is installed and importable. */
  private verifyDebugpy(pythonPath: string): void {
    try {
      execFileSync(pythonPath, ['-m', 'debugpy', '--version'], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      throw new DebugpyNotFoundError(
        pythonPath,
        'debugpy module not found — run: pip install debugpy',
      );
    }
  }

  /** Attempt to find an executable on the system PATH. */
  private findOnPath(binary: string): string | undefined {
    const command = platform() === 'win32' ? 'where' : 'which';
    try {
      const result = execFileSync(command, [binary], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const resolved = result.trim().split('\n')[0]?.trim();
      return resolved || undefined;
    } catch {
      return undefined;
    }
  }
}

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';

import type { AdapterConfig, LanguageId } from '../../types/adapter.js';
import type { AdapterCapabilities, AttachOptions, LaunchOptions } from '../types.js';
import { BaseAdapter } from '../base-adapter.js';
import {
  NETCOREDBG_INTERPRETER_FLAG,
  NETCOREDBG_TYPE,
  getCommonInstallPaths,
  resolveNetcoredbgBinary,
} from './config.js';
import { detectDotnetRuntime } from './runtime-detect.js';

/** Error thrown when the netcoredbg binary cannot be located. */
export class NetcoredbgNotFoundError extends Error {
  readonly code = 'ADAPTER_NOT_FOUND' as const;

  constructor(searchedPaths: readonly string[]) {
    const paths = searchedPaths.map((p) => `  - ${p}`).join('\n');
    super(
      `netcoredbg DAP server not found.\n\n` +
        `Searched locations:\n${paths}\n\n` +
        `Installation options:\n` +
        `  1. Download from https://github.com/Samsung/netcoredbg/releases\n` +
        `  2. Install via package manager (e.g., brew install netcoredbg)\n` +
        `  3. Set AGENTIC_NETCOREDBG_PATH environment variable to the binary path`,
    );
    this.name = 'NetcoredbgNotFoundError';
  }
}

/** Error thrown when trying to attach to a .NET Framework process with netcoredbg. */
export class NetFrameworkIncompatibleError extends Error {
  readonly code = 'RUNTIME_INCOMPATIBLE' as const;

  constructor(pid: number, runtimeDescription: string) {
    super(
      `netcoredbg cannot attach to .NET Framework processes.\n\n` +
        `Process ${pid} is running ${runtimeDescription}.\n` +
        `netcoredbg only supports .NET Core / .NET 5+.\n\n` +
        `Workarounds:\n` +
        `  1. Use the vsdbg adapter instead (supports .NET Framework + Core):\n` +
        `     agentic-debugger attach --adapter vsdbg --pid ${pid}\n` +
        `  2. If the app can target .NET 6+, rebuild and retry\n` +
        `  3. Run 'agentic-debugger setup' to download vsdbg`,
    );
    this.name = 'NetFrameworkIncompatibleError';
  }
}

/** Debug adapter for C#/.NET using netcoredbg. */
export class NetcoredbgAdapter extends BaseAdapter {
  readonly type = 'netcoredbg' as const;
  readonly languages: readonly LanguageId[] = ['csharp'];

  private resolvedCommand: string | undefined;

  protected override getCommand(): string {
    if (this.resolvedCommand) {
      return this.resolvedCommand;
    }

    const resolved = this.resolveBinaryPath();
    this.resolvedCommand = resolved;
    return resolved;
  }

  protected override getLaunchArgs(_config: AdapterConfig, _options: LaunchOptions): readonly string[] {
    // Samsung netcoredbg's --interpreter=vscode mode reads the launch config from
    // the DAP launch request body — not from CLI flags. Earlier code passed
    // --type=coreclr / --request=launch / --program=... which netcoredbg rejects
    // with "Unknown option" and exits immediately.
    return [NETCOREDBG_INTERPRETER_FLAG];
  }

  protected override getAttachArgs(_config: AdapterConfig, options: AttachOptions): readonly string[] {
    if (options.processId === undefined) {
      throw new Error('processId is required for netcoredbg attach');
    }
    return [NETCOREDBG_INTERPRETER_FLAG];
  }

  override async launch(config: AdapterConfig, options: LaunchOptions): Promise<void> {
    const args = this.getLaunchArgs(config, options);
    await this.spawn(args, options.cwd);
    this.createClient();

    this.logger.info('netcoredbg launch session started', {
      program: options.program,
      cwd: options.cwd,
    });
  }

  override async attach(config: AdapterConfig, options: AttachOptions): Promise<void> {
    // Check for .NET Framework incompatibility before attempting attach
    if (options.processId !== undefined) {
      const runtime = detectDotnetRuntime(options.processId);
      if (runtime?.isNetFramework) {
        throw new NetFrameworkIncompatibleError(options.processId, runtime.description);
      }
    }

    // Bound the whole flow so a wedged netcoredbg can't hang the daemon.
    const ATTACH_TIMEOUT_MS = 30_000;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`netcoredbg attach timed out after ${ATTACH_TIMEOUT_MS / 1000}s`)),
        ATTACH_TIMEOUT_MS,
      );
    });

    const attachFlow = async (): Promise<void> => {
      const args = this.getAttachArgs(config, options);
      await this.spawn(args);
      const client = this.createClient();

      // Drive the DAP handshake here so callers can treat netcoredbg the same way
      // they treat clr-debug / vsdbg / js-debug — adapter-handled init.
      await client.initialize({
        clientID: 'agentic-debugger',
        clientName: 'Agentic Debugger',
        adapterID: NETCOREDBG_TYPE,
        pathFormat: 'path',
        linesStartAt1: true,
        columnsStartAt1: true,
        supportsRunInTerminalRequest: false,
      });

      await client.attach({
        type: NETCOREDBG_TYPE,
        request: 'attach',
        processId: options.processId!,
        // netcoredbg honors justMyCode; keep it off so we can step into framework code
        // when troubleshooting.
        justMyCode: false,
      } as import('@vscode/debugprotocol').DebugProtocol.AttachRequestArguments);

      await client.configurationDone();

      this.logger.info('netcoredbg attach session started', {
        processId: options.processId,
      });
    };

    await Promise.race([attachFlow(), timeoutPromise]);
  }

  override getCapabilities(): AdapterCapabilities {
    return {
      supportsConditionalBreakpoints: true,
      supportsFunctionBreakpoints: true,
      supportsEvaluateForHovers: true,
      supportsSetVariable: true,
      supportsExceptionInfoRequest: true,
      supportsExceptionOptions: true,
      supportsTerminateRequest: true,
      supportsModulesRequest: true,
      supportsConfigurationDoneRequest: true,
      supportsLogPoints: true,
      supportsHitConditionalBreakpoints: true,
      supportsTerminateDebuggee: true,
      supportsLoadedSourcesRequest: true,
    };
  }

  /**
   * Resolve the netcoredbg binary path using the following precedence:
   *
   * 1. `AGENTIC_NETCOREDBG_PATH` environment variable
   * 2. `netcoredbg` on PATH
   * 3. Common install locations per platform
   */
  private resolveBinaryPath(): string {
    const searchedPaths: string[] = [];

    const envPath = process.env['AGENTIC_NETCOREDBG_PATH'];
    if (envPath) {
      searchedPaths.push(envPath);
      if (existsSync(envPath)) {
        this.logger.debug('using netcoredbg from environment variable', { path: envPath });
        return envPath;
      }
    }

    const binaryName = resolveNetcoredbgBinary();
    const pathResolved = this.findOnPath(binaryName);
    searchedPaths.push(`PATH lookup: ${binaryName}`);
    if (pathResolved) {
      this.logger.debug('using netcoredbg from PATH', { path: pathResolved });
      return pathResolved;
    }

    const commonPaths = getCommonInstallPaths();
    for (const commonPath of commonPaths) {
      searchedPaths.push(commonPath);
      if (existsSync(commonPath)) {
        this.logger.debug('using netcoredbg from common install location', { path: commonPath });
        return commonPath;
      }
    }

    throw new NetcoredbgNotFoundError(searchedPaths);
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

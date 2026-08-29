import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';

import type { AdapterConfig, LanguageId } from '../../types/adapter.js';
import type { AdapterCapabilities, AttachOptions, LaunchOptions } from '../types.js';
import { BaseAdapter } from '../base-adapter.js';
import { resolvePackageRoot } from '../package-root.js';
import {
  VSDBG_BINARY,
  VSDBG_INTERPRETER_FLAG,
  VSDBG_TYPE_CLR,
  VSDBG_TYPE_CORECLR,
  type VsdbgRuntimeType,
} from './config.js';
import { detectDotnetRuntime } from '../netcoredbg/runtime-detect.js';

/** Error thrown when the vsdbg binary cannot be located. */
export class VsdbgNotFoundError extends Error {
  readonly code = 'ADAPTER_NOT_FOUND' as const;

  constructor(searchedPaths: readonly string[]) {
    const paths = searchedPaths.map((p) => `  - ${p}`).join('\n');
    super(
      `vsdbg DAP server not found.\n\n` +
        `Searched locations:\n${paths}\n\n` +
        `Installation options:\n` +
        `  1. Run: agentic-debugger setup  (downloads vsdbg automatically)\n` +
        `  2. Install the C# VS Code extension (ms-dotnettools.csharp)\n` +
        `  3. Set AGENTIC_VSDBG_PATH environment variable to the vsdbg binary path`,
    );
    this.name = 'VsdbgNotFoundError';
  }
}

/**
 * Debug adapter for C#/.NET using Microsoft's vsdbg.
 *
 * vsdbg supports both .NET Framework (CLR) and .NET Core / .NET 5+,
 * making it the universal C# debugger. It uses the same DAP protocol
 * as netcoredbg (--interpreter=vscode).
 */
export class VsdbgAdapter extends BaseAdapter {
  readonly type = 'vsdbg' as const;
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
    // vsdbg only accepts --interpreter=vscode on the CLI.
    // Launch details are sent via DAP launch request body.
    return [VSDBG_INTERPRETER_FLAG];
  }

  protected override getAttachArgs(_config: AdapterConfig, _options: AttachOptions): readonly string[] {
    // vsdbg only accepts --interpreter=vscode on the CLI.
    // Attach details (processId, type) are sent via DAP attach request body.
    return [VSDBG_INTERPRETER_FLAG];
  }

  override async launch(config: AdapterConfig, options: LaunchOptions): Promise<void> {
    const args = this.getLaunchArgs(config, options);
    await this.spawn(args, options.cwd);
    const client = this.createClient();

    // DAP handshake — vsdbg receives everything via DAP, not CLI args.
    // Use 'vscode' clientID for licensing compatibility.
    await client.initialize({
      clientID: 'vscode',
      clientName: 'Visual Studio Code',
      adapterID: VSDBG_TYPE_CORECLR,
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsRunInTerminalRequest: false,
    });

    await client.launch({
      type: VSDBG_TYPE_CORECLR,
      request: 'launch',
      program: options.program,
      cwd: options.cwd ?? process.cwd(),
      args: options.args ?? [],
      justMyCode: false,
      requireExactSource: false,
      symbolOptions: {
        searchPaths: [],
        searchMicrosoftSymbolServer: false,
        searchNuGetOrgSymbolServer: false,
      },
      logging: {
        moduleLoad: false,
      },
    } as import('@vscode/debugprotocol').DebugProtocol.LaunchRequestArguments);

    await client.configurationDone();

    this.logger.info('vsdbg launch session started', {
      program: options.program,
      cwd: options.cwd,
    });
  }

  override async attach(config: AdapterConfig, options: AttachOptions): Promise<void> {
    const processId = options.processId;
    if (processId === undefined) {
      throw new Error('processId is required for vsdbg attach');
    }

    // Detect runtime to choose the correct DAP type (clr vs coreclr)
    const runtimeType = this.detectRuntimeType(processId);

    await this.spawn([VSDBG_INTERPRETER_FLAG]);
    const client = this.createClient();

    // Register event listeners EARLY — before attach/configurationDone —
    // so we capture module load events that vsdbg sends during initialization.
    client.onEvent('output', (event) => {
      const body = (event.body ?? {}) as { output?: string; category?: string };
      if (body.output) {
        this.logger.info('vsdbg output', { category: body.category, output: body.output.trim() });
      }
    });

    // DAP handshake — vsdbg receives attach details via DAP, not CLI args.
    // vsdbg validates the clientID against an allowlist — use 'vscode' to pass
    // the licensing check, since this tool runs within the VS Code ecosystem.
    await client.initialize({
      clientID: 'vscode',
      clientName: 'Visual Studio Code',
      adapterID: runtimeType,
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsRunInTerminalRequest: false,
    });

    await client.attach({
      type: runtimeType,
      request: 'attach',
      processId,
      justMyCode: false,
      requireExactSource: false,
      symbolOptions: {
        searchPaths: this.getSymbolSearchPaths(),
        searchMicrosoftSymbolServer: false,
        searchNuGetOrgSymbolServer: false,
      },
      logging: {
        moduleLoad: true,
        engineLogging: true,
      },
    } as import('@vscode/debugprotocol').DebugProtocol.AttachRequestArguments);

    // Give vsdbg a moment to process module discovery before configurationDone
    await new Promise((resolve) => setTimeout(resolve, 500));

    await client.configurationDone();

    this.logger.info('vsdbg attach session started', {
      processId,
      runtimeType,
    });
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
      supportsClipboardContext: false,
      supportsDataBreakpoints: true,
    };
  }

  /**
   * Detect whether the target process uses .NET Framework or .NET Core
   * and return the appropriate vsdbg DAP type.
   */
  private detectRuntimeType(pid: number): VsdbgRuntimeType {
    const runtime = detectDotnetRuntime(pid);

    if (runtime?.isNetFramework) {
      this.logger.info('.NET Framework runtime detected, using clr type', { pid });
      return VSDBG_TYPE_CLR;
    }

    // Default to coreclr (safe for .NET Core, .NET 5+, and unknown)
    this.logger.debug('using coreclr type (default)', { pid });
    return VSDBG_TYPE_CORECLR;
  }

  /**
   * Get additional symbol search paths from environment variables.
   *
   * Set `AGENTIC_SYMBOL_PATH` to a semicolon-separated list of directories
   * containing PDB files. This is useful when PDBs are not co-located with
   * the loaded assemblies.
   */
  private getSymbolSearchPaths(): string[] {
    const envPaths = process.env['AGENTIC_SYMBOL_PATH'];
    if (envPaths) {
      const paths = envPaths.split(';').filter(Boolean);
      if (paths.length > 0) {
        this.logger.info('using symbol search paths from AGENTIC_SYMBOL_PATH', { paths });
      }
      return paths;
    }
    return [];
  }

  /**
   * Resolve the vsdbg binary path using the following precedence:
   *
   * 1. `AGENTIC_VSDBG_PATH` environment variable
   * 2. Bundled adapter (installed by postinstall script)
   * 3. VS Code C# extension paths
   * 4. Common install locations
   */
  private resolveBinaryPath(): string {
    const searchedPaths: string[] = [];

    // 1. Environment variable
    const envPath = process.env['AGENTIC_VSDBG_PATH'];
    if (envPath) {
      searchedPaths.push(envPath);
      if (existsSync(envPath)) {
        this.logger.debug('using vsdbg from environment variable', { path: envPath });
        return envPath;
      }
    }

    // 2. Bundled adapter (from postinstall download)
    const bundledPath = this.getBundledPath();
    if (bundledPath) {
      searchedPaths.push(bundledPath);
      if (existsSync(bundledPath)) {
        this.logger.debug('using bundled vsdbg', { path: bundledPath });
        return bundledPath;
      }
    }

    // 3. PATH lookup
    const pathResolved = this.findOnPath(VSDBG_BINARY);
    searchedPaths.push(`PATH lookup: ${VSDBG_BINARY}`);
    if (pathResolved) {
      this.logger.debug('using vsdbg from PATH', { path: pathResolved });
      return pathResolved;
    }

    // 4. VS Code C# extension paths
    const vscodePaths = this.getVsCodeExtensionPaths();
    for (const vscodePath of vscodePaths) {
      searchedPaths.push(vscodePath);
      if (existsSync(vscodePath)) {
        this.logger.debug('using vsdbg from VS Code extension', { path: vscodePath });
        return vscodePath;
      }
    }

    // 5. Common install locations
    const commonPaths = this.getCommonInstallPaths();
    for (const commonPath of commonPaths) {
      searchedPaths.push(commonPath);
      if (existsSync(commonPath)) {
        this.logger.debug('using vsdbg from common install location', { path: commonPath });
        return commonPath;
      }
    }

    throw new VsdbgNotFoundError(searchedPaths);
  }

  /** Get the path to the bundled vsdbg from the postinstall download. */
  private getBundledPath(): string | null {
    try {
      const packageRoot = resolvePackageRoot(import.meta.url);
      const bundledBinary = join(packageRoot, 'adapters', 'vsdbg', VSDBG_BINARY);
      return bundledBinary;
    } catch {
      return null;
    }
  }

  /** Search VS Code C# extension directories for vsdbg. */
  private getVsCodeExtensionPaths(): readonly string[] {
    const home = homedir();
    const os = platform();
    const candidates: string[] = [];

    const userExtDir = join(home, '.vscode', 'extensions');
    try {
      const entries = readdirSync(userExtDir);
      for (const entry of entries) {
        if (entry.startsWith('ms-dotnettools.csharp-')) {
          if (os === 'win32') {
            candidates.push(join(userExtDir, entry, '.debugger', 'x86_64', 'vsdbg.exe'));
          } else if (os === 'darwin') {
            candidates.push(join(userExtDir, entry, '.debugger', 'x86_64', 'vsdbg'));
            candidates.push(join(userExtDir, entry, '.debugger', 'arm64', 'vsdbg'));
          } else {
            candidates.push(join(userExtDir, entry, '.debugger', 'vsdbg'));
          }
        }
      }
    } catch {
      // Extensions directory may not exist
    }

    return candidates;
  }

  /** Common install locations for vsdbg. */
  private getCommonInstallPaths(): readonly string[] {
    const os = platform();
    const home = homedir();

    if (os === 'win32') {
      const localAppData = process.env['LOCALAPPDATA'] ?? '';
      return localAppData ? [`${localAppData}\\vsdbg\\vsdbg.exe`] : [];
    }

    return [
      join(home, '.vsdbg', 'vsdbg'),
      '/usr/local/vsdbg/vsdbg',
    ];
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

import { existsSync } from 'node:fs';

import type { AdapterConfig, LanguageId } from '../../types/adapter.js';
import type { AdapterCapabilities, AttachOptions, LaunchOptions } from '../types.js';
import { BaseAdapter } from '../base-adapter.js';
import { getBundledClrDebugPath } from './config.js';

/** Error thrown when the clr-debug binary cannot be located. */
export class ClrDebugNotFoundError extends Error {
  readonly code = 'ADAPTER_NOT_FOUND' as const;

  constructor(searchedPaths: readonly string[]) {
    const paths = searchedPaths.map((p) => `  - ${p}`).join('\n');
    super(
      `clr-debug adapter not found.\n\n` +
        `Searched locations:\n${paths}\n\n` +
        `The clr-debug adapter provides .NET Framework 4.x debugging\n` +
        `via the ICorDebug COM API. It must be built before use:\n\n` +
        `  cd adapters/clr-debug && dotnet publish -c Release -r win-x64 --self-contained false -o bin/publish\n\n` +
        `Or set AGENTIC_CLR_DEBUG_PATH to point to the clr-debug.exe binary.`,
    );
    this.name = 'ClrDebugNotFoundError';
  }
}

/**
 * Debug adapter for .NET Framework 4.x using ICorDebug via ClrDebug.
 *
 * This adapter fills the gap left by vsdbg (which is DRM-locked to VS Code)
 * and netcoredbg (which only supports .NET Core / .NET 5+). It speaks
 * standard DAP over stdin/stdout (Content-Length framing) and can attach
 * to any .NET Framework 4.x process.
 *
 * The underlying C# binary uses:
 *   - CLRMetaHost → ICorDebug for process attach/control
 *   - ISymUnmanagedReader for PDB-based source mapping
 *   - IMetaDataImport for method/type name resolution
 */
export class ClrDebugAdapter extends BaseAdapter {
  readonly type = 'clr-debug' as const;
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

  protected override getLaunchArgs(
    _config: AdapterConfig,
    _options: LaunchOptions,
  ): readonly string[] {
    // clr-debug currently only supports attach
    return [];
  }

  protected override getAttachArgs(
    _config: AdapterConfig,
    _options: AttachOptions,
  ): readonly string[] {
    // Attach details (processId) are sent via DAP attach request body
    return [];
  }

  override async launch(_config: AdapterConfig, _options: LaunchOptions): Promise<void> {
    throw new Error(
      'clr-debug does not support launch mode.\n' +
        'Start your .NET Framework application manually and use attach instead:\n' +
        '  agentic-debugger attach --adapter clr-debug --pid <process-id>',
    );
  }

  override async attach(config: AdapterConfig, options: AttachOptions): Promise<void> {
    const processId = options.processId;
    if (processId === undefined) {
      throw new Error('processId is required for clr-debug attach');
    }

    // Wrap the entire attach flow with an overall timeout
    const ATTACH_TIMEOUT_MS = 30_000;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`clr-debug attach timed out after ${ATTACH_TIMEOUT_MS / 1000}s`)),
        ATTACH_TIMEOUT_MS,
      );
    });

    const attachFlow = async () => {
      await this.spawn(this.getAttachArgs(config, options));
      const client = this.createClient();

      // DAP handshake
      await client.initialize({
        clientID: 'agentic-debugger',
        clientName: 'Agentic Debugger',
        adapterID: 'clr-debug',
        pathFormat: 'path',
        linesStartAt1: true,
        columnsStartAt1: true,
        supportsRunInTerminalRequest: false,
      });

      await client.attach({
        type: 'clr',
        request: 'attach',
        processId,
        justMyCode: false,
        requireExactSource: false,
      } as import('@vscode/debugprotocol').DebugProtocol.AttachRequestArguments);

      await client.configurationDone();

      this.logger.info('clr-debug attach session started', {
        processId,
      });
    };

    await Promise.race([attachFlow(), timeoutPromise]);
  }

  override getCapabilities(): AdapterCapabilities {
    return {
      supportsConfigurationDoneRequest: true,
      supportsConditionalBreakpoints: false,
      supportsFunctionBreakpoints: false,
      supportsEvaluateForHovers: false,
      supportsSetVariable: false,
      supportsTerminateRequest: false,
      supportsModulesRequest: false,
      supportsLogPoints: false,
      supportsHitConditionalBreakpoints: false,
      supportsTerminateDebuggee: false,
      supportsLoadedSourcesRequest: false,
    };
  }

  /**
   * Resolve the clr-debug binary path using the following precedence:
   *
   * 1. `AGENTIC_CLR_DEBUG_PATH` environment variable
   * 2. Conventional local adapter path (built via dotnet publish)
   */
  private resolveBinaryPath(): string {
    const searchedPaths: string[] = [];

    // 1. Environment variable
    const envPath = process.env['AGENTIC_CLR_DEBUG_PATH'];
    if (envPath) {
      searchedPaths.push(envPath);
      if (existsSync(envPath)) {
        this.logger.debug('using clr-debug from environment variable', { path: envPath });
        return envPath;
      }
    }

    // 2. Conventional local build output
    const bundledPath = getBundledClrDebugPath();
    searchedPaths.push(bundledPath);
    if (existsSync(bundledPath)) {
      this.logger.debug('using local clr-debug build', { path: bundledPath });
      return bundledPath;
    }

    throw new ClrDebugNotFoundError(searchedPaths);
  }
}

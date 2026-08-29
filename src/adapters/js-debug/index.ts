import { type ChildProcess, spawn as spawnProcess, execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, platform } from 'node:os';
import { createServer, Socket as NetSocket } from 'node:net';

import type { DebugProtocol } from '@vscode/debugprotocol';

import type { AdapterConfig, LanguageId } from '../../types/adapter.js';
import type { AdapterCapabilities, AttachOptions, LaunchOptions } from '../types.js';
import { BaseAdapter } from '../base-adapter.js';
import { resolvePackageRoot } from '../package-root.js';
import { DapClient } from '../../dap/client.js';
import { TcpTransport } from '../../dap/transport/tcp.js';
import type { DapTimeoutConfig } from '../../dap/types.js';
import {
  JS_DEBUG_BINARY,
  JS_DEBUG_DEFAULT_PORT,
  JS_DEBUG_TYPE,
  JS_DEBUG_TYPE_CHROME,
  JS_DEBUG_TYPE_MSEDGE,
  JS_DEBUG_VSCODE_EXTENSION_PATHS,
} from './config.js';

/** Error thrown when the js-debug binary cannot be located. */
export class JsDebugNotFoundError extends Error {
  readonly code = 'ADAPTER_NOT_FOUND' as const;

  constructor(searchedPaths: readonly string[]) {
    const paths = searchedPaths.map((p) => `  - ${p}`).join('\n');
    super(
      `js-debug DAP server not found.\n\n` +
        `Searched locations:\n${paths}\n\n` +
        `Installation options:\n` +
        `  1. Run: agentic-debugger setup  (downloads js-debug automatically)\n` +
        `  2. Install VS Code (js-debug is bundled)\n` +
        `  3. Set AGENTIC_JSDEBUG_PATH environment variable to the path of dapDebugServer.js`,
    );
    this.name = 'JsDebugNotFoundError';
  }
}

/** Debug adapter for JavaScript and TypeScript using js-debug (pwa-node). */
export class JsDebugAdapter extends BaseAdapter {
  readonly type = 'js-debug' as const;
  readonly languages: readonly LanguageId[] = ['javascript', 'typescript'];

  private resolvedCommand: string | undefined;
  private dapServerProcess: ChildProcess | undefined;
  private dapServerPort: number | undefined;
  private childClients: DapClient[] = [];

  protected override getCommand(): string {
    if (this.resolvedCommand) {
      return this.resolvedCommand;
    }

    const resolved = this.resolveBinaryPath();
    this.resolvedCommand = resolved;
    return resolved;
  }

  /**
   * Build the DAP config properties for a launch request.
   * These are sent via the DAP launch request body, NOT as CLI args.
   */
  private getLaunchConfig(config: AdapterConfig, options: LaunchOptions): Record<string, unknown> {
    const runtime = config.runtime ?? 'node';

    return {
      type: JS_DEBUG_TYPE,
      request: 'launch',
      program: options.program,
      cwd: options.cwd ?? process.cwd(),
      runtimeExecutable: runtime,
      sourceMaps: true,
      resolveSourceMapLocations: ['**', '!**/node_modules/**'],
      args: options.args ?? [],
    };
  }

  /**
   * Build the DAP config properties for an attach request.
   * These are sent via the DAP attach request body, NOT as CLI args.
   */
  private getAttachConfig(config: AdapterConfig, options: AttachOptions): Record<string, unknown> {
    const port = options.port ?? JS_DEBUG_DEFAULT_PORT;
    const host = options.host ?? 'localhost';
    const debugType = options.debugType ?? 'node';

    // CDP-based attach (Chrome, Edge, WebView2)
    if (debugType === 'chrome' || debugType === 'msedge') {
      const dapType = debugType === 'msedge' ? JS_DEBUG_TYPE_MSEDGE : JS_DEBUG_TYPE_CHROME;
      const webRoot = options.webRoot ?? process.cwd();

      // Default sourcemap path overrides for common webpack patterns.
      // js-debug uses these to translate sourcemap source URLs to local disk paths.
      // Without them, breakpoints set by file path remain "unverified" because
      // js-debug cannot match the sourcemap's source URLs to the local files.
      const defaultOverrides: Record<string, string> = {
        // Standard webpack devtool patterns
        'webpack:///./*': `${webRoot}/*`,
        'webpack:///./~/*': `${webRoot}/node_modules/*`,
        'webpack:///*': '/*',
        // Custom protocol patterns (e.g., Power Query monolith-ui)
        'ms-pq://@powerquery/monolith-ui/./*': `${webRoot}/*`,
        'ms-pq://*': `${webRoot}/*`,
      };

      // User-supplied overrides take precedence over defaults
      const sourceMapPathOverrides = options.sourceMapPathOverrides
        ? { ...defaultOverrides, ...options.sourceMapPathOverrides }
        : defaultOverrides;

      return {
        type: dapType,
        request: 'attach',
        port,
        address: host,
        webRoot,
        sourceMaps: true,
        urlFilter: '*',
        sourceMapPathOverrides,
        // Limit how long js-debug waits for a browser/CDP target before failing.
        // Without this, js-debug retries indefinitely and never responds to the
        // DAP attach request, causing the CLI to hang.
        timeout: 8_000,
      };
    }

    // Node.js V8 inspector attach (default)
    return {
      type: JS_DEBUG_TYPE,
      request: 'attach',
      port,
      host,
      sourceMaps: true,
      resolveSourceMapLocations: ['**', '!**/node_modules/**'],
    };
  }

  // Keep the old interface methods for BaseAdapter contract but they are unused
  protected override getLaunchArgs(_config: AdapterConfig, _options: LaunchOptions): readonly string[] {
    return [];
  }

  protected override getAttachArgs(_config: AdapterConfig, _options: AttachOptions): readonly string[] {
    return [];
  }

  /**
   * Find a free TCP port on localhost.
   */
  private async findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr !== 'string') {
          const port = addr.port;
          server.close(() => resolve(port));
        } else {
          server.close(() => reject(new Error('Failed to find a free port')));
        }
      });
      server.on('error', reject);
    });
  }

  /**
   * Spawn the dapDebugServer.js as a TCP DAP server and connect to it.
   *
   * Unlike other adapters that use stdio, js-debug's dapDebugServer.js
   * is a TCP-based DAP server: `node dapDebugServer.js [port] [host]`
   * It listens on the given TCP port for DAP connections.
   */
  private async spawnDapServer(timeouts?: DapTimeoutConfig): Promise<DapClient> {
    const command = this.getCommand();
    const dapPort = await this.findFreePort();
    this.dapServerPort = dapPort;

    this.logger.debug('spawning js-debug DAP server', { command, dapPort });

    // Parse command: might be "node /path/to/dapDebugServer.js" or just a binary
    const parts = command.split(' ');
    const binary = parts[0]!;
    const binaryArgs = [...parts.slice(1), String(dapPort), '127.0.0.1'];

    // Spawn detached so the DAP server survives after the CLI process exits.
    // Subsequent CLI invocations (breakpoint set, step, eval) reconnect via TCP
    // using the persisted session info.  stdio is 'ignore' because DAP traffic
    // goes over TCP, not stdin/stdout.
    const child = spawnProcess(binary, binaryArgs, {
      detached: true,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore'],
      env: { ...process.env },
    });

    this.dapServerProcess = child;

    child.on('error', (err: Error) => {
      this.logger.error('js-debug process error', { error: err.message });
    });

    child.on('close', (code: number | null) => {
      this.logger.debug('js-debug process exited', { code });
    });

    // Unref the child so Node.js doesn't wait for it to exit.
    child.unref();

    // Wait for the server to start listening on the TCP port
    await this.waitForPort(dapPort, 3_000);

    // Connect to the DAP server via TCP
    const tcpTransport = new TcpTransport({ host: '127.0.0.1', port: dapPort });
    await tcpTransport.connect();

    this.transport = tcpTransport;

    const client = new DapClient({ transport: tcpTransport, timeouts });
    this.client = client;

    return client;
  }

  /**
   * Wait for a TCP port to start accepting connections.
   */
  private async waitForPort(port: number, timeoutMs: number): Promise<void> {
    const start = Date.now();
    const interval = 100;

    return new Promise((resolve, reject) => {
      const tryConnect = (): void => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`js-debug DAP server did not start within ${timeoutMs}ms`));
          return;
        }

        const sock = new NetSocket();
        sock.once('connect', () => {
          sock.destroy();
          resolve();
        });
        sock.once('error', () => {
          sock.destroy();
          setTimeout(tryConnect, interval);
        });
        sock.connect(port, '127.0.0.1');
      };

      tryConnect();
    });
  }

  override async launch(config: AdapterConfig, options: LaunchOptions): Promise<void> {
    const client = await this.spawnDapServer();
    const launchConfig = this.getLaunchConfig(config, options);

    // DAP handshake
    await client.initialize({
      clientID: 'agentic-debugger',
      clientName: 'Agentic Debugger',
      adapterID: launchConfig['type'] as string,
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsRunInTerminalRequest: false,
    });

    // js-debug sends the `initialized` event BEFORE completing the launch
    // response, and expects `configurationDone` to be sent in response to
    // that event. If we await launch() first then call configurationDone(),
    // we deadlock — launch never completes without configurationDone.
    // Fix: send configurationDone as soon as the initialized event fires.
    const configDone = new Promise<void>((resolve) => {
      client.onEvent('initialized', () => {
        client.configurationDone().then(() => resolve(), () => resolve());
      });
    });

    await client.launch(launchConfig as DebugProtocol.LaunchRequestArguments);
    await configDone;

    this.logger.info('js-debug launch session started', {
      program: options.program,
      cwd: options.cwd,
    });
  }

  override async attach(config: AdapterConfig, options: AttachOptions): Promise<void> {
    const debugType = options.debugType ?? 'node';
    const isCdpAttach = debugType === 'chrome' || debugType === 'msedge';

    // CDP attach needs a longer timeout — js-debug discovers browser targets (up to 8s)
    // then sends startDebugging reverse requests, which require child session setup.
    const client = await this.spawnDapServer(
      isCdpAttach ? { requestTimeoutMs: 30_000 } : undefined,
    );
    const attachConfig = this.getAttachConfig(config, options);

    // For CDP-based attach (Chrome, Edge, WebView2) AND Node V8 inspector attach,
    // handle js-debug's multi-session architecture. js-debug discovers targets via
    // CDP (HTTP for browsers, V8 inspector for Node) then sends `startDebugging`
    // reverse requests for each target, asking the client to spawn a child debug
    // session on a new TCP connection to the same DAP server.
    //
    // IMPORTANT: js-debug sends `startDebugging` reverse requests ASYNCHRONOUSLY
    // after the attach response. The parent attach completes before child sessions
    // are established. We must wait for the first child session to be ready before
    // returning from attach(), otherwise `this.client` will still be the parent.
    let childSessionReady: Promise<void> | undefined;
    if (this.dapServerPort !== undefined) {
      childSessionReady = this.registerStartDebuggingHandler(client);
    }

    // DAP handshake
    await client.initialize({
      clientID: 'agentic-debugger',
      clientName: 'Agentic Debugger',
      adapterID: attachConfig['type'] as string,
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsRunInTerminalRequest: false,
      supportsStartDebuggingRequest: true,
    });

    // js-debug sends the `initialized` event BEFORE completing the attach
    // response, and expects `configurationDone` to be sent in response to
    // that event. If we await attach() first then call configurationDone(),
    // we deadlock — attach never completes without configurationDone.
    // Fix: send configurationDone as soon as the initialized event fires.
    const configDone = new Promise<void>((resolve) => {
      client.onEvent('initialized', () => {
        client.configurationDone().then(() => resolve(), () => resolve());
      });
    });

    await client.attach(attachConfig as DebugProtocol.AttachRequestArguments);
    await configDone;

    // For CDP attach, wait for the first child session to be established.
    // js-debug discovers browser targets asynchronously after the parent attach
    // completes, so `this.client` is still the parent at this point. Without
    // this wait, all subsequent DAP operations (breakpoints, threads, eval)
    // would be sent to the parent session, which has no page context.
    if (childSessionReady) {
      this.logger.debug('waiting for child debug session via startDebugging...');
      await childSessionReady;
      this.logger.debug('child debug session ready');
    }

    this.logger.info('js-debug attach session started', {
      port: options.port ?? JS_DEBUG_DEFAULT_PORT,
      host: options.host ?? 'localhost',
      debugType,
    });
  }

  /**
   * Register a handler for js-debug's `startDebugging` reverse request.
   *
   * When attaching to a browser/WebView2 via CDP, js-debug uses VS Code's
   * multi-session debugging architecture:
   * 1. The parent session discovers browser targets via the CDP HTTP API
   * 2. For each target, js-debug sends a `startDebugging` reverse request
   * 3. The client must open a NEW TCP connection to the same DAP server
   * 4. On that connection, it runs a full child debug session (init -> attach -> configDone)
   * 5. The child session handles actual page debugging (breakpoints, stepping, etc.)
   *
   * After the child session is established, `this.client` is swapped to the child
   * so all subsequent breakpoint/step/eval operations target the right session.
   *
   * @returns A Promise that resolves when the first child session is established.
   *   This allows the caller to wait for child readiness before returning from attach().
   */
  private registerStartDebuggingHandler(parentClient: DapClient): Promise<void> {
    const dapPort = this.dapServerPort!;

    // Deferred promise that resolves when the first child session is fully established.
    // The attach() method awaits this to ensure `this.client` is the child session
    // before the caller calls getClient().
    let resolveFirstChild!: () => void;
    let rejectFirstChild!: (err: Error) => void;
    let firstChildSettled = false;
    const firstChildReady = new Promise<void>((resolve, reject) => {
      resolveFirstChild = resolve;
      rejectFirstChild = reject;
    });

    // Safety timeout: if no startDebugging arrives within 15s, resolve anyway
    // so attach() doesn't hang forever.
    const safetyTimeout = setTimeout(() => {
      if (!firstChildSettled) {
        firstChildSettled = true;
        this.logger.warn('no startDebugging received within 15s — continuing with parent session');
        resolveFirstChild();
      }
    }, 15_000);

    parentClient.onReverseRequest('startDebugging', async (request) => {
      const args = (request.arguments ?? {}) as Record<string, unknown>;
      const childConfig = (args['configuration'] ?? {}) as Record<string, unknown>;
      const childRequest = (args['request'] as string) ?? 'attach';

      this.logger.debug('startDebugging: spawning child debug session', {
        request: childRequest,
        type: childConfig['type'],
      });

      try {
        // Connect to the same DAP server on a new TCP connection.
        // js-debug's dapDebugServer.js accepts multiple connections —
        // each one is an independent debug session.
        const childTransport = new TcpTransport({ host: '127.0.0.1', port: dapPort });
        await childTransport.connect();

        const childClient = new DapClient({ transport: childTransport });
        this.childClients.push(childClient);

        // Initialize the child session
        await childClient.initialize({
          clientID: 'agentic-debugger',
          clientName: 'Agentic Debugger',
          adapterID: (childConfig['type'] as string) ?? 'pwa-chrome',
          pathFormat: 'path',
          linesStartAt1: true,
          columnsStartAt1: true,
          supportsRunInTerminalRequest: false,
          supportsStartDebuggingRequest: true,
        });

        // Same initialized-event pattern as the parent: js-debug sends
        // the `initialized` event before completing attach, and expects
        // configurationDone in response. Set up the handler BEFORE sending attach.
        const childConfigDone = new Promise<void>((resolve) => {
          childClient.onEvent('initialized', () => {
            childClient.configurationDone().then(() => resolve(), () => resolve());
          });
        });

        // Attach or launch the child with js-debug's internal config
        // (includes __pendingTargetId, url, and other target-specific fields)
        if (childRequest === 'launch') {
          await childClient.launch(childConfig as DebugProtocol.LaunchRequestArguments);
        } else {
          await childClient.attach(childConfig as DebugProtocol.AttachRequestArguments);
        }

        await childConfigDone;

        // Promote the child client to primary — subsequent breakpoint, step,
        // and evaluate operations should target the actual page debugger,
        // not the browser-discovery parent session.
        this.client = childClient;

        this.logger.info('child debug session established via startDebugging', {
          type: childConfig['type'],
        });

        // Signal that the first child session is ready
        if (!firstChildSettled) {
          firstChildSettled = true;
          clearTimeout(safetyTimeout);
          resolveFirstChild();
        }

        return {
          seq: 0,
          type: 'response' as const,
          request_seq: request.seq,
          command: request.command,
          success: true,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error('startDebugging: failed to establish child session', { error: message });

        // Signal failure if this was the first child
        if (!firstChildSettled) {
          firstChildSettled = true;
          clearTimeout(safetyTimeout);
          rejectFirstChild(err instanceof Error ? err : new Error(message));
        }

        return {
          seq: 0,
          type: 'response' as const,
          request_seq: request.seq,
          command: request.command,
          success: false,
          message,
        };
      }
    });

    return firstChildReady;
  }

  override getCapabilities(): AdapterCapabilities {
    return {
      supportsConditionalBreakpoints: true,
      supportsFunctionBreakpoints: true,
      supportsEvaluateForHovers: true,
      supportsSetVariable: true,
      supportsCompletionsRequest: true,
      supportsRestartFrame: true,
      supportsExceptionInfoRequest: true,
      supportsExceptionOptions: true,
      supportsTerminateRequest: true,
      supportsDelayedStackTraceLoading: true,
      supportsLoadedSourcesRequest: true,
      supportsLogPoints: true,
      supportsBreakpointLocationsRequest: true,
      supportsSteppingGranularity: true,
      supportsHitConditionalBreakpoints: true,
      supportsConfigurationDoneRequest: true,
      supportsClipboardContext: true,
      supportsDataBreakpoints: true,
    };
  }

  /** Returns the DapClient for external callers (e.g., CLI attach). */
  override getClient(): DapClient | undefined {
    return this.client;
  }

  /** Returns the DAP server TCP port (for session persistence / reconnection). */
  getDapServerPort(): number | undefined {
    return this.dapServerPort;
  }

  override async dispose(): Promise<void> {
    // Dispose child debug sessions (from startDebugging)
    for (const child of this.childClients) {
      try {
        child.dispose();
      } catch {
        // Best-effort cleanup
      }
    }
    this.childClients = [];

    await super.dispose();
    if (this.dapServerProcess) {
      this.dapServerProcess.kill();
      this.dapServerProcess = undefined;
    }
  }

  /**
   * Resolve the js-debug binary path using the following precedence:
   *
   * 1. `AGENTIC_JSDEBUG_PATH` environment variable
   * 2. Bundled adapter (installed by postinstall script)
   * 3. Standalone `js-debug-dap` binary on PATH
   * 4. VS Code bundled extension paths
   */
  private resolveBinaryPath(): string {
    const searchedPaths: string[] = [];

    const envPath = process.env['AGENTIC_JSDEBUG_PATH'];
    if (envPath) {
      searchedPaths.push(envPath);
      if (existsSync(envPath)) {
        this.logger.debug('using js-debug from environment variable', { path: envPath });
        return envPath.endsWith('.js') ? `node ${envPath}` : envPath;
      }
    }

    // Check bundled adapter (from postinstall download)
    const bundledPath = this.getBundledDapServerPath();
    if (bundledPath) {
      searchedPaths.push(bundledPath);
      if (existsSync(bundledPath)) {
        this.logger.debug('using bundled js-debug DAP server', { path: bundledPath });
        return `node ${bundledPath}`;
      }
    }

    const standalonePath = this.findOnPath(JS_DEBUG_BINARY);
    searchedPaths.push(`PATH lookup: ${JS_DEBUG_BINARY}`);
    if (standalonePath) {
      this.logger.debug('using standalone js-debug-dap from PATH', { path: standalonePath });
      return standalonePath;
    }

    const vscodePaths = this.getVsCodeExtensionPaths();
    for (const vscodePath of vscodePaths) {
      searchedPaths.push(vscodePath);
      if (existsSync(vscodePath)) {
        this.logger.debug('using js-debug from VS Code extensions', { path: vscodePath });
        return `node ${vscodePath}`;
      }
    }

    throw new JsDebugNotFoundError(searchedPaths);
  }

  /**
   * Get the path to the bundled dapDebugServer.js from the postinstall download.
   * The bundled adapter is stored at: <package-root>/adapters/js-debug/js-debug/src/dapDebugServer.js
   * (inside the extracted tarball structure, alongside companion files like chromehash_bg.wasm)
   */
  private getBundledDapServerPath(): string | null {
    try {
      const packageRoot = resolvePackageRoot(import.meta.url);
      return join(packageRoot, 'adapters', 'js-debug', 'js-debug', 'src', 'dapDebugServer.js');
    } catch {
      return null;
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

  /** Build candidate VS Code extension paths for the current platform. */
  private getVsCodeExtensionPaths(): readonly string[] {
    const home = homedir();
    const os = platform();
    const candidates: string[] = [];

    // 1. User-installed extensions in ~/.vscode/extensions/ (all platforms)
    const userExtDir = join(home, '.vscode', 'extensions');
    for (const relPath of JS_DEBUG_VSCODE_EXTENSION_PATHS) {
      const parts = relPath.split('/').slice(2); // strip ".vscode/extensions/"
      candidates.push(join(userExtDir, ...parts));
    }

    // 1b. Versioned extension folders (e.g., ms-vscode.js-debug-1.96.0)
    try {
      const entries = readdirSync(userExtDir);
      for (const entry of entries) {
        if (entry.startsWith('ms-vscode.js-debug-') || entry.startsWith('ms-vscode.js-debug-nightly-')) {
          candidates.push(join(userExtDir, entry, 'src', 'dapDebugServer.js'));
        }
      }
    } catch {
      // Directory may not exist
    }

    // 2. VS Code bundled extensions (ships with VS Code itself)
    if (os === 'win32') {
      const localAppData = process.env['LOCALAPPDATA'] ?? '';
      if (localAppData) {
        // Standard Windows install location
        candidates.push(
          join(localAppData, 'Programs', 'Microsoft VS Code', 'resources', 'app', 'extensions', 'ms-vscode.js-debug', 'src', 'dapDebugServer.js'),
        );
        // VS Code Insiders
        candidates.push(
          join(localAppData, 'Programs', 'Microsoft VS Code Insiders', 'resources', 'app', 'extensions', 'ms-vscode.js-debug', 'src', 'dapDebugServer.js'),
        );
      }
      // System-wide install
      const programFiles = process.env['ProgramFiles'] ?? 'C:\\Program Files';
      candidates.push(
        join(programFiles, 'Microsoft VS Code', 'resources', 'app', 'extensions', 'ms-vscode.js-debug', 'src', 'dapDebugServer.js'),
      );
    } else if (os === 'darwin') {
      candidates.push(
        '/Applications/Visual Studio Code.app/Contents/Resources/app/extensions/ms-vscode.js-debug/src/dapDebugServer.js',
        '/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/extensions/ms-vscode.js-debug/src/dapDebugServer.js',
      );
    } else {
      // Linux
      candidates.push(
        '/usr/share/code/resources/app/extensions/ms-vscode.js-debug/src/dapDebugServer.js',
        '/usr/lib/code/resources/app/extensions/ms-vscode.js-debug/src/dapDebugServer.js',
        '/snap/code/current/usr/share/code/resources/app/extensions/ms-vscode.js-debug/src/dapDebugServer.js',
      );
    }

    // 3. Try to derive from `code` binary on PATH
    try {
      const codeCmd = os === 'win32' ? 'where' : 'which';
      const codeBinaryName = os === 'win32' ? 'code.cmd' : 'code';
      const result = execFileSync(codeCmd, [codeBinaryName], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const codePath = result.trim().split('\n')[0]?.trim();
      if (codePath) {
        // code / code.cmd is typically in <VS Code root>/bin/
        const vsCodeRoot = dirname(dirname(codePath));
        candidates.push(
          join(vsCodeRoot, 'resources', 'app', 'extensions', 'ms-vscode.js-debug', 'src', 'dapDebugServer.js'),
        );
      }
    } catch {
      // `code` not on PATH
    }

    return candidates;
  }
}

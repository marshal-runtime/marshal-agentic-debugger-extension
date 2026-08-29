import { spawn as spawnProcess } from 'node:child_process';
import { Readable } from 'node:stream';

import { Option, type Command } from 'commander';

import { JsDebugAdapter, JsDebugNotFoundError } from '../../adapters/js-debug/index.js';
import { VsdbgAdapter, VsdbgNotFoundError } from '../../adapters/vsdbg/index.js';
import { NetcoredbgAdapter, NetcoredbgNotFoundError, NetFrameworkIncompatibleError } from '../../adapters/netcoredbg/index.js';
import { ClrDebugAdapter, ClrDebugNotFoundError } from '../../adapters/clr-debug/index.js';
import { BaseAdapter } from '../../adapters/base-adapter.js';
import { formatOutput, formatErrorOutput, writeOutput } from '../output.js';
import { startSessionHost } from '../session-host.js';
import { ErrorCode } from '../../schemas/errors.js';
import { mapErrorToExitCode, getResolutionHint } from '../errors.js';
import { SessionManager } from '../../session/index.js';
import { DapClient } from '../../dap/client.js';
import { TcpTransport } from '../../dap/transport/tcp.js';
import { StdioTransport } from '../../dap/transport/stdio.js';
import { isProcessAllowed } from '../../security/process-guard.js';
import type { LanguageId } from '../../types/adapter.js';
import type { DebugTargetType } from '../../adapters/types.js';

/** Options parsed from the attach command CLI flags. */
interface AttachOptions {
  readonly language?: string;
  readonly address?: string;
  readonly pid?: string;
  readonly session?: string;
  readonly type?: string;
  readonly webRoot?: string;
  readonly _daemon?: boolean;
}

/** Parse a host:port address string into its components. */
function parseAddress(address: string): { host: string; port: number } {
  const lastColon = address.lastIndexOf(':');
  if (lastColon === -1) {
    return { host: 'localhost', port: Number(address) };
  }
  return {
    host: address.slice(0, lastColon),
    port: Number(address.slice(lastColon + 1)),
  };
}

/** Register the `attach` command for connecting to a running process. */
export function registerAttachCommand(program: Command): void {
  program
    .command('attach')
    .description('Attach to a running process for debugging')
    .option('--language <lang>', 'Programming language (typescript, javascript, python, csharp)')
    .option('--address <host:port>', 'Address to connect to (e.g., localhost:9229)')
    .option('--pid <pid>', 'Process ID to attach to')
    .option(
      '--type <type>',
      'Debug target type: node (V8 inspector, default), chrome/msedge (CDP — NOT supported in standalone CLI, see bug 4), clr (.NET Framework via clr-debug)',
    )
    .option('--web-root <path>', 'Root directory of web app source (for CDP sourcemap resolution)')
    .option('-s, --session <id>', 'Target session ID')
    .addOption(new Option('--_daemon', 'Run as session host daemon (internal use only)').hideHelp())
    .action(async (options: AttachOptions) => {
      // Non-daemon mode: spawn ourselves as a background daemon process.
      // The daemon holds the DAP connection alive so subsequent CLI
      // invocations (threads, step, eval, etc.) can send DAP requests.
      if (!options._daemon) {
        await spawnAttachDaemon(options);
        return;
      }

      let adapter: BaseAdapter | undefined;
      try {
        if (!options.address && !options.pid) {
          const output = formatErrorOutput(
            'attach',
            ErrorCode.AttachFailed,
            'Either --address or --pid must be provided',
            undefined,
            getResolutionHint(ErrorCode.AttachFailed) ?? undefined,
          );
          writeOutput(output);
          process.exitCode = mapErrorToExitCode(ErrorCode.AttachFailed);
          return;
        }

        if (options.pid) {
          const pid = Number(options.pid);
          if (Number.isNaN(pid) || pid <= 0) {
            const output = formatErrorOutput(
              'attach',
              ErrorCode.AttachFailed,
              `Invalid PID: ${options.pid}`,
              undefined,
              getResolutionHint(ErrorCode.AttachFailed) ?? undefined,
            );
            writeOutput(output);
            process.exitCode = mapErrorToExitCode(ErrorCode.AttachFailed);
            return;
          }

          const guardResult = isProcessAllowed(pid);
          if (!guardResult.allowed) {
            const output = formatErrorOutput(
              'attach',
              ErrorCode.ProcessRestricted,
              guardResult.reason ?? `Process ${pid} is not allowed`,
              undefined,
              getResolutionHint(ErrorCode.ProcessRestricted) ?? undefined,
            );
            writeOutput(output);
            process.exitCode = mapErrorToExitCode(ErrorCode.ProcessRestricted);
            return;
          }
        }

        let language: LanguageId;
        if (options.language) {
          language = options.language as LanguageId;
        } else {
          const output = formatErrorOutput(
            'attach',
            ErrorCode.LanguageNotDetected,
            'Language must be specified for attach (cannot auto-detect from running process)',
            undefined,
            getResolutionHint(ErrorCode.LanguageNotDetected) ?? undefined,
          );
          writeOutput(output);
          process.exitCode = mapErrorToExitCode(ErrorCode.LanguageNotDetected);
          return;
        }

        let client: DapClient;

        const debugType = (options.type ?? 'node') as DebugTargetType;
        const isCdpAttach = debugType === 'chrome' || debugType === 'msedge';
        const isJsAttach = language === 'javascript' || language === 'typescript';
        const isCsharpAttach = language === 'csharp';

        if (isCdpAttach && options.address) {
          // CDP attach: use the JsDebugAdapter to spawn dapDebugServer.js
          // The --address is the Edge/Chrome CDP port, NOT a DAP endpoint
          const { host, port: cdpPort } = parseAddress(options.address);
          adapter = new JsDebugAdapter();
          await adapter.attach(
            { language: language, runtime: 'node', args: [] },
            { port: cdpPort, host, debugType, webRoot: options.webRoot },
          );
          client = adapter.getClient()!;
        } else if (isJsAttach && options.address) {
          // V8 inspector attach (Node.js --inspect / --inspect-brk): route through
          // js-debug as `pwa-node`. The --address is the V8 inspector port (e.g. 9229),
          // NOT a raw DAP TCP endpoint. Without this branch, JS attach would fall through
          // to direct DAP TCP, which fails with a DapFramingError because the V8 inspector
          // speaks HTTP/WebSocket on that port, not raw DAP.
          const { host, port: inspectorPort } = parseAddress(options.address);
          adapter = new JsDebugAdapter();
          await adapter.attach(
            { language, runtime: 'node', args: [] },
            { port: inspectorPort, host, debugType: 'node', webRoot: options.webRoot },
          );
          client = adapter.getClient()!;
        } else if (isCsharpAttach) {
          // C# attach: vsdbg is DRM-locked (cryptographic handshake fails outside
          // VS Code), so we use clr-debug (ICorDebug-based, no licensing restrictions)
          // for .NET Framework 4.x. For .NET Core / .NET 5+, vsdbg is attempted first.
          if (!options.pid) {
            const output = formatErrorOutput(
              'attach',
              ErrorCode.AttachFailed,
              'C# debugging requires --pid (process ID). ' +
                'The --address option is not supported for C# — debuggers attach by PID, not by network address.',
              undefined,
              'Find the target process ID with: tasklist | findstr MyApp (Windows) or ps aux | grep MyApp (Linux/macOS)',
            );
            writeOutput(output);
            process.exitCode = mapErrorToExitCode(ErrorCode.AttachFailed);
            return;
          }

          const pid = Number(options.pid);

          // Detect runtime type to choose the right adapter.
          // .NET Framework → clr-debug (vsdbg is DRM-locked outside VS Code)
          // .NET Core → try vsdbg first, fall back to clr-debug
          const detectedType = debugType ?? (options.type as DebugTargetType | undefined);
          const isNetFramework = !detectedType || detectedType === 'clr';

          if (isNetFramework) {
            // .NET Framework: use clr-debug directly (ICorDebug-based, no DRM)
            const clrAdapter = new ClrDebugAdapter();
            adapter = clrAdapter;
            await clrAdapter.attach(
              { language, runtime: 'dotnet', args: [] },
              { processId: pid },
            );
            client = clrAdapter.getClient()!;
          } else {
            // .NET Core / .NET 5+: prefer netcoredbg (open-source, no DRM).
            // Fall back to vsdbg only if netcoredbg is unavailable (vsdbg's license
            // check fails outside Microsoft VS Code so it almost always errors at
            // configurationDone — see Bug 5b in the issue tracker). As a last resort
            // try clr-debug, which uses ICorDebug and may work on some .NET Core
            // builds that still expose the legacy debugging interface.
            let lastError: unknown;
            try {
              const ncdbgAdapter = new NetcoredbgAdapter();
              adapter = ncdbgAdapter;
              await ncdbgAdapter.attach(
                { language, runtime: 'dotnet', args: [] },
                { processId: pid },
              );
              client = ncdbgAdapter.getClient()!;
            } catch (ncdbgError) {
              lastError = ncdbgError;
              if (adapter) {
                try { await adapter.dispose(); } catch { /* best-effort */ }
                adapter = undefined;
              }
              try {
                const vsdbgAdapter = new VsdbgAdapter();
                adapter = vsdbgAdapter;
                await vsdbgAdapter.attach(
                  { language, runtime: 'dotnet', args: [] },
                  { processId: pid },
                );
                client = vsdbgAdapter.getClient()!;
              } catch (vsdbgError) {
                lastError = vsdbgError;
                if (adapter) {
                  try { await adapter.dispose(); } catch { /* best-effort */ }
                  adapter = undefined;
                }
                try {
                  const clrAdapter = new ClrDebugAdapter();
                  adapter = clrAdapter;
                  await clrAdapter.attach(
                    { language, runtime: 'dotnet', args: [] },
                    { processId: pid },
                  );
                  client = clrAdapter.getClient()!;
                } catch {
                  // All three .NET adapters failed. Surface the netcoredbg error
                  // first (it's the preferred path), or whichever was the last
                  // meaningful failure if netcoredbg simply wasn't installed.
                  throw lastError;
                }
              }
            }
          }
        } else if (options.address) {
          // Direct DAP attach (e.g., Node.js V8 inspector with an already-running DAP server)
          const { host, port } = parseAddress(options.address);
          const transport = new TcpTransport({ host, port });
          await transport.connect();
          client = new DapClient({ transport });
        } else {
          const transport = new StdioTransport({
            command: language,
            args: [],
          });
          await transport.connect();
          client = new DapClient({ transport });
        }

        const sessionManager = new SessionManager();

        const session = sessionManager.createSession({
          config: {
            program: options.pid ? `pid:${options.pid}` : `tcp:${options.address}`,
            language,
          },
          client,
        });

        // For CDP attach, JS V8 inspector attach, and C# vsdbg, initialization +
        // attach was already done by the adapter. Only do the session-level DAP
        // handshake for direct DAP connections.
        const adapterHandledInit = isCdpAttach || (isJsAttach && !!options.address) || isCsharpAttach;
        if (!adapterHandledInit) {
          await session.initialize();

          const attachArgs: Record<string, unknown> = {};
          if (options.pid) {
            attachArgs['processId'] = Number(options.pid);
          }
          if (options.address) {
            const { host, port } = parseAddress(options.address);
            attachArgs['host'] = host;
            attachArgs['port'] = port;
          }
          if (options.type) {
            attachArgs['debugType'] = options.type as DebugTargetType;
          }

          await session.attach(attachArgs);
        }

        // Start the session host command server.
        // This keeps the process alive and accepts DAP requests from
        // subsequent CLI invocations via TCP.
        const activeDapClient = { client };
        const targetDesc = options.pid ? `pid:${options.pid}` : (options.address ?? '');

        const { commandPort } = await startSessionHost(
          activeDapClient,
          session.id,
          language,
          targetDesc,
        );

        // Write the ready signal to stdout so the parent process can read
        // the session info and exit.
        const readyInfo = {
          ready: true,
          sessionId: session.id,
          commandPort,
          state: session.state,
          language,
          target: targetDesc,
          debugType: options.type ?? 'auto',
        };
        process.stdout.write(JSON.stringify(readyInfo) + '\n');

        // The daemon stays alive — do NOT call process.exit().
        // The event loop is kept alive by the TCP command server.

      } catch (error: unknown) {
        const { errorCode, message } = classifyAttachError(error, options);

        // Write the error to stderr immediately (unbuffered) so the parent
        // process can capture it even if stdout doesn't flush before exit.
        process.stderr.write(`[daemon-error] ${message}\n`);

        // Clean up the adapter with a timeout so we don't hang forever
        // if the adapter process is stuck.
        if (adapter) {
          try {
            await Promise.race([
              adapter.dispose(),
              new Promise((r) => setTimeout(r, 3_000)),
            ]);
          } catch { /* best-effort */ }
        }

        const output = formatErrorOutput(
          'attach',
          errorCode,
          message,
          undefined,
          getResolutionHint(errorCode) ?? undefined,
        );

        // Flush stdout before exiting — process.exit() can cut off buffered
        // writes on Windows when stdout is a pipe.
        const exitCode = mapErrorToExitCode(errorCode);
        process.stdout.write(JSON.stringify(output) + '\n', () => {
          process.exit(exitCode);
        });

        // Safety: if the flush callback never fires (broken pipe), exit anyway.
        setTimeout(() => process.exit(exitCode), 1_000);
      }
    });
}

/**
 * Classify an attach error into a specific error code + message.
 * Replaces the old catch-all that always returned ATTACH_FAILED + "Transport is not connected".
 */
function classifyAttachError(
  error: unknown,
  options: AttachOptions,
): { errorCode: ErrorCode; message: string } {
  if (error instanceof JsDebugNotFoundError) {
    return {
      errorCode: ErrorCode.AdapterNotFound,
      message: error.message,
    };
  }

  if (error instanceof NetcoredbgNotFoundError) {
    return {
      errorCode: ErrorCode.AdapterNotFound,
      message: error.message,
    };
  }

  if (error instanceof VsdbgNotFoundError) {
    return {
      errorCode: ErrorCode.AdapterNotFound,
      message: error.message,
    };
  }

  if (error instanceof ClrDebugNotFoundError) {
    return {
      errorCode: ErrorCode.AdapterNotFound,
      message: error.message,
    };
  }

  if (error instanceof NetFrameworkIncompatibleError) {
    return {
      errorCode: ErrorCode.RuntimeIncompatible,
      message: error.message,
    };
  }

  // Extract error message and code — Node.js AggregateError (e.g., ECONNREFUSED
  // on localhost) has an empty .message but a .code property.
  const errCode = (error as NodeJS.ErrnoException)?.code;
  let msg = error instanceof Error ? error.message : String(error);

  // For AggregateError (Node.js dual-stack ECONNREFUSED), extract nested messages
  if (!msg && error instanceof AggregateError && error.errors?.length) {
    msg = error.errors.map((e: Error) => e.message).join('; ');
  }

  // Check both .message and .code for connection refused
  if (errCode === 'ECONNREFUSED' || msg.includes('ECONNREFUSED') || msg.includes('connect ECONNREFUSED')) {
    return {
      errorCode: ErrorCode.ConnectionRefused,
      message: `Connection refused to ${options.address ?? 'target'}. Verify the process is running with debugging enabled and the port is correct.`,
    };
  }

  // Detect DAP request timeout — common for CDP attach when the target isn't running
  if (msg.includes('timed out') || (error instanceof Error && error.name === 'DapTimeoutError')) {
    const target = options.address ?? 'target';
    const isCdp = options.type === 'chrome' || options.type === 'msedge';
    if (isCdp) {
      // Bug 4: js-debug's standalone dapDebugServer.js does NOT complete the
      // browser multi-session attach flow. It expects VS Code to handle
      // `startDebugging` reverse requests for each browser target; without that
      // host, attach hangs and the daemon eventually reports a timeout. The
      // CDP HTTP endpoint can be perfectly healthy and this still fails.
      return {
        errorCode: ErrorCode.AttachFailed,
        message:
          `Browser/CDP attach (--type ${options.type}) is not currently supported by ` +
          `the standalone CLI. js-debug's dapDebugServer requires VS Code's ` +
          `multi-session infrastructure to bind to ${target}. ` +
          `Tracked as bug 4 in the issue report. ` +
          `Workaround: use the JS V8 inspector path (\`node --inspect-brk=PORT\` + ` +
          `\`agentic-debugger attach --language javascript --address 127.0.0.1:PORT\`) ` +
          `for Node, or attach via VS Code's JS debugger for browsers.`,
      };
    }
    return {
      errorCode: ErrorCode.ConnectionRefused,
      message: `The debug adapter did not respond in time for ${target}.`,
    };
  }

  // Detect TCP connection timeout (TcpTransport.connect timeout)
  if (msg.includes('TCP connection to') && msg.includes('timed out')) {
    return {
      errorCode: ErrorCode.ConnectionRefused,
      message: `Connection timed out to ${options.address ?? 'target'}. Verify the process is running with debugging enabled and the port is correct.`,
    };
  }

  // Detect "Transport is not connected" and provide context-specific guidance
  if (msg.includes('Transport is not connected')) {
    if (options.address) {
      return {
        errorCode: ErrorCode.ConnectionRefused,
        message: `Cannot connect to ${options.address}. Is the process running with debugging enabled?`,
      };
    }
    if (options.pid) {
      return {
        errorCode: ErrorCode.AttachFailed,
        message: `Failed to attach to PID ${options.pid}. The debug adapter could not establish a connection.`,
      };
    }
  }

  // Detect process not found
  if (errCode === 'ESRCH' || msg.includes('ESRCH') || msg.includes('no process') || msg.includes('No process')) {
    return {
      errorCode: ErrorCode.ProcessNotFound,
      message: `No process found with PID ${options.pid ?? 'unknown'}.`,
    };
  }

  // Detect spawn ENOENT (adapter binary not found)
  if (errCode === 'ENOENT' || msg.includes('ENOENT') || msg.includes('spawn')) {
    return {
      errorCode: ErrorCode.AdapterNotFound,
      message: `Debug adapter binary not found. ${msg}`,
    };
  }

  return {
    errorCode: ErrorCode.AttachFailed,
    message: msg || `Unknown error: ${String(error)}`,
  };
}

/**
 * Read the first line from a readable stream.
 * Resolves with the first newline-terminated line, or rejects on timeout.
 */
function readFirstLine(stream: Readable, timeoutMs = 30_000): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Session host did not start within ${timeoutMs}ms`));
    }, timeoutMs);

    const onData = (chunk: Buffer): void => {
      buf += chunk.toString();
      const nl = buf.indexOf('\n');
      if (nl >= 0) {
        cleanup();
        resolve(buf.slice(0, nl));
      }
    };

    const onError = (err: Error): void => {
      cleanup();
      reject(err);
    };

    const onEnd = (): void => {
      cleanup();
      if (buf.length > 0) {
        resolve(buf);
      } else {
        reject(new Error('Session host exited without writing ready signal'));
      }
    };

    const cleanup = (): void => {
      clearTimeout(timer);
      stream.removeListener('data', onData);
      stream.removeListener('error', onError);
      stream.removeListener('end', onEnd);
    };

    stream.on('data', onData);
    stream.on('error', onError);
    stream.on('end', onEnd);
  });
}

/**
 * Spawn the attach command in daemon mode as a background process.
 *
 * The daemon process holds the DAP connection alive so that subsequent
 * CLI invocations (threads, step, eval, etc.) can send DAP requests
 * through the session host command server.
 */
async function spawnAttachDaemon(options: AttachOptions): Promise<void> {
  // Re-construct CLI arguments with --_daemon flag
  const args = ['attach', '--_daemon'];
  if (options.language) args.push('--language', options.language);
  if (options.address) args.push('--address', options.address);
  if (options.pid) args.push('--pid', options.pid);
  if (options.type) args.push('--type', options.type);
  if (options.webRoot) args.push('--web-root', options.webRoot);

  const child = spawnProcess(process.argv[0]!, [process.argv[1]!, ...args], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
    windowsHide: true,
  });

  // Capture stderr from the very start so we don't lose error messages
  // if the daemon crashes before the ready signal.
  const stderrChunks: Buffer[] = [];
  child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

  /** Collect all stderr captured so far. */
  const getStderr = (): string =>
    Buffer.concat(stderrChunks).toString('utf-8').trim();

  try {
    // Wait for either:
    // (a) the ready line on stdout,
    // (b) the child to exit (error), or
    // (c) the 30s timeout.
    const readyLine = await Promise.race([
      readFirstLine(child.stdout!),
      waitForChildExit(child, getStderr),
    ]);

    const readyInfo = JSON.parse(readyLine) as {
      ready: boolean;
      sessionId: string;
      commandPort: number;
      state: string;
      language: string;
      target: string;
      debugType: string;
    };

    if (!readyInfo.ready) {
      throw new Error('Session host reported not ready');
    }

    // Detach the child so the parent can exit
    child.unref();
    child.stdout?.destroy();
    child.stderr?.destroy();

    // Output session info
    const output = formatOutput('attach', {
      sessionId: readyInfo.sessionId,
      state: readyInfo.state,
      language: readyInfo.language,
      target: readyInfo.target,
      debugType: readyInfo.debugType,
    }, readyInfo.sessionId);
    writeOutput(output);

    process.exit(0);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    const stderr = getStderr();

    // Extract the actual daemon error from stderr (prefixed with [daemon-error])
    const daemonError = stderr
      .split('\n')
      .find((l) => l.startsWith('[daemon-error] '))
      ?.slice('[daemon-error] '.length);

    const detail = daemonError
      ? daemonError
      : stderr
        ? `${msg}\nDaemon stderr: ${stderr}`
        : msg;

    const output = formatErrorOutput(
      'attach',
      ErrorCode.AttachFailed,
      `Failed to start debug session: ${detail}`,
      undefined,
      getResolutionHint(ErrorCode.AttachFailed) ?? undefined,
    );
    writeOutput(output);
    process.exitCode = mapErrorToExitCode(ErrorCode.AttachFailed);

    try { child.kill(); } catch { /* best-effort */ }
    process.exit(process.exitCode);
  }
}

/**
 * Returns a promise that rejects when the child process exits
 * before writing the ready signal.  Captures stderr for diagnostics.
 */
function waitForChildExit(
  child: ReturnType<typeof spawnProcess>,
  getStderr: () => string,
): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    child.on('exit', (code, signal) => {
      // Give a tiny delay to let final stderr chunks arrive
      setTimeout(() => {
        const stderr = getStderr();
        const exitInfo = signal
          ? `killed by signal ${signal}`
          : `exit code ${code ?? 'unknown'}`;
        const detail = stderr ? `\n${stderr}` : '';
        reject(
          new Error(
            `Session host daemon exited unexpectedly (${exitInfo})${detail}`,
          ),
        );
      }, 100);
    });
  });
}

import { resolve } from 'node:path';

import type { Command } from 'commander';

import { detectLanguage } from '../../adapters/detector.js';
import { JsDebugNotFoundError } from '../../adapters/js-debug/index.js';
import { NetcoredbgNotFoundError } from '../../adapters/netcoredbg/index.js';
import { formatOutput, formatErrorOutput, writeOutput } from '../output.js';
import { ErrorCode } from '../../schemas/errors.js';
import { mapErrorToExitCode, getResolutionHint } from '../errors.js';
import { SessionManager } from '../../session/index.js';
import { DapClient } from '../../dap/client.js';
import { StdioTransport } from '../../dap/transport/stdio.js';
import { AdapterRegistry } from '../../adapters/registry.js';
import type { LanguageId } from '../../types/adapter.js';

/** Options parsed from the launch command CLI flags. */
interface LaunchOptions {
  readonly language?: string;
  readonly args?: string[];
  readonly cwd?: string;
  readonly env?: string[];
  readonly stopOnEntry?: boolean;
  readonly session?: string;
}

/** Parse environment variable strings (KEY=VALUE) into a record. */
function parseEnvVars(envPairs: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of envPairs) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex > 0) {
      result[pair.slice(0, eqIndex)] = pair.slice(eqIndex + 1);
    }
  }
  return result;
}

/** Register the `launch` command for starting a debug session. */
export function registerLaunchCommand(program: Command): void {
  program
    .command('launch')
    .description('Launch a debug session for a program')
    .argument('<program>', 'Path to the program to debug')
    .option('--language <lang>', 'Programming language (typescript, javascript, python, csharp)')
    .option('--args <args...>', 'Arguments to pass to the debuggee')
    .option('--cwd <dir>', 'Working directory for the debuggee')
    .option('--env <vars...>', 'Environment variables (KEY=VALUE)')
    .option('--stop-on-entry', 'Break on the first line of the program')
    .option('-s, --session <id>', 'Target session ID')
    .action(async (programPath: string, options: LaunchOptions) => {
      try {
        const resolvedPath = resolve(programPath);

        let language: LanguageId;
        if (options.language) {
          language = options.language as LanguageId;
        } else {
          const detected = await detectLanguage(resolvedPath);
          if (!detected) {
            const output = formatErrorOutput(
              'launch',
              ErrorCode.LanguageNotDetected,
              `Could not detect language for: ${resolvedPath}`,
              undefined,
              getResolutionHint(ErrorCode.LanguageNotDetected) ?? undefined,
            );
            writeOutput(output);
            process.exitCode = mapErrorToExitCode(ErrorCode.LanguageNotDetected);
            return;
          }
          language = detected;
        }

        const registry = new AdapterRegistry();
        const adapter = registry.getByLanguage(language);

        const transport = new StdioTransport({
          command: adapter ? String(adapter.type) : language,
          args: [],
        });
        const client = new DapClient({ transport });

        const sessionManager = new SessionManager();

        const env = options.env ? parseEnvVars(options.env) : undefined;

        const session = sessionManager.createSession({
          config: {
            program: resolvedPath,
            language,
            args: options.args,
            cwd: options.cwd,
            env,
            stopOnEntry: options.stopOnEntry,
          },
          client,
        });

        await session.initialize();
        await session.launch({
          program: resolvedPath,
          args: options.args,
          cwd: options.cwd,
          env,
          stopOnEntry: options.stopOnEntry,
        });

        const output = formatOutput('launch', {
          sessionId: session.id,
          state: session.state,
          language,
          program: resolvedPath,
        }, session.id);
        writeOutput(output);
      } catch (error: unknown) {
        const { errorCode, message } = classifyLaunchError(error);
        const output = formatErrorOutput(
          'launch',
          errorCode,
          message,
          undefined,
          getResolutionHint(errorCode) ?? undefined,
        );
        writeOutput(output);
        process.exitCode = mapErrorToExitCode(errorCode);
      }
    });
}

/**
 * Classify a launch error into a specific error code + message.
 * Replaces the old catch-all that always returned LAUNCH_FAILED.
 */
function classifyLaunchError(
  error: unknown,
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

  const msg = error instanceof Error ? error.message : String(error);

  // Detect "Transport is not connected" — usually means adapter didn't start
  if (msg.includes('Transport is not connected')) {
    return {
      errorCode: ErrorCode.AdapterNotFound,
      message: 'Debug adapter failed to start. The transport could not connect. Verify the adapter is installed and accessible.',
    };
  }

  // Detect spawn ENOENT (adapter binary not found)
  if (msg.includes('ENOENT') || msg.includes('spawn')) {
    return {
      errorCode: ErrorCode.AdapterNotFound,
      message: `Debug adapter binary not found. ${msg}`,
    };
  }

  // Detect file not found for the program itself
  if (msg.includes('no such file') || msg.includes('ENOENT')) {
    return {
      errorCode: ErrorCode.FileNotFound,
      message: msg,
    };
  }

  return {
    errorCode: ErrorCode.LaunchFailed,
    message: msg,
  };
}

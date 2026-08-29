import type { Command } from 'commander';

import { formatOutput, formatErrorOutput, writeOutput } from '../output.js';
import { ErrorCode } from '../../schemas/errors.js';
import { mapErrorToExitCode, getResolutionHint } from '../errors.js';
import { sendCommand } from '../reconnect.js';

/** Options parsed from the modules command CLI flags. */
interface ModulesOptions {
  readonly session?: string;
  readonly filter?: string;
}

/** A single module entry for output. */
interface ModuleEntry {
  readonly id: string | number;
  readonly name: string;
  readonly path: string | null;
  readonly symbolStatus: string | null;
  readonly symbolFilePath: string | null;
  readonly version: string | null;
  readonly isOptimized: boolean | null;
}

/** Register the `modules` command for listing loaded modules with symbol info. */
export function registerModulesCommand(program: Command): void {
  program
    .command('modules')
    .description('List loaded modules and their symbol status in the debug session')
    .option('-s, --session <id>', 'Target session ID')
    .option('--filter <text>', 'Filter modules by name (case-insensitive substring match)')
    .action(async (options: ModulesOptions) => {
      try {
        const { sessionId, response } = await sendCommand(
          options.session,
          'modules',
          { startModule: 0, moduleCount: 1000 },
        );

        if (!response.success) {
          const output = formatErrorOutput(
            'modules',
            ErrorCode.InvalidState,
            response.message ?? 'Failed to retrieve modules',
            sessionId,
            getResolutionHint(ErrorCode.InvalidState) ?? undefined,
          );
          writeOutput(output);
          process.exitCode = mapErrorToExitCode(ErrorCode.InvalidState);
          return;
        }

        const body = response.body as {
          modules?: Array<{
            id: string | number;
            name: string;
            path?: string;
            symbolStatus?: string;
            symbolFilePath?: string;
            version?: string;
            isOptimized?: boolean;
          }>;
          totalModules?: number;
        };

        let modules: ModuleEntry[] = (body?.modules ?? []).map((m) => ({
          id: m.id,
          name: m.name,
          path: m.path ?? null,
          symbolStatus: m.symbolStatus ?? null,
          symbolFilePath: m.symbolFilePath ?? null,
          version: m.version ?? null,
          isOptimized: m.isOptimized ?? null,
        }));

        // Apply filter if provided
        if (options.filter) {
          const filterLower = options.filter.toLowerCase();
          modules = modules.filter((m) =>
            m.name.toLowerCase().includes(filterLower),
          );
        }

        const output = formatOutput('modules', {
          modules,
          totalCount: modules.length,
          totalLoaded: body?.totalModules ?? modules.length,
        }, sessionId);
        writeOutput(output);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const isNotFound = message.includes('Session not found') || message.includes('No active session');
        const output = formatErrorOutput(
          'modules',
          isNotFound ? ErrorCode.SessionNotFound : ErrorCode.InvalidState,
          message,
          options.session,
          getResolutionHint(isNotFound ? ErrorCode.SessionNotFound : ErrorCode.InvalidState) ?? undefined,
        );
        writeOutput(output);
        process.exitCode = mapErrorToExitCode(isNotFound ? ErrorCode.SessionNotFound : ErrorCode.InvalidState);
      }
    });
}

import type { Command } from 'commander';
import type { DebugProtocol } from '@vscode/debugprotocol';

import { formatOutput, formatErrorOutput, writeOutput } from '../output.js';
import { ErrorCode } from '../../schemas/errors.js';
import { mapErrorToExitCode, getResolutionHint } from '../errors.js';
import { sendCommand } from '../reconnect.js';

/** Valid exception filter values. */
const VALID_FILTERS = ['all', 'caught', 'uncaught'] as const;

/** Type for valid exception filter values. */
type ExceptionFilter = (typeof VALID_FILTERS)[number];

/** Options parsed from the exception-breakpoints set command. */
interface ExceptionBreakpointSetOptions {
  readonly session?: string;
  readonly filter: string;
}

/** Check if a string is a valid exception filter. */
function isValidFilter(value: string): value is ExceptionFilter {
  return (VALID_FILTERS as readonly string[]).includes(value);
}

/** Map user-facing filter to DAP exception breakpoint filter IDs. */
function mapFilterToDapFilters(filter: ExceptionFilter): string[] {
  switch (filter) {
    case 'all':
      return ['caught', 'uncaught'];
    case 'caught':
      return ['caught'];
    case 'uncaught':
      return ['uncaught'];
  }
}

/** Build DAP SetExceptionBreakpointsArguments from filters. */
function buildSetExceptionBreakpointsArgs(
  filters: readonly string[],
): DebugProtocol.SetExceptionBreakpointsArguments {
  return {
    filters: [...filters],
  };
}

/** Register the `exception-breakpoints` command for configuring exception breakpoints. */
export function registerExceptionBreakpointsCommand(program: Command): void {
  const exBp = program
    .command('exception-breakpoints')
    .description('Configure exception breakpoints');

  exBp
    .command('set')
    .description('Set exception breakpoint filters')
    .requiredOption('--filter <filter>', 'Exception filter: all, caught, or uncaught')
    .option('-s, --session <id>', 'Target session ID')
    .action(async (options: ExceptionBreakpointSetOptions) => {
      try {
        if (!isValidFilter(options.filter)) {
          const output = formatErrorOutput(
            'exception-breakpoints set',
            ErrorCode.BreakpointInvalid,
            `Invalid exception filter: "${options.filter}". Must be one of: ${VALID_FILTERS.join(', ')}`,
            options.session,
          );
          writeOutput(output);
          process.exitCode = mapErrorToExitCode(ErrorCode.BreakpointInvalid);
          return;
        }

        const dapFilters = mapFilterToDapFilters(options.filter);
        const dapArgs = buildSetExceptionBreakpointsArgs(dapFilters);

        const { sessionId, response } = await sendCommand(
          options.session,
          'setExceptionBreakpoints',
          dapArgs,
        );

        if (!response.success) {
          const output = formatErrorOutput(
            'exception-breakpoints set',
            ErrorCode.BreakpointInvalid,
            response.message ?? 'Failed to set exception breakpoints',
            sessionId,
          );
          writeOutput(output);
          process.exitCode = mapErrorToExitCode(ErrorCode.BreakpointInvalid);
          return;
        }

        const output = formatOutput('exception-breakpoints set', {
          filter: options.filter,
          dapFilters,
          enabled: true,
        }, sessionId);
        writeOutput(output);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const isNotFound = message.includes('Session not found') || message.includes('No active session');
        const output = formatErrorOutput(
          'exception-breakpoints set',
          isNotFound ? ErrorCode.SessionNotFound : ErrorCode.BreakpointInvalid,
          message,
          options.session,
        );
        writeOutput(output);
        process.exitCode = mapErrorToExitCode(isNotFound ? ErrorCode.SessionNotFound : ErrorCode.BreakpointInvalid);
      }
    });
}

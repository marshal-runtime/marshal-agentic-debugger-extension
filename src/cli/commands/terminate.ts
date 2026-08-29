import type { Command } from 'commander';

import { formatOutput, formatErrorOutput, writeOutput } from '../output.js';
import { ErrorCode } from '../../schemas/errors.js';
import { mapErrorToExitCode, getResolutionHint } from '../errors.js';
import { sendCommand } from '../reconnect.js';

/** Options parsed from the terminate command CLI flags. */
interface TerminateOptions {
  readonly session?: string;
}

/** Register the `terminate` command for forcefully ending a debug session. */
export function registerTerminateCommand(program: Command): void {
  program
    .command('terminate')
    .description('Terminate a debug session and its debuggee')
    .option('-s, --session <id>', 'Target session ID')
    .action(async (options: TerminateOptions) => {
      try {
        // First send 'terminate' to end the debuggee, then '_shutdown' to
        // tear down the session host daemon.
        const { sessionId, response } = await sendCommand(
          options.session,
          '_shutdown',
          { terminateDebuggee: true },
        );

        if (!response.success) {
          const output = formatErrorOutput(
            'terminate',
            ErrorCode.InvalidState,
            response.message ?? 'Failed to terminate session',
            sessionId,
            getResolutionHint(ErrorCode.InvalidState) ?? undefined,
          );
          writeOutput(output);
          process.exitCode = mapErrorToExitCode(ErrorCode.InvalidState);
          return;
        }

        const output = formatOutput('terminate', {
          sessionId,
          state: 'terminated',
        }, sessionId);
        writeOutput(output);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const isNotFound = message.includes('Session not found') || message.includes('No active session');
        const output = formatErrorOutput(
          'terminate',
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

import type { Command } from 'commander';

import { formatOutput, formatErrorOutput, writeOutput } from '../output.js';
import { ErrorCode } from '../../schemas/errors.js';
import { mapErrorToExitCode, getResolutionHint } from '../errors.js';
import { sendCommand } from '../reconnect.js';

/** Options parsed from the disconnect command CLI flags. */
interface DisconnectOptions {
  readonly session?: string;
  readonly terminateDebuggee?: boolean;
}

/** Register the `disconnect` command for disconnecting from a debug session. */
export function registerDisconnectCommand(program: Command): void {
  program
    .command('disconnect')
    .description('Disconnect from a debug session')
    .option('-s, --session <id>', 'Target session ID')
    .option('--terminate-debuggee', 'Also terminate the debuggee process')
    .action(async (options: DisconnectOptions) => {
      try {
        const { sessionId, response } = await sendCommand(
          options.session,
          '_shutdown',
          { terminateDebuggee: options.terminateDebuggee ?? false },
        );

        if (!response.success) {
          const output = formatErrorOutput(
            'disconnect',
            ErrorCode.InvalidState,
            response.message ?? 'Failed to disconnect',
            sessionId,
            getResolutionHint(ErrorCode.InvalidState) ?? undefined,
          );
          writeOutput(output);
          process.exitCode = mapErrorToExitCode(ErrorCode.InvalidState);
          return;
        }

        const output = formatOutput('disconnect', {
          sessionId,
          state: 'disconnected',
          terminatedDebuggee: options.terminateDebuggee ?? false,
        }, sessionId);
        writeOutput(output);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const isNotFound = message.includes('Session not found') || message.includes('No active session');
        const output = formatErrorOutput(
          'disconnect',
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

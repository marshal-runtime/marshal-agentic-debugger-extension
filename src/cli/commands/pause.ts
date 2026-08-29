import type { Command } from 'commander';

import { formatOutput, formatErrorOutput, writeOutput } from '../output.js';
import { ErrorCode } from '../../schemas/errors.js';
import { mapErrorToExitCode, getResolutionHint } from '../errors.js';
import { sendCommand } from '../reconnect.js';

/** Default thread ID when no stopped thread is available. */
const DEFAULT_THREAD_ID = 1;

/** Options parsed from the pause command CLI flags. */
interface PauseOptions {
  readonly session?: string;
  readonly threadId?: string;
}

/** Register the `pause` command for pausing a running debuggee. */
export function registerPauseCommand(program: Command): void {
  program
    .command('pause')
    .description('Pause execution of a running debuggee')
    .option('-s, --session <id>', 'Target session ID')
    .option('--thread-id <id>', 'Thread ID to pause (default: stopped thread)')
    .action(async (options: PauseOptions) => {
      try {
        const threadId = options.threadId
          ? Number.parseInt(options.threadId, 10)
          : undefined;

        const pauseArgs: Record<string, unknown> = {};
        if (threadId !== undefined) pauseArgs['threadId'] = threadId;

        const { sessionId, response } = await sendCommand(
          options.session,
          'pause',
          pauseArgs,
        );

        if (!response.success) {
          const output = formatErrorOutput(
            'pause',
            ErrorCode.InvalidState,
            response.message ?? 'Failed to pause execution',
            sessionId,
            getResolutionHint(ErrorCode.InvalidState) ?? undefined,
          );
          writeOutput(output);
          process.exitCode = mapErrorToExitCode(ErrorCode.InvalidState);
          return;
        }

        const output = formatOutput('pause', {
          threadId,
          status: 'paused',
        }, sessionId);
        writeOutput(output);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const isNotFound = message.includes('Session not found') || message.includes('No active session');
        const output = formatErrorOutput(
          'pause',
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

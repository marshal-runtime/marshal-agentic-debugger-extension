import type { Command } from 'commander';

import { formatOutput, formatErrorOutput, writeOutput } from '../output.js';
import { ErrorCode } from '../../schemas/errors.js';
import { mapErrorToExitCode, getResolutionHint } from '../errors.js';
import { sendCommand } from '../reconnect.js';

/** Default thread ID when no stopped thread is available. */
const DEFAULT_THREAD_ID = 1;

/** Options parsed from the continue command CLI flags. */
interface ContinueOptions {
  readonly session?: string;
  readonly threadId?: string;
}

/** Register the `continue` command for resuming execution. */
export function registerContinueCommand(program: Command): void {
  program
    .command('continue')
    .description('Continue execution of a paused debuggee')
    .option('-s, --session <id>', 'Target session ID')
    .option('--thread-id <id>', 'Thread ID to continue (default: stopped thread)')
    .action(async (options: ContinueOptions) => {
      try {
        const threadId = options.threadId
          ? Number.parseInt(options.threadId, 10)
          : undefined;

        const continueArgs: Record<string, unknown> = {};
        if (threadId !== undefined) continueArgs['threadId'] = threadId;

        const { sessionId, response } = await sendCommand(
          options.session,
          'continue',
          continueArgs,
        );

        if (!response.success) {
          const output = formatErrorOutput(
            'continue',
            ErrorCode.InvalidState,
            response.message ?? 'Failed to continue execution',
            sessionId,
            getResolutionHint(ErrorCode.InvalidState) ?? undefined,
          );
          writeOutput(output);
          process.exitCode = mapErrorToExitCode(ErrorCode.InvalidState);
          return;
        }

        const output = formatOutput('continue', {
          threadId,
          status: 'continued',
        }, sessionId);
        writeOutput(output);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const isNotFound = message.includes('Session not found') || message.includes('No active session');
        const output = formatErrorOutput(
          'continue',
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

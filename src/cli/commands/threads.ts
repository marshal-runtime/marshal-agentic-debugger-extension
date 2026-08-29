import type { Command } from 'commander';
import type { DebugProtocol } from '@vscode/debugprotocol';

import { formatOutput, formatErrorOutput, writeOutput } from '../output.js';
import { ErrorCode } from '../../schemas/errors.js';
import { mapErrorToExitCode, getResolutionHint } from '../errors.js';
import { sendCommand } from '../reconnect.js';

/** Options parsed from the threads command CLI flags. */
interface ThreadsOptions {
  readonly session?: string;
}

/** A single thread entry for output. */
interface ThreadEntry {
  readonly id: number;
  readonly name: string;
}

/** Register the `threads` command for listing debuggee threads. */
export function registerThreadsCommand(program: Command): void {
  program
    .command('threads')
    .description('List all threads in the debug session')
    .option('-s, --session <id>', 'Target session ID')
    .action(async (options: ThreadsOptions) => {
      try {
        const { sessionId, response } = await sendCommand(
          options.session,
          'threads',
        );

        if (!response.success) {
          const output = formatErrorOutput(
            'threads',
            ErrorCode.InvalidState,
            response.message ?? 'Failed to retrieve threads',
            sessionId,
            getResolutionHint(ErrorCode.InvalidState) ?? undefined,
          );
          writeOutput(output);
          process.exitCode = mapErrorToExitCode(ErrorCode.InvalidState);
          return;
        }

        const body = response.body as {
          threads?: DebugProtocol.Thread[];
        };

        const threads: ThreadEntry[] = (body?.threads ?? []).map((t) => ({
          id: t.id,
          name: t.name,
        }));

        const output = formatOutput('threads', {
          threads,
          totalCount: threads.length,
        }, sessionId);
        writeOutput(output);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const isNotFound = message.includes('Session not found') || message.includes('No active session');
        const output = formatErrorOutput(
          'threads',
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

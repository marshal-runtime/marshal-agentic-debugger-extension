import { resolve } from 'node:path';

import type { Command } from 'commander';

import { formatOutput, formatErrorOutput, writeOutput } from '../output.js';
import { ErrorCode } from '../../schemas/errors.js';
import { mapErrorToExitCode, getResolutionHint } from '../errors.js';
import { sendCommand } from '../reconnect.js';

/** Default thread ID when no stopped thread is available. */
const DEFAULT_THREAD_ID = 1;

/** Options parsed from the set-next-statement command CLI flags. */
interface SetNextStatementOptions {
  readonly session?: string;
  readonly threadId?: string;
}

/** Parse a "file:line" location string into its components. */
function parseFileLineLocation(location: string): { file: string; line: number } | null {
  const lastColon = location.lastIndexOf(':');
  if (lastColon <= 0) {
    return null;
  }

  const file = location.slice(0, lastColon);
  const lineStr = location.slice(lastColon + 1);
  const line = Number.parseInt(lineStr, 10);

  if (!Number.isFinite(line) || line < 1) {
    return null;
  }

  return { file: resolve(file), line };
}

/** Register the `set-next-statement` command for moving the execution point. */
export function registerSetNextStatementCommand(program: Command): void {
  program
    .command('set-next-statement')
    .description('Set the next statement to execute (goto)')
    .argument('<location>', 'Target location (file:line)')
    .option('-s, --session <id>', 'Target session ID')
    .option('--thread-id <id>', 'Thread ID to move execution point for (default: stopped thread)')
    .action(async (location: string, options: SetNextStatementOptions) => {
      try {
        const parsed = parseFileLineLocation(location);
        if (!parsed) {
          const output = formatErrorOutput(
            'set-next-statement',
            ErrorCode.InvalidState,
            `Invalid location: "${location}". Expected format: file:line`,
            options.session,
          );
          writeOutput(output);
          process.exitCode = mapErrorToExitCode(ErrorCode.InvalidState);
          return;
        }

        const threadId = options.threadId
          ? Number.parseInt(options.threadId, 10)
          : DEFAULT_THREAD_ID;

        // First, get goto targets
        const { sessionId, response: targetsResponse } = await sendCommand(
          options.session,
          'gotoTargets',
          {
            source: { path: parsed.file },
            line: parsed.line,
          },
        );

        if (!targetsResponse.success) {
          const output = formatErrorOutput(
            'set-next-statement',
            ErrorCode.CapabilityNotSupported,
            targetsResponse.message ?? 'The debug adapter does not support set-next-statement (gotoTargets).',
            sessionId,
            'This capability depends on the debug adapter. Not all adapters support it.',
          );
          writeOutput(output);
          process.exitCode = mapErrorToExitCode(ErrorCode.CapabilityNotSupported);
          return;
        }

        const targetsBody = targetsResponse.body as {
          targets?: Array<{ id: number; label: string; line: number }>;
        };

        const targets = targetsBody?.targets ?? [];
        if (targets.length === 0) {
          const output = formatErrorOutput(
            'set-next-statement',
            ErrorCode.InvalidState,
            `No valid goto targets found at ${parsed.file}:${parsed.line}`,
            sessionId,
          );
          writeOutput(output);
          process.exitCode = mapErrorToExitCode(ErrorCode.InvalidState);
          return;
        }

        // Use the first target
        const targetId = targets[0]!.id;

        const { response: gotoResponse } = await sendCommand(
          options.session,
          'goto',
          { threadId, targetId },
        );

        if (!gotoResponse.success) {
          const output = formatErrorOutput(
            'set-next-statement',
            ErrorCode.InvalidState,
            gotoResponse.message ?? 'Failed to set next statement',
            sessionId,
          );
          writeOutput(output);
          process.exitCode = mapErrorToExitCode(ErrorCode.InvalidState);
          return;
        }

        const output = formatOutput('set-next-statement', {
          threadId,
          file: parsed.file,
          line: parsed.line,
          status: 'moved',
        }, sessionId);
        writeOutput(output);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const isNotFound = message.includes('Session not found') || message.includes('No active session');
        const output = formatErrorOutput(
          'set-next-statement',
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

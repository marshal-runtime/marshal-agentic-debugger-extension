import type { Command } from 'commander';
import type { DebugProtocol } from '@vscode/debugprotocol';

import { formatOutput, formatErrorOutput, writeOutput } from '../output.js';
import { ErrorCode } from '../../schemas/errors.js';
import { mapErrorToExitCode, getResolutionHint } from '../errors.js';
import { sendCommand } from '../reconnect.js';

/** Default number of stack frames to return per page. */
const DEFAULT_LEVELS = 20;

/** Default thread ID when none is specified. */
const DEFAULT_THREAD_ID = 1;

/** Options parsed from the callstack command CLI flags. */
interface CallstackOptions {
  readonly session?: string;
  readonly threadId?: string;
  readonly levels?: string;
  readonly startFrame?: string;
}

/** A single stack frame entry for output. */
interface StackFrameEntry {
  readonly id: number;
  readonly name: string;
  readonly source: string | null;
  readonly line: number;
  readonly column: number;
}

/** Register the `callstack` command for retrieving the call stack. */
export function registerCallstackCommand(program: Command): void {
  program
    .command('callstack')
    .description('Get the call stack for the current debug session')
    .option('-s, --session <id>', 'Target session ID')
    .option('--thread-id <id>', 'Thread ID to get call stack for')
    .option('--levels <num>', 'Maximum number of frames to return', String(DEFAULT_LEVELS))
    .option('--start-frame <index>', 'Start frame index for pagination', '0')
    .action(async (options: CallstackOptions) => {
      try {
        const threadId = options.threadId
          ? Number.parseInt(options.threadId, 10)
          : undefined;
        const levels = options.levels
          ? Number.parseInt(options.levels, 10)
          : DEFAULT_LEVELS;
        const startFrame = options.startFrame
          ? Number.parseInt(options.startFrame, 10)
          : 0;

        const stackTraceArgs: Record<string, unknown> = { startFrame, levels };
        if (threadId !== undefined) stackTraceArgs['threadId'] = threadId;

        const { sessionId, response } = await sendCommand(
          options.session,
          'stackTrace',
          stackTraceArgs as unknown as DebugProtocol.StackTraceArguments,
        );

        if (!response.success) {
          const output = formatErrorOutput(
            'callstack',
            ErrorCode.InvalidState,
            response.message ?? 'Failed to retrieve call stack',
            sessionId,
            getResolutionHint(ErrorCode.InvalidState) ?? undefined,
          );
          writeOutput(output);
          process.exitCode = mapErrorToExitCode(ErrorCode.InvalidState);
          return;
        }

        const body = response.body as {
          stackFrames?: DebugProtocol.StackFrame[];
          totalFrames?: number;
        };

        const frames: StackFrameEntry[] = (body?.stackFrames ?? []).map((f) => ({
          id: f.id,
          name: f.name,
          source: f.source?.path ?? f.source?.name ?? null,
          line: f.line,
          column: f.column,
        }));

        const totalFrames = body?.totalFrames ?? frames.length;

        const output = formatOutput('callstack', {
          threadId,
          startFrame,
          levels,
          totalFrames,
          frames,
        }, sessionId);
        writeOutput(output);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const isNotFound = message.includes('Session not found') || message.includes('No active session');
        const output = formatErrorOutput(
          'callstack',
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

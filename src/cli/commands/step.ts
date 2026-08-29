import type { Command } from 'commander';

import { formatOutput, formatErrorOutput, writeOutput } from '../output.js';
import { ErrorCode } from '../../schemas/errors.js';
import { mapErrorToExitCode, getResolutionHint } from '../errors.js';
import { sendCommand } from '../reconnect.js';

/** Default thread ID when no stopped thread is available. */
const DEFAULT_THREAD_ID = 1;

/** Options parsed from the step subcommand CLI flags. */
interface StepOptions {
  readonly session?: string;
  readonly threadId?: string;
}

/** Options parsed from the restart-frame subcommand CLI flags. */
interface RestartFrameOptions {
  readonly session?: string;
  readonly frameId?: string;
}

/** Resolve the thread ID from options or return undefined to let the session host default to the last stopped thread. */
function resolveThreadId(options: StepOptions): number | undefined {
  return options.threadId
    ? Number.parseInt(options.threadId, 10)
    : undefined;
}

/** Helper to execute a step-type DAP command. */
async function executeStepCommand(
  commandLabel: string,
  dapCommand: string,
  options: StepOptions,
  action: string,
): Promise<void> {
  try {
    const threadId = resolveThreadId(options);

    const stepArgs: Record<string, unknown> = {};
    if (threadId !== undefined) stepArgs['threadId'] = threadId;

    const { sessionId, response } = await sendCommand(
      options.session,
      dapCommand,
      stepArgs,
    );

    if (!response.success) {
      const output = formatErrorOutput(
        commandLabel,
        ErrorCode.InvalidState,
        response.message ?? `Failed to ${commandLabel}`,
        sessionId,
        getResolutionHint(ErrorCode.InvalidState) ?? undefined,
      );
      writeOutput(output);
      process.exitCode = mapErrorToExitCode(ErrorCode.InvalidState);
      return;
    }

    const output = formatOutput(commandLabel, {
      threadId,
      action,
      status: 'stepped',
    }, sessionId);
    writeOutput(output);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const isNotFound = message.includes('Session not found') || message.includes('No active session');
    const output = formatErrorOutput(
      commandLabel,
      isNotFound ? ErrorCode.SessionNotFound : ErrorCode.InvalidState,
      message,
      options.session,
      getResolutionHint(isNotFound ? ErrorCode.SessionNotFound : ErrorCode.InvalidState) ?? undefined,
    );
    writeOutput(output);
    process.exitCode = mapErrorToExitCode(isNotFound ? ErrorCode.SessionNotFound : ErrorCode.InvalidState);
  }
}

/** Register the `step` command with `over`, `into`, and `out` subcommands. */
export function registerStepCommand(program: Command): void {
  const step = program.command('step').description('Step through code execution');

  step
    .command('over')
    .description('Step over the current statement')
    .option('-s, --session <id>', 'Target session ID')
    .option('--thread-id <id>', 'Thread ID to step (default: stopped thread)')
    .action(async (options: StepOptions) => {
      await executeStepCommand('step over', 'next', options, 'next');
    });

  step
    .command('into')
    .description('Step into a function call')
    .option('-s, --session <id>', 'Target session ID')
    .option('--thread-id <id>', 'Thread ID to step (default: stopped thread)')
    .action(async (options: StepOptions) => {
      await executeStepCommand('step into', 'stepIn', options, 'stepIn');
    });

  step
    .command('out')
    .description('Step out of the current function')
    .option('-s, --session <id>', 'Target session ID')
    .option('--thread-id <id>', 'Thread ID to step (default: stopped thread)')
    .action(async (options: StepOptions) => {
      await executeStepCommand('step out', 'stepOut', options, 'stepOut');
    });

  step
    .command('restart-frame')
    .description('Restart execution from a specific stack frame')
    .option('-s, --session <id>', 'Target session ID')
    .requiredOption('--frame-id <id>', 'Stack frame ID to restart')
    .action(async (options: RestartFrameOptions) => {
      try {
        const frameId = Number.parseInt(options.frameId!, 10);

        const { sessionId, response } = await sendCommand(
          options.session,
          'restartFrame',
          { frameId },
        );

        if (!response.success) {
          const output = formatErrorOutput(
            'step restart-frame',
            ErrorCode.InvalidState,
            response.message ?? 'Failed to restart frame',
            sessionId,
            getResolutionHint(ErrorCode.InvalidState) ?? undefined,
          );
          writeOutput(output);
          process.exitCode = mapErrorToExitCode(ErrorCode.InvalidState);
          return;
        }

        const output = formatOutput('step restart-frame', {
          frameId,
          action: 'restartFrame',
          status: 'restarted',
        }, sessionId);
        writeOutput(output);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const isNotFound = message.includes('Session not found') || message.includes('No active session');
        const output = formatErrorOutput(
          'step restart-frame',
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

import type { Command } from 'commander';
import type { DebugProtocol } from '@vscode/debugprotocol';

import { formatOutput, formatErrorOutput, writeOutput } from '../output.js';
import { ErrorCode } from '../../schemas/errors.js';
import { mapErrorToExitCode, getResolutionHint } from '../errors.js';
import { sendCommand, resolvePersistedSession } from '../reconnect.js';
import { isSafeExpression } from '../../security/eval-safety.js';

/** Per-session watch expression store. */
const watchStore = new Map<string, string[]>();

/** Get the watch list for a session. */
function getWatchList(sessionId: string): string[] {
  let list = watchStore.get(sessionId);
  if (!list) {
    list = [];
    watchStore.set(sessionId, list);
  }
  return list;
}

/** Options parsed from the watch add command. */
interface WatchAddOptions {
  readonly session?: string;
}

/** Options parsed from the watch remove command. */
interface WatchRemoveOptions {
  readonly session?: string;
}

/** Options parsed from the watch list command. */
interface WatchListOptions {
  readonly session?: string;
}

/** A single watch expression evaluation result. */
interface WatchEntry {
  readonly expression: string;
  readonly result: string | null;
  readonly type: string | null;
  readonly variablesReference: number;
  readonly error: string | null;
}

/** Evaluate a single watch expression via the session host. */
async function evaluateWatchExpression(
  sessionId: string | undefined,
  expression: string,
): Promise<WatchEntry> {
  try {
    const dapArgs: DebugProtocol.EvaluateArguments = {
      expression,
      context: 'watch',
    };

    const { response } = await sendCommand(sessionId, 'evaluate', dapArgs);

    if (!response.success) {
      return {
        expression,
        result: null,
        type: null,
        variablesReference: 0,
        error: response.message ?? 'Evaluation failed',
      };
    }

    const body = response.body as {
      result?: string;
      type?: string;
      variablesReference?: number;
    };

    return {
      expression,
      result: body?.result ?? null,
      type: body?.type ?? null,
      variablesReference: body?.variablesReference ?? 0,
      error: null,
    };
  } catch (err: unknown) {
    return {
      expression,
      result: null,
      type: null,
      variablesReference: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Evaluate all watch expressions for a session. */
async function evaluateAllWatchExpressions(
  sessionId: string | undefined,
  expressions: readonly string[],
): Promise<WatchEntry[]> {
  const results: WatchEntry[] = [];
  for (const expression of expressions) {
    const result = await evaluateWatchExpression(sessionId, expression);
    results.push(result);
  }
  return results;
}

/** Resolve the session ID from options, or throw if none found. */
function resolveSessionId(sessionOpt?: string): string {
  const persisted = resolvePersistedSession(sessionOpt);
  if (!persisted) {
    throw new Error(
      sessionOpt
        ? `Session not found: ${sessionOpt}`
        : 'No active session found. Run "agentic-debugger attach" first.',
    );
  }
  return persisted.sessionId;
}

/** Register the `watch` command with add/remove/list subcommands. */
export function registerWatchCommand(program: Command): void {
  const watch = program.command('watch').description('Manage watch expressions');

  watch
    .command('add')
    .description('Add a watch expression')
    .argument('<expression>', 'Expression to watch')
    .option('-s, --session <id>', 'Target session ID')
    .action(async (expression: string, options: WatchAddOptions) => {
      try {
        const sessionId = resolveSessionId(options.session);

        const safetyResult = isSafeExpression(expression, {
          interfaceContext: 'cli',
        });

        const watchList = getWatchList(sessionId);

        if (watchList.includes(expression)) {
          const output = formatOutput('watch add', {
            expression,
            status: 'already_exists',
            warning: safetyResult.warning ?? null,
            totalExpressions: watchList.length,
          }, sessionId);
          writeOutput(output);
          return;
        }

        watchList.push(expression);

        const currentValue = await evaluateWatchExpression(options.session, expression);

        const output = formatOutput('watch add', {
          expression,
          status: 'added',
          currentValue,
          warning: safetyResult.warning ?? null,
          totalExpressions: watchList.length,
        }, sessionId);
        writeOutput(output);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const output = formatErrorOutput(
          'watch add',
          ErrorCode.ExpressionEvalFailed,
          message,
          options.session,
          getResolutionHint(ErrorCode.ExpressionEvalFailed) ?? undefined,
        );
        writeOutput(output);
        process.exitCode = mapErrorToExitCode(ErrorCode.ExpressionEvalFailed);
      }
    });

  watch
    .command('remove')
    .description('Remove a watch expression')
    .argument('<expression>', 'Expression to remove from watch list')
    .option('-s, --session <id>', 'Target session ID')
    .action(async (expression: string, options: WatchRemoveOptions) => {
      try {
        const sessionId = resolveSessionId(options.session);

        const watchList = getWatchList(sessionId);
        const index = watchList.indexOf(expression);

        if (index === -1) {
          const output = formatErrorOutput(
            'watch remove',
            ErrorCode.ExpressionEvalFailed,
            `Watch expression not found: "${expression}"`,
            sessionId,
          );
          writeOutput(output);
          process.exitCode = mapErrorToExitCode(ErrorCode.ExpressionEvalFailed);
          return;
        }

        watchList.splice(index, 1);

        const output = formatOutput('watch remove', {
          expression,
          status: 'removed',
          totalExpressions: watchList.length,
        }, sessionId);
        writeOutput(output);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const isNotFound = message.includes('Session not found') || message.includes('No active session');
        const output = formatErrorOutput(
          'watch remove',
          isNotFound ? ErrorCode.SessionNotFound : ErrorCode.InvalidState,
          message,
          options.session,
          getResolutionHint(isNotFound ? ErrorCode.SessionNotFound : ErrorCode.InvalidState) ?? undefined,
        );
        writeOutput(output);
        process.exitCode = mapErrorToExitCode(ErrorCode.InvalidState);
      }
    });

  watch
    .command('list')
    .description('List all watch expressions and their current values')
    .option('-s, --session <id>', 'Target session ID')
    .action(async (options: WatchListOptions) => {
      try {
        const sessionId = resolveSessionId(options.session);

        const watchList = getWatchList(sessionId);
        const results = await evaluateAllWatchExpressions(options.session, watchList);

        const output = formatOutput('watch list', {
          expressions: results,
          totalCount: results.length,
        }, sessionId);
        writeOutput(output);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const isNotFound = message.includes('Session not found') || message.includes('No active session');
        const output = formatErrorOutput(
          'watch list',
          isNotFound ? ErrorCode.SessionNotFound : ErrorCode.InvalidState,
          message,
          options.session,
          getResolutionHint(isNotFound ? ErrorCode.SessionNotFound : ErrorCode.InvalidState) ?? undefined,
        );
        writeOutput(output);
        process.exitCode = mapErrorToExitCode(ErrorCode.InvalidState);
      }
    });
}

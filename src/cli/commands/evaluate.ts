import type { Command } from 'commander';
import type { DebugProtocol } from '@vscode/debugprotocol';

import { formatOutput, formatErrorOutput, writeOutput } from '../output.js';
import { ErrorCode } from '../../schemas/errors.js';
import { mapErrorToExitCode, getResolutionHint } from '../errors.js';
import { sendCommand } from '../reconnect.js';
import { isSafeExpression } from '../../security/eval-safety.js';
import { DEFAULT_CONFIG } from '../../config/defaults.js';

/** Options parsed from the evaluate command CLI flags. */
interface EvaluateOptions {
  readonly session?: string;
  readonly frame?: string;
  readonly context?: string;
  readonly timeout?: string;
  readonly safeMode?: boolean;
}

/** Result of an expression evaluation. */
interface EvaluateResult {
  readonly expression: string;
  readonly result: string;
  readonly type: string;
  readonly variablesReference: number;
  readonly warning: string | null;
}

/** Register the `evaluate` command for evaluating expressions. */
export function registerEvaluateCommand(program: Command): void {
  program
    .command('evaluate')
    .description('Evaluate an expression in the debuggee context')
    .argument('<expression>', 'Expression to evaluate')
    .option('-s, --session <id>', 'Target session ID')
    .option('--frame <id>', 'Stack frame ID for evaluation context')
    .option('--context <ctx>', 'Evaluation context: watch, repl, or hover', 'repl')
    .option('--timeout <ms>', 'Evaluation timeout in milliseconds', String(DEFAULT_CONFIG.evalTimeout))
    .option('--safe-mode', 'Enable safe mode to warn on mutations')
    .action(async (expression: string, options: EvaluateOptions) => {
      try {
        let safetyWarning: string | null = null;

        if (options.safeMode) {
          const safetyResult = isSafeExpression(expression, {
            mode: 'safe',
            interfaceContext: 'cli',
          });

          if (!safetyResult.safe) {
            safetyWarning = safetyResult.warning ?? null;

            // We don't have a sessionId yet, but that's fine for blocked output
            const output = formatOutput('evaluate', {
              expression,
              result: null,
              type: null,
              variablesReference: 0,
              warning: safetyWarning,
              blocked: true,
            }, options.session);
            writeOutput(output);
            return;
          }

          if (safetyResult.warning) {
            safetyWarning = safetyResult.warning;
          }
        }

        const frameId = options.frame
          ? Number.parseInt(options.frame, 10)
          : undefined;
        const context = (options.context ?? 'repl') as
          | 'watch'
          | 'repl'
          | 'hover';

        const dapArgs: DebugProtocol.EvaluateArguments = {
          expression,
          frameId,
          context,
        };

        const { sessionId, response } = await sendCommand(
          options.session,
          'evaluate',
          dapArgs,
        );

        if (!response.success) {
          const output = formatErrorOutput(
            'evaluate',
            ErrorCode.ExpressionEvalFailed,
            response.message ?? 'Expression evaluation failed',
            sessionId,
            getResolutionHint(ErrorCode.ExpressionEvalFailed) ?? undefined,
          );
          writeOutput(output);
          process.exitCode = mapErrorToExitCode(ErrorCode.ExpressionEvalFailed);
          return;
        }

        const body = response.body as {
          result?: string;
          type?: string;
          variablesReference?: number;
        };

        const evalResult: EvaluateResult = {
          expression,
          result: body?.result ?? '',
          type: body?.type ?? 'unknown',
          variablesReference: body?.variablesReference ?? 0,
          warning: safetyWarning,
        };

        const output = formatOutput('evaluate', evalResult, sessionId);
        writeOutput(output);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const isNotFound = message.includes('Session not found') || message.includes('No active session');
        const output = formatErrorOutput(
          'evaluate',
          isNotFound ? ErrorCode.SessionNotFound : ErrorCode.ExpressionEvalFailed,
          message,
          options.session,
          getResolutionHint(isNotFound ? ErrorCode.SessionNotFound : ErrorCode.ExpressionEvalFailed) ?? undefined,
        );
        writeOutput(output);
        process.exitCode = mapErrorToExitCode(isNotFound ? ErrorCode.SessionNotFound : ErrorCode.ExpressionEvalFailed);
      }
    });
}

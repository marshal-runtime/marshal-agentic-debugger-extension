import type { Command } from 'commander';
import type { DebugProtocol } from '@vscode/debugprotocol';

import { formatOutput, formatErrorOutput, writeOutput } from '../output.js';
import { ErrorCode } from '../../schemas/errors.js';
import { mapErrorToExitCode, getResolutionHint } from '../errors.js';
import { sendCommand } from '../reconnect.js';
import { redactValue } from '../../security/redaction.js';

/** Default maximum depth for recursive variable expansion. */
const DEFAULT_DEPTH = 1;

/** Default maximum number of properties to return per scope. */
const DEFAULT_MAX_PROPERTIES = 100;

/** Default thread ID when none is specified. */
const DEFAULT_THREAD_ID = 1;

/** Options parsed from the variables command CLI flags. */
interface VariablesOptions {
  readonly session?: string;
  readonly ref?: string;
  readonly frame?: string;
  readonly depth?: string;
  readonly maxProperties?: string;
}

/** A single variable entry with redaction applied. */
interface VariableEntry {
  readonly name: string;
  readonly value: string;
  readonly type: string;
  readonly variablesReference: number;
  readonly redacted: boolean;
}

/** Scope information returned from DAP. */
interface ScopeEntry {
  readonly name: string;
  readonly variablesReference: number;
  readonly expensive: boolean;
  readonly variables: VariableEntry[];
}

/** Fetch variables by reference via the session host daemon. */
async function fetchVariables(
  sessionId: string | undefined,
  variablesReference: number,
  maxProperties: number,
): Promise<VariableEntry[]> {
  const dapArgs: DebugProtocol.VariablesArguments = {
    variablesReference,
    count: maxProperties,
  };

  const { response } = await sendCommand(
    sessionId,
    'variables',
    dapArgs,
  );

  if (!response.success) {
    return [];
  }

  const body = response.body as {
    variables?: DebugProtocol.Variable[];
  };

  return (body?.variables ?? []).map((v) => {
    const redaction = redactValue(v.name, v.value ?? '');
    return {
      name: v.name,
      value: redaction.value,
      type: v.type ?? 'unknown',
      variablesReference: v.variablesReference,
      redacted: redaction.redacted,
    };
  });
}

/** Register the `variables` command for inspecting variables. */
export function registerVariablesCommand(program: Command): void {
  program
    .command('variables')
    .description('Inspect variables in the current scope')
    .option('-s, --session <id>', 'Target session ID')
    .option('--ref <reference>', 'Variables reference for expanding children')
    .option('--frame <id>', 'Stack frame ID to inspect')
    .option('--depth <num>', 'Maximum depth for recursive expansion', String(DEFAULT_DEPTH))
    .option('--max-properties <num>', 'Maximum properties per scope', String(DEFAULT_MAX_PROPERTIES))
    .action(async (options: VariablesOptions) => {
      try {
        const depth = options.depth
          ? Number.parseInt(options.depth, 10)
          : DEFAULT_DEPTH;
        const maxProperties = options.maxProperties
          ? Number.parseInt(options.maxProperties, 10)
          : DEFAULT_MAX_PROPERTIES;

        // If --ref is provided, directly expand that variables reference
        if (options.ref) {
          const variablesReference = Number.parseInt(options.ref, 10);
          const variables = await fetchVariables(
            options.session,
            variablesReference,
            maxProperties,
          );

          // For variables we need a sessionId for output — resolve it
          const persisted = await import('../reconnect.js').then((m) =>
            m.resolvePersistedSession(options.session),
          );
          const sessionId = persisted?.sessionId ?? options.session;

          const output = formatOutput('variables', {
            variablesReference,
            variables,
            depth,
            maxProperties,
          }, sessionId);
          writeOutput(output);
          return;
        }

        // Get the top stack frame if --frame not specified
        let resolvedFrameId: number;
        if (options.frame) {
          resolvedFrameId = Number.parseInt(options.frame, 10);
        } else {
          // Get the first frame from the call stack
          const { sessionId: sid, response: stResponse } = await sendCommand(
            options.session,
            'stackTrace',
            { threadId: DEFAULT_THREAD_ID, levels: 1 } satisfies DebugProtocol.StackTraceArguments,
          );

          if (!stResponse.success) {
            const output = formatErrorOutput(
              'variables',
              ErrorCode.InvalidState,
              stResponse.message ?? 'Failed to get stack trace for variable inspection',
              sid,
              getResolutionHint(ErrorCode.InvalidState) ?? undefined,
            );
            writeOutput(output);
            process.exitCode = mapErrorToExitCode(ErrorCode.InvalidState);
            return;
          }

          const stBody = stResponse.body as {
            stackFrames?: DebugProtocol.StackFrame[];
          };
          const topFrame = stBody?.stackFrames?.[0];
          resolvedFrameId = topFrame?.id ?? 0;
        }

        // Get scopes for the frame
        const { sessionId, response: scopesResponse } = await sendCommand(
          options.session,
          'scopes',
          { frameId: resolvedFrameId } satisfies DebugProtocol.ScopesArguments,
        );

        if (!scopesResponse.success) {
          const output = formatErrorOutput(
            'variables',
            ErrorCode.InvalidState,
            scopesResponse.message ?? 'Failed to retrieve scopes',
            sessionId,
            getResolutionHint(ErrorCode.InvalidState) ?? undefined,
          );
          writeOutput(output);
          process.exitCode = mapErrorToExitCode(ErrorCode.InvalidState);
          return;
        }

        const scopesBody = scopesResponse.body as {
          scopes?: DebugProtocol.Scope[];
        };

        // Fetch variables for each non-expensive scope
        const scopes: ScopeEntry[] = [];
        for (const scope of scopesBody?.scopes ?? []) {
          const variables = scope.expensive
            ? []
            : await fetchVariables(
                options.session,
                scope.variablesReference,
                maxProperties,
              );

          scopes.push({
            name: scope.name,
            variablesReference: scope.variablesReference,
            expensive: scope.expensive,
            variables,
          });
        }

        const output = formatOutput('variables', {
          frameId: resolvedFrameId,
          scopes,
          depth,
          maxProperties,
        }, sessionId);
        writeOutput(output);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const isNotFound = message.includes('Session not found') || message.includes('No active session');
        const output = formatErrorOutput(
          'variables',
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

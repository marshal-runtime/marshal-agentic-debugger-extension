import { resolve } from 'node:path';

import type { Command } from 'commander';
import type { DebugProtocol } from '@vscode/debugprotocol';

import { formatOutput, formatErrorOutput, writeOutput } from '../output.js';
import { ErrorCode } from '../../schemas/errors.js';
import { mapErrorToExitCode, getResolutionHint } from '../errors.js';
import { persistBreakpoints, loadBreakpoints } from '../session-persist.js';
import { sendCommand as sendSessionCmd, resolvePersistedSession } from '../reconnect.js';

/** A stored line breakpoint entry. */
interface StoredLineBreakpoint {
  readonly file: string;
  readonly line: number;
  readonly condition?: string;
  readonly hitCondition?: string;
  readonly logMessage?: string;
  readonly verified: boolean;
  readonly enabled: boolean;
  readonly id?: number;
}

/** A stored function breakpoint entry. */
interface StoredFunctionBreakpoint {
  readonly name: string;
  readonly condition?: string;
  readonly hitCondition?: string;
  readonly verified: boolean;
  readonly enabled: boolean;
  readonly id?: number;
}

/** Per-session breakpoint state. */
interface SessionBreakpointState {
  readonly lineBreakpoints: Map<string, StoredLineBreakpoint[]>;
  readonly functionBreakpoints: StoredFunctionBreakpoint[];
}

/** Options parsed from the breakpoint set command. */
interface BreakpointSetOptions {
  readonly session?: string;
  readonly file?: string;
  readonly line?: string;
  readonly condition?: string;
  readonly hitCondition?: string;
  readonly logMessage?: string;
  readonly function?: string;
}

/** Options parsed from the breakpoint remove command. */
interface BreakpointRemoveOptions {
  readonly session?: string;
  readonly all?: boolean;
}

/** Options parsed from the breakpoint list command. */
interface BreakpointListOptions {
  readonly session?: string;
}

/** Options parsed from the breakpoint enable/disable command. */
interface BreakpointToggleOptions {
  readonly session?: string;
}

/** Module-level breakpoint store keyed by session ID. */
const breakpointStore = new Map<string, SessionBreakpointState>();

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

/** Get or create the breakpoint state for a session, loading from disk if available. */
function getSessionState(sessionId: string): SessionBreakpointState {
  let state = breakpointStore.get(sessionId);
  if (!state) {
    // Try loading from disk (cross-process persistence)
    const persisted = loadBreakpoints(sessionId);
    if (persisted) {
      const lineMap = new Map<string, StoredLineBreakpoint[]>();
      for (const [file, bps] of Object.entries(persisted.lineBreakpoints)) {
        lineMap.set(file, bps.map((bp) => ({ ...bp })));
      }
      state = {
        lineBreakpoints: lineMap,
        functionBreakpoints: persisted.functionBreakpoints.map((bp) => ({ ...bp })),
      };
    } else {
      state = {
        lineBreakpoints: new Map<string, StoredLineBreakpoint[]>(),
        functionBreakpoints: [],
      };
    }
    breakpointStore.set(sessionId, state);
  }
  return state;
}

/** Save breakpoint state to disk for cross-process access. */
function saveSessionState(sessionId: string, state: SessionBreakpointState): void {
  const lineBreakpoints: Record<string, StoredLineBreakpoint[]> = {};
  for (const [file, bps] of state.lineBreakpoints) {
    lineBreakpoints[file] = bps;
  }
  persistBreakpoints(sessionId, {
    lineBreakpoints,
    functionBreakpoints: state.functionBreakpoints,
  });
}

/** Build DAP SetBreakpointsArguments for a given file from the store. */
function buildSetBreakpointsArgs(
  file: string,
  breakpoints: readonly StoredLineBreakpoint[],
): DebugProtocol.SetBreakpointsArguments {
  const enabledBreakpoints = breakpoints.filter((bp) => bp.enabled);
  return {
    source: { path: file },
    breakpoints: enabledBreakpoints.map((bp) => {
      const sourceBreakpoint: DebugProtocol.SourceBreakpoint = { line: bp.line };
      if (bp.condition) {
        sourceBreakpoint.condition = bp.condition;
      }
      if (bp.hitCondition) {
        sourceBreakpoint.hitCondition = bp.hitCondition;
      }
      if (bp.logMessage) {
        sourceBreakpoint.logMessage = bp.logMessage;
      }
      return sourceBreakpoint;
    }),
  };
}

/** Build DAP SetFunctionBreakpointsArguments from the store. */
function buildSetFunctionBreakpointsArgs(
  breakpoints: readonly StoredFunctionBreakpoint[],
): DebugProtocol.SetFunctionBreakpointsArguments {
  return {
    breakpoints: breakpoints.map((bp) => {
      const fnBp: DebugProtocol.FunctionBreakpoint = { name: bp.name };
      if (bp.condition) {
        fnBp.condition = bp.condition;
      }
      if (bp.hitCondition) {
        fnBp.hitCondition = bp.hitCondition;
      }
      return fnBp;
    }),
  };
}

/** Determine the breakpoint type label from its properties. */
function getBreakpointType(bp: StoredLineBreakpoint | StoredFunctionBreakpoint): string {
  if ('name' in bp) {
    return 'function';
  }
  if (bp.logMessage) {
    return 'logpoint';
  }
  if (bp.hitCondition) {
    return 'hitCount';
  }
  if (bp.condition) {
    return 'conditional';
  }
  return 'line';
}

/** Register the `breakpoint` command with set/remove/list subcommands. */
export function registerBreakpointCommand(program: Command): void {
  const bp = program.command('breakpoint').description('Manage breakpoints in a debug session');

  bp.command('set')
    .description('Set a breakpoint at a file:line location or function name')
    .argument('[location]', 'Breakpoint location (file:line)')
    .option('-s, --session <id>', 'Target session ID')
    .option('--file <path>', 'Source file path')
    .option('--line <number>', 'Line number')
    .option('--condition <expr>', 'Conditional expression for the breakpoint')
    .option('--hit-condition <expr>', 'Hit count expression')
    .option('--log-message <msg>', 'Log message (logpoint)')
    .option('--function <name>', 'Function name for function breakpoint')
    .action(async (location: string | undefined, options: BreakpointSetOptions) => {
      try {
        // Build location from --file + --line if not specified as positional argument
        if (!location && options.file && options.line) {
          location = `${options.file}:${options.line}`;
        }

        // Resolve session: use --session if provided, otherwise find the latest persisted session
        let sessionId = options.session;

        if (!sessionId) {
          const persisted = resolvePersistedSession();
          if (persisted) {
            sessionId = persisted.sessionId;
          } else {
            const output = formatErrorOutput(
              'breakpoint set',
              ErrorCode.SessionNotFound,
              'No active session found. Run "agentic-debugger attach" first, or use --session to specify a session ID.',
              undefined,
              getResolutionHint(ErrorCode.SessionNotFound) ?? undefined,
            );
            writeOutput(output);
            process.exitCode = mapErrorToExitCode(ErrorCode.SessionNotFound);
            return;
          }
        }

        const state = getSessionState(sessionId!);

        if (options.function) {
          const fnBp: StoredFunctionBreakpoint = {
            name: options.function,
            condition: options.condition,
            hitCondition: options.hitCondition,
            verified: false,
            enabled: true,
          };

          const mutableFnBps = [...state.functionBreakpoints, fnBp];
          const updatedState: SessionBreakpointState = {
            lineBreakpoints: state.lineBreakpoints,
            functionBreakpoints: mutableFnBps,
          };
          breakpointStore.set(sessionId!, updatedState);
          saveSessionState(sessionId!, updatedState);

          const _dapArgs = buildSetFunctionBreakpointsArgs(mutableFnBps);

          // Send function breakpoints to DAP if session host is available
          try {
            await sendSessionCmd(sessionId, 'setFunctionBreakpoints', _dapArgs);
          } catch { /* best-effort */ }

          const output = formatOutput('breakpoint set', {
            type: 'function',
            functionName: options.function,
            condition: options.condition ?? null,
            hitCondition: options.hitCondition ?? null,
            verified: false,
          }, sessionId!);
          writeOutput(output);
          return;
        }

        if (!location) {
          const output = formatErrorOutput(
            'breakpoint set',
            ErrorCode.BreakpointInvalid,
            'No location provided. Specify file:line, use --file and --line, or use --function <name>.',
            sessionId,
          );
          writeOutput(output);
          process.exitCode = mapErrorToExitCode(ErrorCode.BreakpointInvalid);
          return;
        }

        const parsed = parseFileLineLocation(location);
        if (!parsed) {
          const output = formatErrorOutput(
            'breakpoint set',
            ErrorCode.BreakpointInvalid,
            `Invalid breakpoint location: "${location}". Expected format: file:line or use --file and --line`,
            sessionId,
          );
          writeOutput(output);
          process.exitCode = mapErrorToExitCode(ErrorCode.BreakpointInvalid);
          return;
        }

        const lineBp: StoredLineBreakpoint = {
          file: parsed.file,
          line: parsed.line,
          condition: options.condition,
          hitCondition: options.hitCondition,
          logMessage: options.logMessage,
          verified: false,
          enabled: true,
        };

        const existingForFile = state.lineBreakpoints.get(parsed.file) ?? [];
        const updatedForFile = [...existingForFile, lineBp];
        state.lineBreakpoints.set(parsed.file, updatedForFile);

        const dapArgs = buildSetBreakpointsArgs(parsed.file, updatedForFile);

        // Send DAP setBreakpoints via session host
        let verified = false;
        let actualLine = parsed.line;
        try {
          const { response } = await sendSessionCmd(sessionId!, 'setBreakpoints', dapArgs);
          if (response.success) {
            const body = response.body as { breakpoints?: DebugProtocol.Breakpoint[] };
            const bps = body?.breakpoints ?? [];
            if (bps.length > 0) {
              const last = bps[bps.length - 1]!;
              verified = last.verified ?? false;
              actualLine = last.line ?? parsed.line;
            }
          }
        } catch {
          // Session host not available — report as unverified
        }

        // Update verified state and save to disk
        if (verified || actualLine !== parsed.line) {
          const idx = updatedForFile.length - 1;
          updatedForFile[idx] = { ...updatedForFile[idx]!, verified, line: actualLine };
          state.lineBreakpoints.set(parsed.file, updatedForFile);
        }
        saveSessionState(sessionId!, state);

        const output = formatOutput('breakpoint set', {
          type: getBreakpointType(lineBp),
          file: parsed.file,
          line: actualLine,
          condition: options.condition ?? null,
          hitCondition: options.hitCondition ?? null,
          logMessage: options.logMessage ?? null,
          verified,
        }, sessionId!);
        writeOutput(output);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const output = formatErrorOutput(
          'breakpoint set',
          ErrorCode.BreakpointInvalid,
          message,
          options.session,
        );
        writeOutput(output);
        process.exitCode = mapErrorToExitCode(ErrorCode.BreakpointInvalid);
      }
    });

  bp.command('remove')
    .description('Remove a breakpoint by location')
    .argument('[target]', 'Breakpoint location (file:line)')
    .option('-s, --session <id>', 'Target session ID')
    .option('--all', 'Remove all breakpoints')
    .action(async (target: string | undefined, options: BreakpointRemoveOptions) => {
      try {
        let sessionId = options.session;
        if (!sessionId) {
          const persisted = resolvePersistedSession();
          if (persisted) {
            sessionId = persisted.sessionId;
          } else {
            const output = formatErrorOutput(
              'breakpoint remove',
              ErrorCode.SessionNotFound,
              'No active session found. Run "agentic-debugger attach" first, or use --session to specify a session ID.',
              undefined,
              getResolutionHint(ErrorCode.SessionNotFound) ?? undefined,
            );
            writeOutput(output);
            process.exitCode = mapErrorToExitCode(ErrorCode.SessionNotFound);
            return;
          }
        }

        const state = getSessionState(sessionId);

        if (options.all) {
          const filesToClear = Array.from(state.lineBreakpoints.keys());

          state.lineBreakpoints.clear();
          const updatedState: SessionBreakpointState = {
            lineBreakpoints: state.lineBreakpoints,
            functionBreakpoints: [],
          };
          breakpointStore.set(sessionId, updatedState);

          const _dapLineArgs = filesToClear.map((file) =>
            buildSetBreakpointsArgs(file, []),
          );
          const _dapFnArgs = buildSetFunctionBreakpointsArgs([]);

          // Send clear to DAP
          for (const dapArgs of _dapLineArgs) {
            try { await sendSessionCmd(sessionId, 'setBreakpoints', dapArgs); } catch { /* best-effort */ }
          }
          try { await sendSessionCmd(sessionId, 'setFunctionBreakpoints', _dapFnArgs); } catch { /* best-effort */ }

          const output = formatOutput('breakpoint remove', {
            removedAll: true,
            filesCleared: filesToClear.length,
          }, sessionId);
          writeOutput(output);
          return;
        }

        if (!target) {
          const output = formatErrorOutput(
            'breakpoint remove',
            ErrorCode.BreakpointInvalid,
            'No target provided. Specify file:line or use --all.',
            options.session,
          );
          writeOutput(output);
          process.exitCode = mapErrorToExitCode(ErrorCode.BreakpointInvalid);
          return;
        }

        const parsed = parseFileLineLocation(target);
        if (!parsed) {
          const output = formatErrorOutput(
            'breakpoint remove',
            ErrorCode.BreakpointInvalid,
            `Invalid breakpoint location: "${target}". Expected format: file:line`,
            options.session,
          );
          writeOutput(output);
          process.exitCode = mapErrorToExitCode(ErrorCode.BreakpointInvalid);
          return;
        }

        const existingForFile = state.lineBreakpoints.get(parsed.file) ?? [];
        const filtered = existingForFile.filter(
          (bp) => bp.line !== parsed.line,
        );

        if (filtered.length === existingForFile.length) {
          const output = formatErrorOutput(
            'breakpoint remove',
            ErrorCode.BreakpointNotFound,
            `No breakpoint found at ${parsed.file}:${parsed.line}`,
            options.session,
          );
          writeOutput(output);
          process.exitCode = mapErrorToExitCode(ErrorCode.BreakpointNotFound);
          return;
        }

        if (filtered.length === 0) {
          state.lineBreakpoints.delete(parsed.file);
        } else {
          state.lineBreakpoints.set(parsed.file, filtered);
        }

        const dapArgs = buildSetBreakpointsArgs(parsed.file, filtered);

        // Send updated breakpoints to DAP
        try { await sendSessionCmd(sessionId, 'setBreakpoints', dapArgs); } catch { /* best-effort */ }

        const output = formatOutput('breakpoint remove', {
          file: parsed.file,
          line: parsed.line,
          remainingInFile: filtered.length,
        }, sessionId);
        writeOutput(output);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const output = formatErrorOutput(
          'breakpoint remove',
          ErrorCode.BreakpointInvalid,
          message,
          options.session,
        );
        writeOutput(output);
        process.exitCode = mapErrorToExitCode(ErrorCode.BreakpointInvalid);
      }
    });

  bp.command('list')
    .description('List all breakpoints in the session')
    .option('-s, --session <id>', 'Target session ID')
    .action(async (options: BreakpointListOptions) => {
      try {
        let sessionId = options.session;
        if (!sessionId) {
          const persisted = resolvePersistedSession();
          if (persisted) {
            sessionId = persisted.sessionId;
          } else {
            const output = formatErrorOutput(
              'breakpoint list',
              ErrorCode.SessionNotFound,
              'No active session found. Run "agentic-debugger attach" first, or use --session to specify a session ID.',
              undefined,
              getResolutionHint(ErrorCode.SessionNotFound) ?? undefined,
            );
            writeOutput(output);
            process.exitCode = mapErrorToExitCode(ErrorCode.SessionNotFound);
            return;
          }
        }

        const state = getSessionState(sessionId);

        const lineBreakpointEntries: Array<{
          type: string;
          file: string;
          line: number;
          condition: string | null;
          hitCondition: string | null;
          logMessage: string | null;
          verified: boolean;
        }> = [];

        for (const [file, breakpoints] of state.lineBreakpoints) {
          for (const bp of breakpoints) {
            lineBreakpointEntries.push({
              type: getBreakpointType(bp),
              file,
              line: bp.line,
              condition: bp.condition ?? null,
              hitCondition: bp.hitCondition ?? null,
              logMessage: bp.logMessage ?? null,
              verified: bp.verified,
            });
          }
        }

        const functionBreakpointEntries = state.functionBreakpoints.map((bp) => ({
          type: 'function' as const,
          functionName: bp.name,
          condition: bp.condition ?? null,
          hitCondition: bp.hitCondition ?? null,
          verified: bp.verified,
        }));

        const output = formatOutput('breakpoint list', {
          breakpoints: lineBreakpointEntries,
          functionBreakpoints: functionBreakpointEntries,
          totalCount: lineBreakpointEntries.length + functionBreakpointEntries.length,
        }, sessionId);
        writeOutput(output);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const output = formatErrorOutput(
          'breakpoint list',
          ErrorCode.InvalidState,
          message,
          options.session,
        );
        writeOutput(output);
        process.exitCode = mapErrorToExitCode(ErrorCode.InvalidState);
      }
    });

  bp.command('enable')
    .description('Enable a breakpoint at a file:line location')
    .argument('<location>', 'Breakpoint location (file:line)')
    .option('-s, --session <id>', 'Target session ID')
    .action(async (location: string, options: BreakpointToggleOptions) => {
      await toggleBreakpoint('enable', location, options);
    });

  bp.command('disable')
    .description('Disable a breakpoint at a file:line location without removing it')
    .argument('<location>', 'Breakpoint location (file:line)')
    .option('-s, --session <id>', 'Target session ID')
    .action(async (location: string, options: BreakpointToggleOptions) => {
      await toggleBreakpoint('disable', location, options);
    });
}

async function toggleBreakpoint(
  action: 'enable' | 'disable',
  location: string,
  options: BreakpointToggleOptions,
): Promise<void> {
  try {
    let sessionId = options.session;
    if (!sessionId) {
      const persisted = resolvePersistedSession();
      if (persisted) {
        sessionId = persisted.sessionId;
      } else {
        const output = formatErrorOutput(
          `breakpoint ${action}`,
          ErrorCode.SessionNotFound,
          'No active session found. Run "agentic-debugger attach" first, or use --session to specify a session ID.',
          undefined,
          getResolutionHint(ErrorCode.SessionNotFound) ?? undefined,
        );
        writeOutput(output);
        process.exitCode = mapErrorToExitCode(ErrorCode.SessionNotFound);
        return;
      }
    }

    const state = getSessionState(sessionId);
    const parsed = parseFileLineLocation(location);
    if (!parsed) {
      const output = formatErrorOutput(
        `breakpoint ${action}`,
        ErrorCode.BreakpointInvalid,
        `Invalid breakpoint location: "${location}". Expected format: file:line`,
        options.session,
      );
      writeOutput(output);
      process.exitCode = mapErrorToExitCode(ErrorCode.BreakpointInvalid);
      return;
    }

    const existingForFile = state.lineBreakpoints.get(parsed.file) ?? [];
    const targetIndex = existingForFile.findIndex((bp) => bp.line === parsed.line);

    if (targetIndex === -1) {
      const output = formatErrorOutput(
        `breakpoint ${action}`,
        ErrorCode.BreakpointNotFound,
        `No breakpoint found at ${parsed.file}:${parsed.line}`,
        options.session,
      );
      writeOutput(output);
      process.exitCode = mapErrorToExitCode(ErrorCode.BreakpointNotFound);
      return;
    }

    const enabled = action === 'enable';
    const updatedBreakpoints = existingForFile.map((bp, i) =>
      i === targetIndex ? { ...bp, enabled } : bp,
    );
    state.lineBreakpoints.set(parsed.file, updatedBreakpoints);

    const _dapArgs = buildSetBreakpointsArgs(parsed.file, updatedBreakpoints);

    // Send updated breakpoints to DAP
    try { await sendSessionCmd(sessionId, 'setBreakpoints', _dapArgs); } catch { /* best-effort */ }

    const output = formatOutput(`breakpoint ${action}`, {
      file: parsed.file,
      line: parsed.line,
      enabled,
    }, sessionId);
    writeOutput(output);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const output = formatErrorOutput(
      `breakpoint ${action}`,
      ErrorCode.BreakpointInvalid,
      message,
      options.session,
    );
    writeOutput(output);
    process.exitCode = mapErrorToExitCode(ErrorCode.BreakpointInvalid);
  }
}

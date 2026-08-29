import { createInterface, type Interface as ReadlineInterface } from 'node:readline';

import type { Command } from 'commander';

import { formatOutput, formatErrorOutput, writeOutput, type WriteOutputOptions } from '../output.js';
import { ErrorCode } from '../../schemas/errors.js';
import { mapErrorToExitCode, getResolutionHint } from '../errors.js';

/** Options parsed from the repl command CLI flags. */
interface ReplOptions {
  readonly session?: string;
}

/** Parsed input line with command name and argument tokens. */
interface ParsedInput {
  readonly command: string;
  readonly args: readonly string[];
}

/** Parse a raw input line into a command name and argument tokens. */
function parseInputLine(line: string): ParsedInput | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const tokens = trimmed.split(/\s+/);
  const first = tokens[0];
  if (first === undefined) {
    return null;
  }

  return { command: first, args: tokens.slice(1) };
}

/** Dispatch a parsed command through a Commander program instance. */
async function dispatchCommand(
  createProgram: () => Command,
  commandName: string,
  args: readonly string[],
  globalArgs: readonly string[],
  writeOptions: WriteOutputOptions,
): Promise<void> {
  const argv = ['node', 'agentic-debugger', ...globalArgs, commandName, ...args];

  const program = createProgram();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });

  try {
    await program.parseAsync(argv);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'commander.helpDisplayed') {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const output = formatErrorOutput('repl', ErrorCode.InvalidState, message);
    writeOutput(output, writeOptions);
  }
}

/** Run the interactive REPL loop. */
async function runReplLoop(
  createProgram: () => Command,
  globalArgs: readonly string[],
  writeOptions: WriteOutputOptions,
): Promise<void> {
  const rl: ReadlineInterface = createInterface({
    input: process.stdin,
    output: process.stderr,
    prompt: 'dbg> ',
    terminal: process.stdin.isTTY === true,
  });

  rl.prompt();

  return new Promise<void>((resolve) => {
    rl.on('line', (line: string) => {
      const parsed = parseInputLine(line);

      if (parsed === null) {
        rl.prompt();
        return;
      }

      if (parsed.command === 'exit' || parsed.command === 'quit') {
        rl.close();
        return;
      }

      if (parsed.command === 'help') {
        const output = formatOutput('repl', {
          message: 'Available commands: launch, attach, disconnect, terminate, breakpoint, exception-breakpoints, continue, step, pause, evaluate, variables, callstack, threads, watch, set-next-statement, exit, quit, help',
        });
        writeOutput(output, writeOptions);
        rl.prompt();
        return;
      }

      void dispatchCommand(createProgram, parsed.command, parsed.args, globalArgs, writeOptions).then(
        () => {
          rl.prompt();
        },
      );
    });

    rl.on('close', () => {
      resolve();
    });
  });
}

/** Register the `repl` command for interactive debugging. */
export function registerReplCommand(program: Command): void {
  program
    .command('repl')
    .description('Start an interactive REPL for debugging commands')
    .option('-s, --session <id>', 'Target session ID')
    .action(async (options: ReplOptions) => {
      const parentOpts = program.opts<{ session?: string; verbose?: boolean; pretty?: boolean }>();
      const sessionId = options.session ?? parentOpts.session;
      const writeOptions: WriteOutputOptions = { pretty: parentOpts.pretty };

      const globalArgs: string[] = [];
      if (sessionId) {
        globalArgs.push('--session', sessionId);
      }
      if (parentOpts.verbose) {
        globalArgs.push('--verbose');
      }
      if (parentOpts.pretty) {
        globalArgs.push('--pretty');
      }

      const { createProgram } = await import('../index.js');

      const startOutput = formatOutput('repl', {
        message: 'Interactive REPL started. Type "help" for commands, "exit" to quit.',
        sessionId: sessionId ?? null,
      }, sessionId);
      writeOutput(startOutput, writeOptions);

      try {
        await runReplLoop(createProgram, globalArgs, writeOptions);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        const output = formatErrorOutput(
          'repl',
          ErrorCode.InvalidState,
          message,
          sessionId,
          getResolutionHint(ErrorCode.InvalidState) ?? undefined,
        );
        writeOutput(output, writeOptions);
        process.exitCode = mapErrorToExitCode(ErrorCode.InvalidState);
      }
    });
}

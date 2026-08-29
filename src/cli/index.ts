import { Command } from 'commander';

import { registerLaunchCommand } from './commands/launch.js';
import { registerAttachCommand } from './commands/attach.js';
import { registerDisconnectCommand } from './commands/disconnect.js';
import { registerTerminateCommand } from './commands/terminate.js';
import { registerBreakpointCommand } from './commands/breakpoint.js';
import { registerExceptionBreakpointsCommand } from './commands/exception-breakpoints.js';
import { registerContinueCommand } from './commands/continue.js';
import { registerStepCommand } from './commands/step.js';
import { registerPauseCommand } from './commands/pause.js';
import { registerEvaluateCommand } from './commands/evaluate.js';
import { registerVariablesCommand } from './commands/variables.js';
import { registerCallstackCommand } from './commands/callstack.js';
import { registerThreadsCommand } from './commands/threads.js';
import { registerModulesCommand } from './commands/modules.js';
import { registerWatchCommand } from './commands/watch.js';
import { registerSetNextStatementCommand } from './commands/set-next-statement.js';
import { registerReplCommand } from './commands/repl.js';

/** Create and configure the CLI program with all commands registered. */
export function createProgram(): Command {
  const program = new Command();

  program
    .name('agentic-debugger')
    .description('A CLI debugger tool with DAP support for TypeScript, Python, and C#')
    .version('1.0.0')
    .enablePositionalOptions()
    .passThroughOptions();

  registerLaunchCommand(program);
  registerAttachCommand(program);
  registerDisconnectCommand(program);
  registerTerminateCommand(program);
  registerBreakpointCommand(program);
  registerExceptionBreakpointsCommand(program);
  registerContinueCommand(program);
  registerStepCommand(program);
  registerPauseCommand(program);
  registerEvaluateCommand(program);
  registerVariablesCommand(program);
  registerCallstackCommand(program);
  registerThreadsCommand(program);
  registerModulesCommand(program);
  registerWatchCommand(program);
  registerSetNextStatementCommand(program);
  registerReplCommand(program);

  return program;
}

// Re-export CLI layer types and utilities
export type { CliOutput } from './output.js';
export { formatOutput, formatErrorOutput, writeOutput } from './output.js';
export { CLI_EXIT_CODES, mapErrorToExitCode, formatCliError } from './errors.js';
export type { CliExitCode } from './errors.js';

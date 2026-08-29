import { createProgram } from './cli/index.js';
import { startMcpServer, startMcpServerSSE } from './mcp/index.js';
import { formatCliError, CLI_EXIT_CODES } from './cli/errors.js';
import { ErrorCode } from './schemas/errors.js';

function registerServeCommand(program: import('commander').Command): void {
  program
    .command('serve')
    .description('Start the MCP server')
    .option('--transport <type>', 'Transport type: stdio or sse', 'stdio')
    .option('--port <number>', 'Port for SSE transport', '3000')
    .action(async (opts: { transport: string; port: string }) => {
      if (opts.transport === 'sse') {
        await startMcpServerSSE({ port: parseInt(opts.port, 10) });
      } else {
        await startMcpServer();
      }
    });
}

async function main(): Promise<void> {
  const program = createProgram();

  registerServeCommand(program);

  try {
    await program.parseAsync(process.argv);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(formatCliError(ErrorCode.InvalidState, message) + '\n');
    process.exitCode = CLI_EXIT_CODES.GENERAL_ERROR;
  }
}

void main();

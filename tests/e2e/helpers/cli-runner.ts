import { execFile, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** JSON envelope returned by all CLI commands. */
export interface CliJsonEnvelope {
  readonly success: boolean;
  readonly sessionId: string | null;
  readonly command: string;
  readonly timestamp: string;
  readonly data: unknown;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly resolution: string | null;
  } | null;
}

/** Result of a CLI invocation. */
export interface CliRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly json: CliJsonEnvelope | null;
}

/** Options for CLI invocation. */
export interface CliRunOptions {
  readonly env?: Record<string, string>;
  readonly cwd?: string;
  readonly timeout?: number;
}

/** Default timeout for CLI invocations (30 seconds). */
const DEFAULT_TIMEOUT = 30_000;

/** Path to the CLI entry point. */
const CLI_ENTRY = resolve(
  fileURLToPath(import.meta.url),
  '../../../../src/cli.ts',
);

/** Tracked child processes for cleanup. */
const trackedProcesses = new Set<ChildProcess>();

/** Try to parse a string as a JSON envelope. */
function parseJsonEnvelope(stdout: string): CliJsonEnvelope | null {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith('{')) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'success' in parsed &&
      'command' in parsed &&
      'timestamp' in parsed
    ) {
      return parsed as CliJsonEnvelope;
    }
    return null;
  } catch {
    return null;
  }
}

/** Validate that a parsed envelope has the expected structure. */
export function isValidEnvelope(envelope: CliJsonEnvelope): boolean {
  return (
    typeof envelope.success === 'boolean' &&
    typeof envelope.command === 'string' &&
    typeof envelope.timestamp === 'string' &&
    (envelope.sessionId === null || typeof envelope.sessionId === 'string') &&
    (envelope.error === null || typeof envelope.error === 'object')
  );
}

/**
 * Run the agentic-debugger CLI with the given arguments.
 *
 * Spawns `npx tsx src/cli.ts` with the provided args, captures stdout/stderr,
 * and parses the JSON envelope from stdout.
 */
export function runCli(
  args: readonly string[],
  options: CliRunOptions = {},
): Promise<CliRunResult> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;

  return new Promise((resolvePromise) => {
    const child = execFile(
      'npx',
      ['tsx', CLI_ENTRY, ...args],
      {
        env: { ...process.env, ...options.env },
        cwd: options.cwd,
        timeout,
        shell: true,
      },
      (error, stdout, stderr) => {
        trackedProcesses.delete(child);
        const stdoutStr = stdout.toString();
        const stderrStr = stderr.toString();
        const exitCode = child.exitCode ?? (error ? 1 : 0);
        const json = parseJsonEnvelope(stdoutStr);

        resolvePromise({
          exitCode,
          stdout: stdoutStr,
          stderr: stderrStr,
          json,
        });
      },
    );

    trackedProcesses.add(child);
  });
}

/** A command definition for use with runCliSequence. */
export interface SequenceCommand {
  readonly args: readonly string[];
  readonly sessionFromPrevious?: boolean;
}

/**
 * Run a sequence of CLI commands, optionally passing the session ID
 * from the first command to subsequent commands.
 *
 * Returns all results in order.
 */
export async function runCliSequence(
  commands: readonly SequenceCommand[],
  options: CliRunOptions = {},
): Promise<CliRunResult[]> {
  const results: CliRunResult[] = [];
  let sessionId: string | null = null;

  for (const cmd of commands) {
    let args = [...cmd.args];

    if (cmd.sessionFromPrevious && sessionId) {
      const hasSession = args.some(
        (a) => a === '--session' || a === '-s',
      );
      if (!hasSession) {
        args = [...args, '--session', sessionId];
      }
    }

    const result = await runCli(args, options);
    results.push(result);

    if (result.json?.sessionId && !sessionId) {
      sessionId = result.json.sessionId;
    }
  }

  return results;
}

/** Kill all tracked child processes. */
export function killTrackedProcesses(): void {
  for (const child of trackedProcesses) {
    try {
      child.kill('SIGKILL');
    } catch {
      // Process may already be gone
    }
  }
  trackedProcesses.clear();
}

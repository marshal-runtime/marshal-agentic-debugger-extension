import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

/**
 * Regression coverage for the CLI-side half of commit 21ff1e1.
 *
 * Before the fix, callstack/continue/pause/step hard-coded `threadId: 1` when
 * the user omitted `--thread-id`. That defeated the session-host's last-stopped
 * thread injection because the host only injects when `args.threadId` is
 * `undefined`. The CLI commands now must omit `threadId` from the request body
 * entirely when the flag is absent.
 *
 * If anyone re-introduces a fallback constant like `DEFAULT_THREAD_ID = 1`,
 * these tests fail and surface the regression before the bug reaches users.
 */

// Capture every `sendCommand` invocation. We don't care about the response
// (the action will continue to formatOutput which writes to stdout); the
// assertion is purely on the args dispatched.
const sendCommand = vi.fn(async () => ({
  sessionId: 'sess-test',
  response: { success: true, body: {} },
}));

vi.mock('../../../../src/cli/reconnect.js', () => ({
  sendCommand,
  resolvePersistedSession: vi.fn(() => ({
    sessionId: 'sess-test',
    transport: 'tcp',
    host: '127.0.0.1',
    port: 12345,
  })),
}));

// Suppress writeOutput stdout chatter
vi.mock('../../../../src/cli/output.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../src/cli/output.js')>(
    '../../../../src/cli/output.js',
  );
  return {
    ...actual,
    writeOutput: vi.fn(),
  };
});

// IMPORTANT: import the command registrations AFTER the mocks are set up.
const { registerCallstackCommand } = await import(
  '../../../../src/cli/commands/callstack.js'
);
const { registerContinueCommand } = await import(
  '../../../../src/cli/commands/continue.js'
);
const { registerPauseCommand } = await import(
  '../../../../src/cli/commands/pause.js'
);
const { registerStepCommand } = await import(
  '../../../../src/cli/commands/step.js'
);

beforeEach(() => {
  sendCommand.mockClear();
});

/** Spin up a Commander program with the given registrar applied. */
function buildProgram(registrar: (p: Command) => void): Command {
  const program = new Command();
  // Don't .exit() the test process when commander hits an error
  program.exitOverride();
  registrar(program);
  return program;
}

async function runArgs(program: Command, argv: string[]): Promise<void> {
  await program.parseAsync(['node', 'agentic-debugger', ...argv]);
}

describe('CLI thread-scoped commands omit threadId when --thread-id is absent', () => {
  it('callstack without --thread-id sends NO threadId in stackTrace args', async () => {
    const program = buildProgram(registerCallstackCommand);
    await runArgs(program, ['callstack']);

    expect(sendCommand).toHaveBeenCalledTimes(1);
    const [, dapCommand, args] = sendCommand.mock.calls[0]!;
    expect(dapCommand).toBe('stackTrace');
    expect((args as Record<string, unknown>)['threadId']).toBeUndefined();
    // Sanity: the host still receives the paging args.
    expect((args as Record<string, unknown>)['startFrame']).toBe(0);
    expect((args as Record<string, unknown>)['levels']).toBe(20);
  });

  it('callstack with --thread-id 42 sends threadId=42', async () => {
    const program = buildProgram(registerCallstackCommand);
    await runArgs(program, ['callstack', '--thread-id', '42']);

    expect(sendCommand).toHaveBeenCalledTimes(1);
    const [, , args] = sendCommand.mock.calls[0]!;
    expect((args as Record<string, unknown>)['threadId']).toBe(42);
  });

  it('continue without --thread-id sends empty args (no threadId)', async () => {
    const program = buildProgram(registerContinueCommand);
    await runArgs(program, ['continue']);

    expect(sendCommand).toHaveBeenCalledTimes(1);
    const [, dapCommand, args] = sendCommand.mock.calls[0]!;
    expect(dapCommand).toBe('continue');
    expect((args as Record<string, unknown>)['threadId']).toBeUndefined();
  });

  it('continue with --thread-id 7 sends threadId=7', async () => {
    const program = buildProgram(registerContinueCommand);
    await runArgs(program, ['continue', '--thread-id', '7']);

    const [, , args] = sendCommand.mock.calls[0]!;
    expect((args as Record<string, unknown>)['threadId']).toBe(7);
  });

  it('pause without --thread-id sends no threadId', async () => {
    const program = buildProgram(registerPauseCommand);
    await runArgs(program, ['pause']);

    expect(sendCommand).toHaveBeenCalledTimes(1);
    const [, dapCommand, args] = sendCommand.mock.calls[0]!;
    expect(dapCommand).toBe('pause');
    expect((args as Record<string, unknown>)['threadId']).toBeUndefined();
  });

  it('step over without --thread-id sends NO threadId to "next" DAP command', async () => {
    const program = buildProgram(registerStepCommand);
    await runArgs(program, ['step', 'over']);

    expect(sendCommand).toHaveBeenCalledTimes(1);
    const [, dapCommand, args] = sendCommand.mock.calls[0]!;
    expect(dapCommand).toBe('next');
    expect((args as Record<string, unknown>)['threadId']).toBeUndefined();
  });

  it('step into with --thread-id 100 sends threadId=100', async () => {
    const program = buildProgram(registerStepCommand);
    await runArgs(program, ['step', 'into', '--thread-id', '100']);

    expect(sendCommand).toHaveBeenCalledTimes(1);
    const [, dapCommand, args] = sendCommand.mock.calls[0]!;
    expect(dapCommand).toBe('stepIn');
    expect((args as Record<string, unknown>)['threadId']).toBe(100);
  });
});

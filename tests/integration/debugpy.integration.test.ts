import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { platform } from 'node:os';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DebugProtocol } from '@vscode/debugprotocol';

import { cleanupSession, waitForStop } from './helpers/adapter-helpers.js';
import type { TestSession } from './helpers/adapter-helpers.js';
import { DapClient } from '../../src/dap/client.js';
import { StdioTransport } from '../../src/dap/transport/stdio.js';
import { DebugSession } from '../../src/session/session.js';
import type { DapEvent } from '../../src/dap/types.js';
import { SessionState } from '../../src/types/session.js';
import { NativeDebuggerHostAdapter } from '../../src/runtime/native-host.js';
import { deriveDebuggerScope } from '../../src/runtime/scope.js';

const TEST_PROGRAM = resolve(__dirname, 'helpers/test-programs/python/basic.py');

/** Line number of `total: int = a + b` in basic.py calculate function. */
const BREAKPOINT_LINE = 9;

/** Resolve the Python interpreter binary name for this platform. */
function resolvePythonBinary(): string {
  const envPath = process.env['AGENTIC_PYTHON_PATH'];
  if (envPath) {
    return envPath;
  }
  return platform() === 'win32' ? 'python' : 'python3';
}

/** Check whether Python + debugpy are available on this system. */
function hasDebugpy(): boolean {
  const pythonBinary = resolvePythonBinary();
  try {
    execFileSync(pythonBinary, ['-m', 'debugpy', '--version'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/** Wait for a specific DAP event with a timeout. */
function waitForDapEvent(
  client: DapClient,
  eventType: string,
  timeoutMs: number,
): Promise<DapEvent> {
  return new Promise<DapEvent>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for DAP event '${eventType}' after ${timeoutMs}ms`));
    }, timeoutMs);

    client.onEvent(eventType, (event: DapEvent) => {
      clearTimeout(timer);
      resolve(event);
    });
  });
}

/**
 * Create a debugpy test session.
 *
 * Spawns `python -m debugpy.adapter` via stdio, initializes DAP,
 * and launches the Python program with stopOnEntry.
 */
async function createDebugpySession(program: string): Promise<TestSession> {
  const pythonBinary = resolvePythonBinary();
  const cwd = resolve(__dirname, 'helpers/test-programs/python');

  const transport = new StdioTransport({
    command: pythonBinary,
    args: ['-m', 'debugpy.adapter'],
    cwd,
  });

  await transport.connect();

  const client = new DapClient({
    transport,
    timeouts: { requestTimeoutMs: 10_000 },
  });

  const session = new DebugSession({
    config: {
      sessionId: `test-debugpy-${Date.now()}`,
      program,
      language: 'python',
    },
    client,
  });

  await session.initialize();

  const launchArgs: Record<string, unknown> = {
    type: 'python',
    request: 'launch',
    program,
    pythonPath: pythonBinary,
    cwd,
    stopOnEntry: true,
    console: 'internalConsole',
    justMyCode: true,
  };

  await session.launch(launchArgs);

  const stoppedEvent = await waitForDapEvent(client, 'stopped', 10_000);
  const body = stoppedEvent.body as { threadId?: number } | undefined;
  const threadId = body?.threadId ?? 1;

  return { transport, client, session, threadId };
}

const debugpyAvailable = hasDebugpy();

describe.skipIf(!debugpyAvailable)('debugpy integration', () => {
  let session: TestSession;

  beforeAll(async () => {
    session = await createDebugpySession(TEST_PROGRAM);
  }, 15_000);

  afterAll(async () => {
    if (session) {
      await cleanupSession(session);
    }
  }, 10_000);

  it('should launch a Python program and create a session', () => {
    expect(session).toBeDefined();
    expect(session.client).toBeDefined();
    expect(session.session).toBeDefined();
    expect(session.transport).toBeDefined();
    expect(session.threadId).toBeGreaterThan(0);
  });

  describe.skipIf(!debugpyAvailable)('NativeDebuggerHostAdapter debugpy integration', () => {
    it('launches debugpy through the runtime host and releases the completed session', async () => {
      const host = new NativeDebuggerHostAdapter({ maxSessions: 1 });
      const scope = deriveDebuggerScope({
        principal: { id: 'integration-test', kind: 'agent' },
        executionId: 'native-debugpy-launch',
        scope: { sessionId: 'marshal-session-1', chatId: 'chat-1' },
        metadata: { marshalWorkspaceName: 'workspace-1' },
      });

      try {
        const launched = await host.invoke({
          capability: 'debug.session.launch',
          input: {
            program: TEST_PROGRAM,
            language: 'python',
            stopOnEntry: true,
          },
          scope,
        });
        const output = launched as {
          sessionId: string;
          snapshot: { state: string };
        };
        expect(output.sessionId).toMatch(/^sess-/);
        expect(['paused', 'running']).toContain(output.snapshot.state);

        const disconnected = await host.invoke({
          capability: 'debug.session.disconnect',
          input: { sessionId: output.sessionId },
          scope,
        });
        expect(disconnected).toMatchObject({
          sessionId: output.sessionId,
          disconnected: true,
          snapshot: { state: 'completed' },
        });

        const relaunched = await host.invoke({
          capability: 'debug.session.launch',
          input: {
            program: TEST_PROGRAM,
            language: 'python',
            stopOnEntry: true,
          },
          scope,
        });
        expect(relaunched).toMatchObject({ sessionId: expect.stringMatching(/^sess-/) });
      } finally {
        await host.dispose();
      }
    }, 30_000);
  });

  it('should set a breakpoint and stop at it', async () => {
    const bpResponse = await session.client.setBreakpoints({
      source: { path: TEST_PROGRAM },
      breakpoints: [{ line: BREAKPOINT_LINE }],
    });

    const bpBody = bpResponse.body as DebugProtocol.SetBreakpointsResponse['body'];
    expect(bpBody.breakpoints).toHaveLength(1);
    expect(bpBody.breakpoints[0]!.verified).toBe(true);

    await session.client.continue({ threadId: session.threadId });

    const stopInfo = await waitForStop(session, 10_000);
    expect(stopInfo.reason).toBe('breakpoint');

    const stackResponse = await session.client.stackTrace({
      threadId: stopInfo.threadId,
      startFrame: 0,
      levels: 1,
    });

    const stackBody = stackResponse.body as DebugProtocol.StackTraceResponse['body'];
    expect(stackBody.stackFrames).toHaveLength(1);
    expect(stackBody.stackFrames[0]!.line).toBe(BREAKPOINT_LINE);
  }, 15_000);

  it('should get variables at breakpoint', async () => {
    const stackResponse = await session.client.stackTrace({
      threadId: session.threadId,
      startFrame: 0,
      levels: 1,
    });

    const stackBody = stackResponse.body as DebugProtocol.StackTraceResponse['body'];
    const frameId = stackBody.stackFrames[0]!.id;

    const scopesResponse = await session.client.scopes({ frameId });
    const scopesBody = scopesResponse.body as DebugProtocol.ScopesResponse['body'];
    expect(scopesBody.scopes.length).toBeGreaterThan(0);

    const localScope =
      scopesBody.scopes.find((s) => s.name === 'Locals' || s.name === 'Local') ??
      scopesBody.scopes[0]!;

    const varsResponse = await session.client.variables({
      variablesReference: localScope.variablesReference,
    });

    const varsBody = varsResponse.body as DebugProtocol.VariablesResponse['body'];
    expect(varsBody.variables.length).toBeGreaterThan(0);

    const varA = varsBody.variables.find((v) => v.name === 'a');
    const varB = varsBody.variables.find((v) => v.name === 'b');

    expect(varA).toBeDefined();
    expect(varB).toBeDefined();
    expect(varA!.value).toBe('10');
    expect(varB!.value).toBe('20');
  }, 10_000);

  it('should evaluate a Python expression', async () => {
    const stackResponse = await session.client.stackTrace({
      threadId: session.threadId,
      startFrame: 0,
      levels: 1,
    });

    const stackBody = stackResponse.body as DebugProtocol.StackTraceResponse['body'];
    const frameId = stackBody.stackFrames[0]!.id;

    const evalResponse = await session.client.evaluate({
      expression: 'a + b',
      frameId,
      context: 'repl',
    });

    const evalBody = evalResponse.body as DebugProtocol.EvaluateResponse['body'];
    expect(evalBody.result).toBe('30');
  }, 10_000);

  it('should disconnect cleanly', async () => {
    await session.session.disconnect();
    expect(session.session.state).toBe(SessionState.Terminated);
  }, 10_000);
});

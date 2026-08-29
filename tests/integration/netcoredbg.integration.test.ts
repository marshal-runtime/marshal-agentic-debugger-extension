import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DebugProtocol } from '@vscode/debugprotocol';

import {
  cleanupSession,
  waitForStop,
  hasBinary,
} from './helpers/adapter-helpers.js';
import type { TestSession } from './helpers/adapter-helpers.js';
import { DapClient } from '../../src/dap/client.js';
import { StdioTransport } from '../../src/dap/transport/stdio.js';
import { DebugSession } from '../../src/session/session.js';
import type { DapEvent } from '../../src/dap/types.js';

const CSHARP_PROJECT_DIR = resolve(__dirname, 'helpers/test-programs/csharp');
const CSHARP_PROJECT_FILE = join(CSHARP_PROJECT_DIR, 'test-app.csproj');

/** Line number of `int total = a + b;` in Program.cs Calculate method. */
const BREAKPOINT_LINE = 11;

/** Path to the built DLL (populated after dotnet build). */
let builtDllPath = '';

/** Check whether dotnet CLI is available on this system. */
function hasDotnet(): boolean {
  try {
    execFileSync('dotnet', ['--version'], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/** Check whether both netcoredbg and dotnet are available. */
function hasNetcoredbg(): boolean {
  return process.env['AGENTIC_RUN_NETCOREDBG_INTEGRATION'] === '1'
    && hasBinary('netcoredbg')
    && hasDotnet();
}

/** Build the C# test project and return the path to the output DLL. */
function buildCsharpProject(): string {
  const outputDir = join(CSHARP_PROJECT_DIR, 'bin', 'Debug', 'net8.0');

  execFileSync('dotnet', ['build', CSHARP_PROJECT_FILE, '-c', 'Debug'], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: CSHARP_PROJECT_DIR,
  });

  const dllPath = join(outputDir, 'test-app.dll');
  if (!existsSync(dllPath)) {
    throw new Error(`Built DLL not found at ${dllPath}`);
  }

  return dllPath;
}

/** Wait for a specific DAP event with a timeout. */
function waitForDapEvent(
  client: DapClient,
  eventType: string,
  timeoutMs: number,
): Promise<DapEvent> {
  return new Promise<DapEvent>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for DAP event '${eventType}' after ${timeoutMs}ms`));
    }, timeoutMs);

    client.onEvent(eventType, (event: DapEvent) => {
      clearTimeout(timer);
      resolvePromise(event);
    });
  });
}

/**
 * Create a netcoredbg test session.
 *
 * Spawns `netcoredbg --interpreter=vscode` via stdio, initializes DAP,
 * and launches the .NET program with stopOnEntry.
 */
async function createNetcoredbgSession(program: string): Promise<TestSession> {
  const transport = new StdioTransport({
    command: 'netcoredbg',
    args: ['--interpreter=vscode'],
    cwd: CSHARP_PROJECT_DIR,
  });

  await transport.connect();

  const client = new DapClient({
    transport,
    timeouts: { requestTimeoutMs: 10_000 },
  });

  const session = new DebugSession({
    config: {
      sessionId: `test-netcoredbg-${Date.now()}`,
      program,
      language: 'csharp',
    },
    client,
  });

  await session.initialize();

  const launchArgs: Record<string, unknown> = {
    type: 'coreclr',
    request: 'launch',
    program,
    cwd: CSHARP_PROJECT_DIR,
    stopAtEntry: true,
    console: 'internalConsole',
  };

  await session.launch(launchArgs);

  const stoppedEvent = await waitForDapEvent(client, 'stopped', 10_000);
  const body = stoppedEvent.body as { threadId?: number } | undefined;
  const threadId = body?.threadId ?? 1;

  return { transport, client, session, threadId };
}

const netcoredbgAvailable = hasNetcoredbg();

describe.skipIf(!netcoredbgAvailable)('netcoredbg integration', () => {
  let session: TestSession;

  beforeAll(async () => {
    builtDllPath = buildCsharpProject();
    session = await createNetcoredbgSession(builtDllPath);
  }, 30_000);

  afterAll(async () => {
    if (session) {
      await cleanupSession(session);
    }
  }, 10_000);

  it('should launch a .NET program and create a session', () => {
    expect(session).toBeDefined();
    expect(session.client).toBeDefined();
    expect(session.session).toBeDefined();
    expect(session.transport).toBeDefined();
    expect(session.threadId).toBeGreaterThan(0);
  });

  it('should set a breakpoint and stop at it', async () => {
    const programPath = resolve(CSHARP_PROJECT_DIR, 'Program.cs');

    const bpResponse = await session.client.setBreakpoints({
      source: { path: programPath },
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
    expect(stackBody.stackFrames.length).toBeGreaterThan(0);
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

    const localScope = scopesBody.scopes.find(
      (s) => s.name === 'Locals' || s.name === 'Local',
    ) ?? scopesBody.scopes[0]!;

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

  it('should evaluate a C# expression', async () => {
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
    const disconnectResponse = await session.client.disconnect({
      terminateDebuggee: true,
    });

    expect(disconnectResponse.success).toBe(true);
  }, 10_000);
});

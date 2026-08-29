import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DebugProtocol } from '@vscode/debugprotocol';

import { hasBinary } from './helpers/adapter-helpers.js';
import { NetcoredbgAdapter } from '../../src/adapters/netcoredbg/index.js';
import type { DapEvent } from '../../src/dap/types.js';

/**
 * End-to-end regression test for commit 2efa1c9.
 *
 * Exercises the production `NetcoredbgAdapter.attach()` against a real .NET 8
 * process attached by PID. Two regressions are caught here:
 *
 * 1. `getAttachArgs()` previously produced `--type=coreclr --request=attach
 *    --processId=N` which Samsung netcoredbg rejects ("Unknown option …") and
 *    the adapter exits at startup → attach throws.
 * 2. `NetcoredbgAdapter.attach()` previously did NOT drive
 *    initialize+attach+configurationDone — it just spawned the process and
 *    created a client. The CLI treated csharp as adapterHandledInit, so DAP
 *    requests fired without a handshake and the session hung.
 */

const CSHARP_PROJECT_DIR = resolve(__dirname, 'helpers/test-programs/csharp');
const CSHARP_PROGRAM_PATH = join(CSHARP_PROJECT_DIR, 'Program.cs');

/** Line of `int total = a + b;` inside Calculate(). */
const BREAKPOINT_LINE = 11;

function hasDotnet(): boolean {
  try {
    execFileSync('dotnet', ['--version'], { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

function buildCsharpProject(): string {
  execFileSync(
    'dotnet',
    ['build', join(CSHARP_PROJECT_DIR, 'test-app.csproj'), '-c', 'Debug'],
    { stdio: ['pipe', 'pipe', 'pipe'], cwd: CSHARP_PROJECT_DIR },
  );
  const exe = join(CSHARP_PROJECT_DIR, 'bin', 'Debug', 'net8.0', 'test-app.exe');
  if (!existsSync(exe)) {
    throw new Error(`Built test-app.exe not found at ${exe}`);
  }
  return exe;
}

function waitForEvent(
  emitter: { onEvent: (name: string, h: (e: DapEvent) => void) => void },
  name: string,
  timeoutMs: number,
): Promise<DapEvent> {
  return new Promise((resolvePromise, reject) => {
    const t = setTimeout(
      () => reject(new Error(`timeout waiting for DAP event '${name}' (${timeoutMs}ms)`)),
      timeoutMs,
    );
    emitter.onEvent(name, (e: DapEvent) => {
      clearTimeout(t);
      resolvePromise(e);
    });
  });
}

const ready = process.env['AGENTIC_RUN_NETCOREDBG_INTEGRATION'] === '1'
  && hasBinary('netcoredbg')
  && hasDotnet();

describe.skipIf(!ready)('NetcoredbgAdapter PID attach end-to-end', () => {
  let target: ChildProcess | undefined;
  let adapter: NetcoredbgAdapter;

  beforeAll(async () => {
    const exe = buildCsharpProject();
    target = spawn(exe, [], { stdio: 'ignore', windowsHide: true });
    // The test-app's Main() prints pid + sleeps in a loop, so a 2s warm-up
    // is plenty for the runtime to be in steady state before attach.
    await new Promise((r) => setTimeout(r, 2_000));

    adapter = new NetcoredbgAdapter();
    await adapter.attach(
      { sessionId: 'integ-test', language: 'csharp', runtime: 'dotnet', args: [] },
      { processId: target.pid! },
    );
  }, 60_000);

  afterAll(async () => {
    try { await adapter?.dispose(); } catch { /* best-effort */ }
    if (target && !target.killed) target.kill('SIGKILL');
  }, 10_000);

  it('attach returned a wired DapClient', () => {
    expect(adapter.getClient()).toBeDefined();
  });

  it('setBreakpoints at Calculate() returns verified=true', async () => {
    const client = adapter.getClient()!;
    const resp = await client.setBreakpoints({
      source: { path: CSHARP_PROGRAM_PATH },
      breakpoints: [{ line: BREAKPOINT_LINE }],
    });
    const body = resp.body as DebugProtocol.SetBreakpointsResponse['body'];
    expect(body.breakpoints).toHaveLength(1);
    expect(body.breakpoints[0]!.verified).toBe(true);
  });

  it('hits the breakpoint and returns a real call stack at line 11', async () => {
    const client = adapter.getClient()!;
    // Wait for stopped event from the loop hitting Calculate(10,20).
    const stopped = await waitForEvent(client, 'stopped', 30_000);
    const stopBody = stopped.body as { threadId: number; reason: string };
    expect(stopBody.reason).toBe('breakpoint');
    expect(typeof stopBody.threadId).toBe('number');

    const stack = await client.stackTrace({
      threadId: stopBody.threadId,
      startFrame: 0,
      levels: 5,
    });
    const stackBody = stack.body as DebugProtocol.StackTraceResponse['body'];
    expect(stackBody.stackFrames.length).toBeGreaterThan(0);
    expect(stackBody.stackFrames[0]!.line).toBe(BREAKPOINT_LINE);
    expect(stackBody.stackFrames[0]!.name).toContain('Calculate');

    // Sanity on locals — proves the runtime context is real, not a stub.
    const scopes = await client.scopes({ frameId: stackBody.stackFrames[0]!.id });
    const scopeBody = scopes.body as DebugProtocol.ScopesResponse['body'];
    const locals = scopeBody.scopes.find((s) => s.name === 'Locals') ?? scopeBody.scopes[0]!;
    const vars = await client.variables({ variablesReference: locals.variablesReference });
    const varBody = vars.body as DebugProtocol.VariablesResponse['body'];
    const a = varBody.variables.find((v) => v.name === 'a');
    const b = varBody.variables.find((v) => v.name === 'b');
    expect(a?.value).toBe('10');
    expect(b?.value).toBe('20');
  }, 45_000);
});

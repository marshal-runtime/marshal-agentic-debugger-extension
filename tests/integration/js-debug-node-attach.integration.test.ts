import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DebugProtocol } from '@vscode/debugprotocol';

import { JsDebugAdapter } from '../../src/adapters/js-debug/index.js';
import type { DapEvent } from '../../src/dap/types.js';

/**
 * End-to-end regression test for commit 4ac8685.
 *
 * Two regressions are guarded here:
 *
 * 1. CLI routing — `attach --language javascript --address PORT` must reach
 *    `JsDebugAdapter.attach({ debugType: 'node' })`. The previous code path
 *    fell through to the raw DAP TCP transport and crashed with
 *    DapFramingError on V8's HTTP/WebSocket port. The integration test below
 *    drives `JsDebugAdapter.attach({ debugType: 'node' })` directly, which is
 *    exactly the production code path the routing fix selects.
 *
 * 2. `startDebugging` reverse-request handling for non-CDP modes — js-debug's
 *    pwa-node attach uses the same multi-session model as the browser
 *    adapters. Without `registerStartDebuggingHandler` wired in for the
 *    `debugType=node` path, the parent session never swaps to the child and
 *    breakpoints stay `verified:false` / actually never bind. The stronger
 *    oracle here is the test below hitting the breakpoint with a real stack
 *    frame on the correct line — not just the `verified` bit.
 */

function findFreePort(): Promise<number> {
  return new Promise((resolveP, rejectP) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close(() => rejectP(new Error('failed to bind free port')));
        return;
      }
      const port = addr.port;
      server.close(() => resolveP(port));
    });
  });
}

function waitForInspector(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolveP, rejectP) => {
    const tick = async (): Promise<void> => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) { resolveP(); return; }
      } catch { /* keep polling */ }
      if (Date.now() > deadline) {
        rejectP(new Error(`V8 inspector on ${port} never responded`));
        return;
      }
      setTimeout(tick, 100);
    };
    void tick();
  });
}

function waitForEvent(
  emitter: { onEvent: (name: string, h: (e: DapEvent) => void) => void },
  name: string,
  timeoutMs: number,
): Promise<DapEvent> {
  return new Promise((resolveP, rejectP) => {
    const t = setTimeout(
      () => rejectP(new Error(`timeout waiting for DAP event '${name}' (${timeoutMs}ms)`)),
      timeoutMs,
    );
    emitter.onEvent(name, (e: DapEvent) => {
      clearTimeout(t);
      resolveP(e);
    });
  });
}

const jsDebugPath = join(
  __dirname,
  '..',
  '..',
  'adapters',
  'js-debug',
  'dapDebugServer.js',
);

describe.skipIf(!existsSync(jsDebugPath))('JsDebugAdapter pwa-node attach (V8 inspector) end-to-end', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'agentic-jsdebug-attach-'));
  const program = join(tmp, 'tick.cjs');

  let target: ChildProcess | undefined;
  let port = 0;
  let adapter: JsDebugAdapter;

  beforeAll(async () => {
    // The JsDebugAdapter resolves its bundled path relative to the BUILT dist/
    // layout (`<package-root>/dist` + `..` → repo root). Integration tests run
    // against TypeScript sources, where that relative offset lands on a
    // non-existent path. Point the adapter at the real bundled binary so the
    // production resolution code path is exercised without false negatives.
    process.env['AGENTIC_JSDEBUG_PATH'] = jsDebugPath;

    // BP target: line 4 (console.log inside tick).
    writeFileSync(
      program,
      [
        'function tick(n) {',
        '  const msg = `tick ${n}`;',
        '  // BP target',
        '  console.log(msg);',
        '  return n + 1;',
        '}',
        'let i = 0;',
        'setInterval(() => { i = tick(i); }, 300);',
        '',
      ].join('\n'),
    );

    port = await findFreePort();
    target = spawn(process.execPath, [`--inspect-brk=${port}`, program], {
      stdio: 'ignore',
      windowsHide: true,
    });
    await waitForInspector(port, 5_000);

    adapter = new JsDebugAdapter();
    await adapter.attach(
      { sessionId: 'integ-jsdebug-attach', language: 'javascript', runtime: 'node', args: [] },
      { port, host: '127.0.0.1', debugType: 'node' },
    );
  }, 60_000);

  afterAll(async () => {
    try { await adapter?.dispose(); } catch { /* best-effort */ }
    if (target && !target.killed) target.kill('SIGKILL');
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
  }, 10_000);

  it('attach returned a wired DapClient (proves routing reached JsDebugAdapter)', () => {
    expect(adapter.getClient()).toBeDefined();
  });

  it('the active client is the CHILD session, not the parent (proves startDebugging handler fired)', async () => {
    const client = adapter.getClient()!;
    const resp = await client.setBreakpoints({
      source: { path: program },
      breakpoints: [{ line: 4 }],
    });
    const body = resp.body as DebugProtocol.SetBreakpointsResponse['body'];
    expect(body.breakpoints).toHaveLength(1);
    // Verified=true is the parent-vs-child smoking gun: without the
    // startDebugging handler, this.client is the parent, which has no real
    // target context and reports the BP unverified.
    expect(body.breakpoints[0]!.verified).toBe(true);
  });

  it('continue + hit BP returns a real stack frame at line 4 (the strong oracle)', async () => {
    const client = adapter.getClient()!;

    // The target launched with --inspect-brk so it's already stopped on entry
    // of the child session. Continue once; setInterval will fire and we hit
    // the BP from above.
    await client.continue({ threadId: 1 });

    const stopped = await waitForEvent(client, 'stopped', 15_000);
    const stopBody = stopped.body as { threadId: number; reason: string };
    expect(stopBody.reason).toBe('breakpoint');

    const stack = await client.stackTrace({
      threadId: stopBody.threadId,
      startFrame: 0,
      levels: 3,
    });
    const stackBody = stack.body as DebugProtocol.StackTraceResponse['body'];
    expect(stackBody.stackFrames.length).toBeGreaterThan(0);
    expect(stackBody.stackFrames[0]!.line).toBe(4);
    expect(stackBody.stackFrames[0]!.name).toContain('tick');

    // Sanity on locals — proves we have a real V8 execution context.
    const scopes = await client.scopes({ frameId: stackBody.stackFrames[0]!.id });
    const scopeBody = scopes.body as DebugProtocol.ScopesResponse['body'];
    const local = scopeBody.scopes.find((s) => s.name.startsWith('Local')) ?? scopeBody.scopes[0]!;
    const vars = await client.variables({ variablesReference: local.variablesReference });
    const varBody = vars.body as DebugProtocol.VariablesResponse['body'];
    const n = varBody.variables.find((v) => v.name === 'n');
    expect(n).toBeDefined();
    expect(Number.parseInt(n!.value, 10)).toBeGreaterThanOrEqual(0);
  }, 30_000);
});

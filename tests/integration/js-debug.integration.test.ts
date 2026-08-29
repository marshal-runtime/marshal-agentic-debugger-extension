import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DebugProtocol } from '@vscode/debugprotocol';

import {
  createTestSession,
  cleanupSession,
  waitForStop,
  hasBinary,
} from './helpers/adapter-helpers.js';
import type { TestSession } from './helpers/adapter-helpers.js';
import type { DapResponse, DapEvent } from '../../src/dap/types.js';

const TEST_PROGRAM = resolve(__dirname, 'helpers/test-programs/js/basic.js');

/** Line number of `const sum = a + b;` in basic.js calculate function. */
const BREAKPOINT_LINE = 5;

const jsDebugAvailable = hasBinary('js-debug');

describe.skipIf(!jsDebugAvailable)('js-debug integration', () => {
  let session: TestSession;

  beforeAll(async () => {
    session = await createTestSession('js-debug', TEST_PROGRAM, {
      stopOnEntry: true,
      cwd: resolve(__dirname, 'helpers/test-programs/js'),
    });
  }, 15_000);

  afterAll(async () => {
    if (session) {
      await cleanupSession(session);
    }
  }, 10_000);

  it('should launch a JS program and create a session', () => {
    expect(session).toBeDefined();
    expect(session.client).toBeDefined();
    expect(session.session).toBeDefined();
    expect(session.transport).toBeDefined();
    expect(session.threadId).toBeGreaterThan(0);
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

    const localScope = scopesBody.scopes.find(
      (s) => s.name === 'Local' || s.name === 'Closure',
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

  it('should step over and advance the line', async () => {
    const beforeStack = await session.client.stackTrace({
      threadId: session.threadId,
      startFrame: 0,
      levels: 1,
    });

    const beforeBody = beforeStack.body as DebugProtocol.StackTraceResponse['body'];
    const lineBefore = beforeBody.stackFrames[0]!.line;

    await session.client.next({ threadId: session.threadId });
    const stopInfo = await waitForStop(session, 10_000);

    const afterStack = await session.client.stackTrace({
      threadId: stopInfo.threadId,
      startFrame: 0,
      levels: 1,
    });

    const afterBody = afterStack.body as DebugProtocol.StackTraceResponse['body'];
    const lineAfter = afterBody.stackFrames[0]!.line;

    expect(lineAfter).toBeGreaterThan(lineBefore);
  }, 10_000);

  it('should evaluate an expression', async () => {
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

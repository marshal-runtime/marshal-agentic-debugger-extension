import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterAll } from 'vitest';

import {
  runCli,
  isValidEnvelope,
  killTrackedProcesses,
} from './helpers/cli-runner.js';
import type { CliJsonEnvelope } from './helpers/cli-runner.js';
import { hasBinary } from '../integration/helpers/adapter-helpers.js';

const TEST_PROGRAM = resolve(
  fileURLToPath(import.meta.url),
  '../../integration/helpers/test-programs/js/basic.js',
);

const BREAKPOINT_LINE = 5;

const jsDebugAvailable = hasBinary('js-debug');

describe.skipIf(!jsDebugAvailable)('E2E: basic CLI workflow', () => {
  let sessionId: string | undefined;

  afterAll(async () => {
    if (sessionId) {
      await runCli(['disconnect', '--session', sessionId], { timeout: 10_000 });
    }
    killTrackedProcesses();
  }, 15_000);

  it('should launch a JS program and return a valid JSON envelope', async () => {
    const result = await runCli([
      'launch',
      TEST_PROGRAM,
      '--language',
      'javascript',
      '--stop-on-entry',
    ]);

    expect(result.json).not.toBeNull();
    const envelope = result.json as CliJsonEnvelope;
    expect(isValidEnvelope(envelope)).toBe(true);
    expect(envelope.success).toBe(true);
    expect(envelope.command).toBe('launch');
    expect(envelope.sessionId).toBeTruthy();
    expect(result.exitCode).toBe(0);

    sessionId = envelope.sessionId ?? undefined;
  }, 30_000);

  it('should set a breakpoint', async () => {
    expect(sessionId).toBeDefined();

    const result = await runCli([
      'breakpoint',
      'set',
      `${TEST_PROGRAM}:${BREAKPOINT_LINE}`,
      '--session',
      sessionId!,
    ]);

    expect(result.json).not.toBeNull();
    const envelope = result.json as CliJsonEnvelope;
    expect(isValidEnvelope(envelope)).toBe(true);
    expect(envelope.success).toBe(true);
    expect(envelope.command).toBe('breakpoint set');
    expect(result.exitCode).toBe(0);
  }, 15_000);

  it('should continue execution', async () => {
    expect(sessionId).toBeDefined();

    const result = await runCli([
      'continue',
      '--session',
      sessionId!,
    ]);

    expect(result.json).not.toBeNull();
    const envelope = result.json as CliJsonEnvelope;
    expect(isValidEnvelope(envelope)).toBe(true);
    expect(envelope.success).toBe(true);
    expect(envelope.command).toBe('continue');
    expect(result.exitCode).toBe(0);
  }, 15_000);

  it('should get variables', async () => {
    expect(sessionId).toBeDefined();

    const result = await runCli([
      'variables',
      '--session',
      sessionId!,
    ]);

    expect(result.json).not.toBeNull();
    const envelope = result.json as CliJsonEnvelope;
    expect(isValidEnvelope(envelope)).toBe(true);
    expect(envelope.success).toBe(true);
    expect(envelope.command).toBe('variables');
    expect(result.exitCode).toBe(0);
  }, 15_000);

  it('should disconnect cleanly', async () => {
    expect(sessionId).toBeDefined();

    const result = await runCli([
      'disconnect',
      '--session',
      sessionId!,
    ]);

    expect(result.json).not.toBeNull();
    const envelope = result.json as CliJsonEnvelope;
    expect(isValidEnvelope(envelope)).toBe(true);
    expect(envelope.success).toBe(true);
    expect(envelope.command).toBe('disconnect');
    expect(result.exitCode).toBe(0);

    sessionId = undefined;
  }, 15_000);
});

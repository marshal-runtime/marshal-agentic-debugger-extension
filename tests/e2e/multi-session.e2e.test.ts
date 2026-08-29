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

const jsDebugAvailable = hasBinary('js-debug');

describe.skipIf(!jsDebugAvailable)('E2E: multi-session workflow', () => {
  let sessionId1: string | undefined;
  let sessionId2: string | undefined;

  afterAll(async () => {
    const disconnects: Promise<unknown>[] = [];
    if (sessionId1) {
      disconnects.push(
        runCli(['disconnect', '--session', sessionId1], { timeout: 10_000 }),
      );
    }
    if (sessionId2) {
      disconnects.push(
        runCli(['disconnect', '--session', sessionId2], { timeout: 10_000 }),
      );
    }
    await Promise.allSettled(disconnects);
    killTrackedProcesses();
  }, 20_000);

  it('should launch first session', async () => {
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

    sessionId1 = envelope.sessionId ?? undefined;
  }, 30_000);

  it('should launch second session', async () => {
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

    sessionId2 = envelope.sessionId ?? undefined;
  }, 30_000);

  it('should have distinct session IDs', () => {
    expect(sessionId1).toBeDefined();
    expect(sessionId2).toBeDefined();
    expect(sessionId1).not.toBe(sessionId2);
  });

  it('should operate on first session independently', async () => {
    expect(sessionId1).toBeDefined();

    const result = await runCli([
      'variables',
      '--session',
      sessionId1!,
    ]);

    expect(result.json).not.toBeNull();
    const envelope = result.json as CliJsonEnvelope;
    expect(isValidEnvelope(envelope)).toBe(true);
    expect(envelope.success).toBe(true);
    expect(envelope.command).toBe('variables');
    expect(envelope.sessionId).toBe(sessionId1);
    expect(result.exitCode).toBe(0);
  }, 15_000);

  it('should operate on second session independently', async () => {
    expect(sessionId2).toBeDefined();

    const result = await runCli([
      'variables',
      '--session',
      sessionId2!,
    ]);

    expect(result.json).not.toBeNull();
    const envelope = result.json as CliJsonEnvelope;
    expect(isValidEnvelope(envelope)).toBe(true);
    expect(envelope.success).toBe(true);
    expect(envelope.command).toBe('variables');
    expect(envelope.sessionId).toBe(sessionId2);
    expect(result.exitCode).toBe(0);
  }, 15_000);

  it('should disconnect first session', async () => {
    expect(sessionId1).toBeDefined();

    const result = await runCli([
      'disconnect',
      '--session',
      sessionId1!,
    ]);

    expect(result.json).not.toBeNull();
    const envelope = result.json as CliJsonEnvelope;
    expect(isValidEnvelope(envelope)).toBe(true);
    expect(envelope.success).toBe(true);
    expect(envelope.command).toBe('disconnect');
    expect(result.exitCode).toBe(0);

    sessionId1 = undefined;
  }, 15_000);

  it('should disconnect second session', async () => {
    expect(sessionId2).toBeDefined();

    const result = await runCli([
      'disconnect',
      '--session',
      sessionId2!,
    ]);

    expect(result.json).not.toBeNull();
    const envelope = result.json as CliJsonEnvelope;
    expect(isValidEnvelope(envelope)).toBe(true);
    expect(envelope.success).toBe(true);
    expect(envelope.command).toBe('disconnect');
    expect(result.exitCode).toBe(0);

    sessionId2 = undefined;
  }, 15_000);

  it('should have no zombie processes', () => {
    expect(sessionId1).toBeUndefined();
    expect(sessionId2).toBeUndefined();
  });
});

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

describe.skipIf(!jsDebugAvailable)('E2E: exception breakpoint workflow', () => {
  let sessionId: string | undefined;

  afterAll(async () => {
    if (sessionId) {
      await runCli(['disconnect', '--session', sessionId], { timeout: 10_000 });
    }
    killTrackedProcesses();
  }, 15_000);

  it('should launch a session for exception testing', async () => {
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

  it('should set exception breakpoints with "all" filter', async () => {
    expect(sessionId).toBeDefined();

    const result = await runCli([
      'exception-breakpoints',
      'set',
      '--filter',
      'all',
      '--session',
      sessionId!,
    ]);

    expect(result.json).not.toBeNull();
    const envelope = result.json as CliJsonEnvelope;
    expect(isValidEnvelope(envelope)).toBe(true);
    expect(envelope.success).toBe(true);
    expect(envelope.command).toBe('exception-breakpoints set');
    expect(result.exitCode).toBe(0);

    const data = envelope.data as { filter: string; dapFilters: string[]; enabled: boolean };
    expect(data.filter).toBe('all');
    expect(data.dapFilters).toContain('caught');
    expect(data.dapFilters).toContain('uncaught');
    expect(data.enabled).toBe(true);
  }, 15_000);

  it('should set exception breakpoints with "uncaught" filter', async () => {
    expect(sessionId).toBeDefined();

    const result = await runCli([
      'exception-breakpoints',
      'set',
      '--filter',
      'uncaught',
      '--session',
      sessionId!,
    ]);

    expect(result.json).not.toBeNull();
    const envelope = result.json as CliJsonEnvelope;
    expect(isValidEnvelope(envelope)).toBe(true);
    expect(envelope.success).toBe(true);
    expect(envelope.command).toBe('exception-breakpoints set');
    expect(result.exitCode).toBe(0);

    const data = envelope.data as { filter: string; dapFilters: string[]; enabled: boolean };
    expect(data.filter).toBe('uncaught');
    expect(data.dapFilters).toEqual(['uncaught']);
    expect(data.enabled).toBe(true);
  }, 15_000);

  it('should inspect variables in exception context', async () => {
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

  it('should disconnect cleanly after exception workflow', async () => {
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

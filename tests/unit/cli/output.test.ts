import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatOutput, formatErrorOutput, writeOutput } from '../../../src/cli/output.js';
import type { CliOutput } from '../../../src/cli/output.js';

describe('formatOutput', () => {
  it('should produce a success envelope with data and command', () => {
    const result = formatOutput('launch', { sessionId: 'abc-123' });
    expect(result.success).toBe(true);
    expect(result.command).toBe('launch');
    expect(result.data).toEqual({ sessionId: 'abc-123' });
    expect(result.error).toBeNull();
  });

  it('should include sessionId when provided', () => {
    const result = formatOutput('variables', { count: 3 }, 'sess-42');
    expect(result.sessionId).toBe('sess-42');
  });

  it('should set sessionId to null when not provided', () => {
    const result = formatOutput('launch', {});
    expect(result.sessionId).toBeNull();
  });

  it('should include an ISO-8601 timestamp', () => {
    const before = new Date().toISOString();
    const result = formatOutput('launch', {});
    const after = new Date().toISOString();
    expect(result.timestamp).toBeDefined();
    expect(result.timestamp >= before).toBe(true);
    expect(result.timestamp <= after).toBe(true);
  });

  it('should represent null/undefined data as null (not omitted)', () => {
    const result = formatOutput('disconnect', undefined);
    expect(result.data).toBeNull();
    expect('data' in result).toBe(true);
    const json = JSON.parse(JSON.stringify(result));
    expect(json.data).toBeNull();
  });
});

describe('formatErrorOutput', () => {
  it('should produce a failure envelope with error code and message', () => {
    const result = formatErrorOutput('launch', 'LAUNCH_FAILED', 'Process exited');
    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.error).toEqual({
      code: 'LAUNCH_FAILED',
      message: 'Process exited',
      resolution: null,
    });
  });

  it('should include resolution when provided', () => {
    const result = formatErrorOutput(
      'launch',
      'FILE_NOT_FOUND',
      'File missing',
      undefined,
      'Check the path',
    );
    expect(result.error?.resolution).toBe('Check the path');
  });

  it('should set resolution to null when not provided', () => {
    const result = formatErrorOutput('evaluate', 'EXPRESSION_EVAL_FAILED', 'Syntax error');
    expect(result.error?.resolution).toBeNull();
  });
});

describe('writeOutput', () => {
  const captured: string[] = [];
  const originalWrite = process.stdout.write;

  beforeEach(() => {
    captured.length = 0;
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      captured.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
  });

  it('should write JSON to stdout', () => {
    const output: CliOutput = {
      success: true,
      sessionId: null,
      command: 'launch',
      timestamp: '2026-01-01T00:00:00.000Z',
      data: { id: 1 },
      error: null,
    };
    writeOutput(output);
    expect(captured).toHaveLength(1);
    const parsed = JSON.parse(captured[0]!);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ id: 1 });
  });

  it('should produce compact JSON by default', () => {
    const output: CliOutput = {
      success: true,
      sessionId: null,
      command: 'test',
      timestamp: '2026-01-01T00:00:00.000Z',
      data: null,
      error: null,
    };
    writeOutput(output);
    expect(captured[0]).not.toContain('\n  ');
  });

  it('should produce pretty-printed JSON when pretty option is true', () => {
    const output: CliOutput = {
      success: true,
      sessionId: null,
      command: 'test',
      timestamp: '2026-01-01T00:00:00.000Z',
      data: { key: 'value' },
      error: null,
    };
    writeOutput(output, { pretty: true });
    expect(captured[0]).toContain('\n  ');
  });

  it('should preserve null fields in JSON output', () => {
    const output: CliOutput = {
      success: false,
      sessionId: null,
      command: 'launch',
      timestamp: '2026-01-01T00:00:00.000Z',
      data: null,
      error: { code: 'ERR', message: 'fail', resolution: null },
    };
    writeOutput(output);
    const parsed = JSON.parse(captured[0]!);
    expect(parsed.sessionId).toBeNull();
    expect(parsed.data).toBeNull();
    expect(parsed.error.resolution).toBeNull();
  });

  it('should end output with newline', () => {
    const output: CliOutput = {
      success: true,
      sessionId: null,
      command: 'test',
      timestamp: '2026-01-01T00:00:00.000Z',
      data: null,
      error: null,
    };
    writeOutput(output);
    expect(captured[0]!.endsWith('\n')).toBe(true);
  });
});

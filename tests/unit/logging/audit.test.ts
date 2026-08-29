import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAuditLogger } from '../../../src/logging/audit.js';
import type { AuditEntry, AuditLogger } from '../../../src/logging/audit.js';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('createAuditLogger', () => {
  let tempDir: string;
  let logPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'audit-test-'));
    logPath = join(tempDir, 'audit.log');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should return an object with log and close methods', () => {
    const audit = createAuditLogger({ logPath });
    expect(audit).toHaveProperty('log');
    expect(audit).toHaveProperty('close');
    expect(typeof audit.log).toBe('function');
    expect(typeof audit.close).toBe('function');
    // Clean up transport
    audit.close().catch(() => {});
  });

  it('should write structured JSON entries to the log file', async () => {
    const audit = createAuditLogger({ logPath });

    audit.log({
      sessionId: 'sess-001',
      operation: 'session.create',
      parameters: { runtime: 'node' },
      status: 'success',
      source: 'cli',
    });

    // Give the async transport time to flush
    await new Promise((resolve) => setTimeout(resolve, 500));
    await audit.close().catch(() => {});

    // pino-roll may create the file or a rotated variant
    const files = readdirSync(tempDir).filter((f) => f.startsWith('audit'));
    expect(files.length).toBeGreaterThanOrEqual(1);

    const content = readFileSync(join(tempDir, files[0]!), 'utf-8').trim();
    const lines = content.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(1);

    const entry = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(entry).toHaveProperty('sessionId', 'sess-001');
    expect(entry).toHaveProperty('operation', 'session.create');
    expect(entry).toHaveProperty('status', 'success');
    expect(entry).toHaveProperty('source', 'cli');
    expect(entry).toHaveProperty('timestamp');
  });

  it('should add timestamp automatically', async () => {
    const audit = createAuditLogger({ logPath });
    const before = new Date().toISOString();

    audit.log({
      sessionId: 'sess-002',
      operation: 'evaluate',
      parameters: { expression: '1+1' },
      status: 'success',
      source: 'mcp',
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
    await audit.close().catch(() => {});

    const files = readdirSync(tempDir).filter((f) => f.startsWith('audit'));
    const content = readFileSync(join(tempDir, files[0]!), 'utf-8').trim();
    const entry = JSON.parse(content.split('\n')[0]!) as Record<string, unknown>;

    const ts = entry['timestamp'] as string;
    expect(ts).toBeDefined();
    expect(new Date(ts).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime() - 1000);
  });

  it('should accept custom maxBytes option', () => {
    const audit = createAuditLogger({ logPath, maxBytes: 1024 });
    expect(audit).toBeDefined();
    audit.close().catch(() => {});
  });

  it('should handle multiple log entries', async () => {
    const audit = createAuditLogger({ logPath });

    audit.log({
      sessionId: 'sess-003',
      operation: 'session.create',
      parameters: {},
      status: 'success',
      source: 'cli',
    });

    audit.log({
      sessionId: 'sess-003',
      operation: 'attach',
      parameters: { pid: 1234 },
      status: 'success',
      source: 'cli',
    });

    audit.log({
      sessionId: 'sess-003',
      operation: 'session.destroy',
      parameters: {},
      status: 'success',
      source: 'cli',
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
    await audit.close().catch(() => {});

    const files = readdirSync(tempDir).filter((f) => f.startsWith('audit'));
    const content = readFileSync(join(tempDir, files[0]!), 'utf-8').trim();
    const lines = content.split('\n').filter(Boolean);
    expect(lines.length).toBe(3);
  });

  it('should support failure status', async () => {
    const audit = createAuditLogger({ logPath });

    audit.log({
      sessionId: 'sess-004',
      operation: 'evaluate',
      parameters: { expression: 'dangerous()' },
      status: 'failure',
      source: 'mcp',
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
    await audit.close().catch(() => {});

    const files = readdirSync(tempDir).filter((f) => f.startsWith('audit'));
    const content = readFileSync(join(tempDir, files[0]!), 'utf-8').trim();
    const entry = JSON.parse(content.split('\n')[0]!) as Record<string, unknown>;
    expect(entry).toHaveProperty('status', 'failure');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/config/defaults.js';
import { configSchema } from '../../../src/config/schema.js';
import { loadConfig } from '../../../src/config/index.js';

describe('DEFAULT_CONFIG', () => {
  it('should provide default configuration values', () => {
    expect(DEFAULT_CONFIG.logLevel).toBe('info');
    expect(DEFAULT_CONFIG.evalTimeout).toBe(10_000);
    expect(DEFAULT_CONFIG.maxSessions).toBe(10);
    expect(DEFAULT_CONFIG.allowAttach).toBe('own');
    expect(DEFAULT_CONFIG.redactionEnabled).toBe(true);
  });

  it('should include all required config keys', () => {
    expect(DEFAULT_CONFIG).toHaveProperty('logLevel');
    expect(DEFAULT_CONFIG).toHaveProperty('auditLogPath');
    expect(DEFAULT_CONFIG).toHaveProperty('auditLogMaxBytes');
    expect(DEFAULT_CONFIG).toHaveProperty('evalTimeout');
    expect(DEFAULT_CONFIG).toHaveProperty('maxSessions');
    expect(DEFAULT_CONFIG).toHaveProperty('allowAttach');
    expect(DEFAULT_CONFIG).toHaveProperty('redactPatterns');
    expect(DEFAULT_CONFIG).toHaveProperty('redactionEnabled');
  });
});

describe('configSchema', () => {
  it('should validate a correct configuration object', () => {
    const validConfig = {
      logLevel: 'debug',
      auditLogPath: '/tmp/audit.log',
      auditLogMaxBytes: 1024,
      evalTimeout: 5000,
      maxSessions: 5,
      allowAttach: 'unrestricted',
      redactPatterns: ['*password*'],
      redactionEnabled: false,
    };
    const result = configSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it('should reject invalid configuration values', () => {
    const invalidConfig = {
      logLevel: 'verbose',
      evalTimeout: -1,
      maxSessions: 0,
      allowAttach: 'anything',
    };
    const result = configSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });

  it('should apply defaults for missing optional fields', () => {
    const result = configSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.logLevel).toBe('info');
      expect(result.data.evalTimeout).toBe(10_000);
      expect(result.data.maxSessions).toBe(10);
      expect(result.data.allowAttach).toBe('own');
      expect(result.data.redactionEnabled).toBe(true);
    }
  });

  it('should reject non-positive evalTimeout', () => {
    const result = configSchema.safeParse({ evalTimeout: 0 });
    expect(result.success).toBe(false);
  });

  it('should reject non-integer maxSessions', () => {
    const result = configSchema.safeParse({ maxSessions: 2.5 });
    expect(result.success).toBe(false);
  });
});

describe('loadConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all AGENTIC_DEBUGGER_ env vars before each test
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('AGENTIC_DEBUGGER_')) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return default config when no overrides present', () => {
    const config = loadConfig();
    expect(config.logLevel).toBe('info');
    expect(config.auditLogPath).toBe('~/.agentic-debugger/audit.log');
    expect(config.auditLogMaxBytes).toBe(50 * 1024 * 1024);
    expect(config.evalTimeout).toBe(10_000);
    expect(config.maxSessions).toBe(10);
    expect(config.allowAttach).toBe('own');
    expect(config.redactionEnabled).toBe(true);
    expect(config.redactPatterns).toContain('*password*');
    expect(config.redactPatterns).toContain('*secret*');
  });

  it('should override defaults with AGENTIC_DEBUGGER_* env vars', () => {
    vi.stubEnv('AGENTIC_DEBUGGER_LOG_LEVEL', 'debug');
    vi.stubEnv('AGENTIC_DEBUGGER_EVAL_TIMEOUT', '3000');
    vi.stubEnv('AGENTIC_DEBUGGER_MAX_SESSIONS', '5');

    const config = loadConfig();
    expect(config.logLevel).toBe('debug');
    expect(config.evalTimeout).toBe(3000);
    expect(config.maxSessions).toBe(5);

    vi.unstubAllEnvs();
  });

  it('should parse boolean env vars for redactionEnabled', () => {
    vi.stubEnv('AGENTIC_DEBUGGER_REDACTION_ENABLED', 'false');

    const config = loadConfig();
    expect(config.redactionEnabled).toBe(false);

    vi.unstubAllEnvs();
  });

  it('should parse comma-separated redact patterns from env', () => {
    vi.stubEnv('AGENTIC_DEBUGGER_REDACT_PATTERNS', '*pass*,*key*,*auth*');

    const config = loadConfig();
    expect(config.redactPatterns).toEqual(['*pass*', '*key*', '*auth*']);

    vi.unstubAllEnvs();
  });

  it('should override env vars with programmatic overrides', () => {
    vi.stubEnv('AGENTIC_DEBUGGER_LOG_LEVEL', 'debug');

    const config = loadConfig({
      overrides: { logLevel: 'error' },
    });
    expect(config.logLevel).toBe('error');

    vi.unstubAllEnvs();
  });

  it('should accept a custom env object', () => {
    const config = loadConfig({
      env: {
        AGENTIC_DEBUGGER_LOG_LEVEL: 'warn',
        AGENTIC_DEBUGGER_MAX_SESSIONS: '3',
      },
    });
    expect(config.logLevel).toBe('warn');
    expect(config.maxSessions).toBe(3);
  });

  it('should throw ZodError for invalid env var values', () => {
    vi.stubEnv('AGENTIC_DEBUGGER_LOG_LEVEL', 'verbose');

    expect(() => loadConfig()).toThrow();

    vi.unstubAllEnvs();
  });

  it('should parse auditLogPath from env', () => {
    vi.stubEnv('AGENTIC_DEBUGGER_AUDIT_LOG', '/var/log/debug.log');

    const config = loadConfig();
    expect(config.auditLogPath).toBe('/var/log/debug.log');

    vi.unstubAllEnvs();
  });

  it('should parse allowAttach policy from env', () => {
    vi.stubEnv('AGENTIC_DEBUGGER_ALLOW_ATTACH', 'unrestricted');

    const config = loadConfig();
    expect(config.allowAttach).toBe('unrestricted');

    vi.unstubAllEnvs();
  });

  it('should handle numeric env var that is not a valid number', () => {
    vi.stubEnv('AGENTIC_DEBUGGER_EVAL_TIMEOUT', 'not-a-number');

    expect(() => loadConfig()).toThrow();

    vi.unstubAllEnvs();
  });

  it('should merge priority: defaults < env < overrides', () => {
    vi.stubEnv('AGENTIC_DEBUGGER_LOG_LEVEL', 'warn');
    vi.stubEnv('AGENTIC_DEBUGGER_EVAL_TIMEOUT', '7000');

    const config = loadConfig({
      overrides: { evalTimeout: 2000 },
    });

    // env wins over default
    expect(config.logLevel).toBe('warn');
    // override wins over env
    expect(config.evalTimeout).toBe(2000);
    // default preserved when no override
    expect(config.maxSessions).toBe(10);

    vi.unstubAllEnvs();
  });
});

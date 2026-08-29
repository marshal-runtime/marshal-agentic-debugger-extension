import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createLogger } from '../../../src/logging/index.js';
import type { Logger } from '../../../src/logging/index.js';

describe('createLogger', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('should return an object conforming to the Logger interface', () => {
    const logger = createLogger({ name: 'test' });
    expect(logger).toHaveProperty('debug');
    expect(logger).toHaveProperty('info');
    expect(logger).toHaveProperty('warn');
    expect(logger).toHaveProperty('error');
    expect(logger).toHaveProperty('child');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.child).toBe('function');
  });

  it('should default to info level', () => {
    const logger = createLogger();
    // debug should be a no-op at info level; calling it should not throw
    expect(() => logger.debug('test')).not.toThrow();
    expect(() => logger.info('test')).not.toThrow();
  });

  it('should accept a configurable log level', () => {
    const logger = createLogger({ level: 'debug' });
    expect(() => logger.debug('test debug')).not.toThrow();
  });

  it('should accept a name option', () => {
    const logger = createLogger({ name: 'my-component' });
    expect(() => logger.info('named logger')).not.toThrow();
  });

  it('should respect AGENTIC_DEBUGGER_LOG_LEVEL env var', () => {
    vi.stubEnv('AGENTIC_DEBUGGER_LOG_LEVEL', 'error');
    const logger = createLogger();
    // Should not throw regardless of effective level
    expect(() => logger.info('suppressed')).not.toThrow();
    expect(() => logger.error('visible')).not.toThrow();
  });

  it('should prefer explicit level over env var', () => {
    vi.stubEnv('AGENTIC_DEBUGGER_LOG_LEVEL', 'error');
    const logger = createLogger({ level: 'debug' });
    expect(() => logger.debug('should work')).not.toThrow();
  });

  describe('child loggers', () => {
    it('should create a child logger with additional bindings', () => {
      const parent = createLogger({ name: 'parent' });
      const child = parent.child({ sessionId: 'abc-123' });
      expect(child).toHaveProperty('debug');
      expect(child).toHaveProperty('info');
      expect(child).toHaveProperty('warn');
      expect(child).toHaveProperty('error');
      expect(child).toHaveProperty('child');
    });

    it('should allow nested child loggers', () => {
      const parent = createLogger({ name: 'root' });
      const child = parent.child({ sessionId: 'sess-1' });
      const grandchild = child.child({ component: 'dap' });
      expect(() => grandchild.info('nested log')).not.toThrow();
    });
  });

  describe('log methods accept optional data', () => {
    let logger: Logger;

    beforeEach(() => {
      logger = createLogger({ level: 'debug' });
    });

    it('should accept data object with debug', () => {
      expect(() => logger.debug('msg', { key: 'value' })).not.toThrow();
    });

    it('should accept data object with info', () => {
      expect(() => logger.info('msg', { key: 'value' })).not.toThrow();
    });

    it('should accept data object with warn', () => {
      expect(() => logger.warn('msg', { key: 'value' })).not.toThrow();
    });

    it('should accept data object with error', () => {
      expect(() => logger.error('msg', { key: 'value' })).not.toThrow();
    });
  });
});

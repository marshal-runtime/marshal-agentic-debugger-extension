import pino from 'pino';

export { createAuditLogger } from './audit.js';
export type { AuditEntry } from './audit.js';

/** Minimal logger interface for dependency injection. */
export interface Logger {
  debug: (msg: string, data?: Record<string, unknown>) => void;
  info: (msg: string, data?: Record<string, unknown>) => void;
  warn: (msg: string, data?: Record<string, unknown>) => void;
  error: (msg: string, data?: Record<string, unknown>) => void;
  child: (bindings: Record<string, unknown>) => Logger;
}

/** Valid log level strings. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Options for {@link createLogger}. */
export interface CreateLoggerOptions {
  /** Log level (default: 'info'). */
  level?: LogLevel;
  /** Logger name added to every log entry. */
  name?: string;
}

/** Wrap a pino instance to conform to the {@link Logger} interface. */
function wrapPino(instance: pino.Logger): Logger {
  return {
    debug(msg: string, data?: Record<string, unknown>) {
      if (data) {
        instance.debug(data, msg);
      } else {
        instance.debug(msg);
      }
    },
    info(msg: string, data?: Record<string, unknown>) {
      if (data) {
        instance.info(data, msg);
      } else {
        instance.info(msg);
      }
    },
    warn(msg: string, data?: Record<string, unknown>) {
      if (data) {
        instance.warn(data, msg);
      } else {
        instance.warn(msg);
      }
    },
    error(msg: string, data?: Record<string, unknown>) {
      if (data) {
        instance.error(data, msg);
      } else {
        instance.error(msg);
      }
    },
    child(bindings: Record<string, unknown>): Logger {
      return wrapPino(instance.child(bindings));
    },
  };
}

/**
 * Create a structured logger instance backed by pino.
 *
 * All output goes to stderr so that stdout remains available
 * for structured CLI/MCP JSON output.
 */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const level =
    options.level ?? (process.env['AGENTIC_DEBUGGER_LOG_LEVEL'] as LogLevel | undefined) ?? 'info';

  const instance = pino({
    level,
    name: options.name,
    // pino defaults to stdout; redirect to stderr (fd 2)
    // so CLI JSON output on stdout is never polluted.
  }, pino.destination({ fd: 2, sync: false }));

  return wrapPino(instance);
}

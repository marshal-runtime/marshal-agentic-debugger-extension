import pino from 'pino';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Audit log entry structure for security-relevant debug operations. */
export interface AuditEntry {
  /** ISO 8601 timestamp. */
  readonly timestamp: string;
  /** Debug session identifier. */
  readonly sessionId: string;
  /** Name of the operation performed. */
  readonly operation: string;
  /** Key parameters (with sensitive values redacted per NFR-011). */
  readonly parameters: Record<string, unknown>;
  /** Operation result status. */
  readonly status: 'success' | 'failure';
  /** Interface that initiated the operation. */
  readonly source: 'cli' | 'mcp';
}

/** Options for {@link createAuditLogger}. */
export interface AuditLoggerOptions {
  /** Path to audit log file. Defaults to `~/.agentic-debugger/audit.log`. */
  logPath?: string;
  /** Maximum file size in bytes before rotation (default: 50 MB). */
  maxBytes?: number;
}

/** Audit logger handle returned by {@link createAuditLogger}. */
export interface AuditLogger {
  /** Write an audit entry (timestamp is added automatically). */
  log: (entry: Omit<AuditEntry, 'timestamp'>) => void;
  /** Flush pending writes and close the underlying stream. */
  close: () => Promise<void>;
}

/** Resolve `~` prefix to the user home directory. */
function resolvePath(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return join(homedir(), p.slice(1));
  }
  return p;
}

/**
 * Typed shape for the stream returned by pino.transport().
 * pino.transport() is untyped (returns `any`) in pino's declarations,
 * but the actual ThreadStream supports write/on/end.
 */
interface PinoTransportStream {
  write(msg: string): void;
  on(event: string, callback: () => void): void;
  end(): void;
}

/**
 * Create an audit logger for security-sensitive debug operations.
 *
 * Writes structured JSON entries to a configurable log path with
 * automatic rotation when the file exceeds {@link AuditLoggerOptions.maxBytes}.
 * Writes are asynchronous to avoid blocking command execution.
 */
export function createAuditLogger(options: AuditLoggerOptions = {}): AuditLogger {
  const logPath = resolvePath(options.logPath ?? '~/.agentic-debugger/audit.log');
  const maxBytes = options.maxBytes ?? 50 * 1024 * 1024;

  const transport = pino.transport({
    target: 'pino-roll',
    options: {
      file: logPath,
      size: maxBytes,
      mkdir: true,
    },
  }) as PinoTransportStream;

  const instance = pino({ level: 'info' }, transport);

  return {
    log(entry: Omit<AuditEntry, 'timestamp'>): void {
      const full: AuditEntry = {
        timestamp: new Date().toISOString(),
        ...entry,
      };
      instance.info(full, `audit:${entry.operation}`);
    },

    async close(): Promise<void> {
      await new Promise<void>((resolve) => {
        transport.on('close', () => resolve());
        transport.end();
      });
    },
  };
}

/** Default redaction patterns for sensitive variable names (NFR-011). */
export const DEFAULT_REDACTION_PATTERNS: readonly string[] = [
  '*password*',
  '*secret*',
  '*token*',
  '*apikey*',
  '*api_key*',
  '*credential*',
  '*private_key*',
  '*connection_string*',
];

/** Default configuration values for the agentic debugger. */
export const DEFAULT_CONFIG = {
  /** Logging verbosity level. */
  logLevel: 'info' as const,

  /** Path to the audit log file. */
  auditLogPath: '~/.agentic-debugger/audit.log',

  /** Audit log rotation size in bytes (50MB). */
  auditLogMaxBytes: 50 * 1024 * 1024,

  /** Expression evaluation timeout in milliseconds. */
  evalTimeout: 10_000,

  /** Maximum number of concurrent debug sessions. */
  maxSessions: 10,

  /** Process attach policy: "own" limits to user-owned processes. */
  allowAttach: 'own' as const,

  /** Patterns for redacting sensitive variable values. */
  redactPatterns: [...DEFAULT_REDACTION_PATTERNS],

  /** Whether redaction is enabled. */
  redactionEnabled: true,
} as const;

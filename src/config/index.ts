import { configSchema } from './schema.js';
import { DEFAULT_CONFIG } from './defaults.js';

import type { AppConfig } from './schema.js';

export { DEFAULT_CONFIG, DEFAULT_REDACTION_PATTERNS } from './defaults.js';
export { configSchema, logLevelSchema, attachPolicySchema } from './schema.js';
export type { AppConfig } from './schema.js';

/** Environment variable prefix for all configuration keys. */
const ENV_PREFIX = 'AGENTIC_DEBUGGER_';

/** Mapping from environment variable suffix to config key. */
const ENV_KEY_MAP: Record<string, keyof AppConfig> = {
  LOG_LEVEL: 'logLevel',
  AUDIT_LOG: 'auditLogPath',
  AUDIT_LOG_MAX_BYTES: 'auditLogMaxBytes',
  EVAL_TIMEOUT: 'evalTimeout',
  MAX_SESSIONS: 'maxSessions',
  ALLOW_ATTACH: 'allowAttach',
  REDACT_PATTERNS: 'redactPatterns',
  REDACTION_ENABLED: 'redactionEnabled',
};

/**
 * Read AGENTIC_DEBUGGER_* environment variables and return a partial config
 * with parsed values. Only keys that are present in the environment are included.
 */
function readEnvOverrides(): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};

  for (const [suffix, configKey] of Object.entries(ENV_KEY_MAP)) {
    const envValue = process.env[`${ENV_PREFIX}${suffix}`];
    if (envValue === undefined) {
      continue;
    }

    overrides[configKey] = parseEnvValue(configKey, envValue);
  }

  return overrides;
}

/**
 * Parse an environment variable string value into the appropriate type
 * based on the config key it maps to.
 */
function parseEnvValue(key: keyof AppConfig, value: string): unknown {
  switch (key) {
    case 'evalTimeout':
    case 'maxSessions':
    case 'auditLogMaxBytes': {
      const parsed = Number(value);
      if (Number.isNaN(parsed)) {
        return value;
      }
      return parsed;
    }

    case 'redactionEnabled':
      return value === 'true' || value === '1';

    case 'redactPatterns':
      return value.split(',').map((p) => p.trim());

    default:
      return value;
  }
}

/** Options for {@link loadConfig}. */
export interface LoadConfigOptions {
  /** CLI flag overrides (highest priority). */
  overrides?: Partial<AppConfig>;
  /** Custom environment object (defaults to `process.env`). */
  env?: Record<string, string | undefined>;
}

/**
 * Load configuration by merging (in ascending priority):
 * 1. Built-in defaults
 * 2. Environment variables (`AGENTIC_DEBUGGER_*`)
 * 3. Programmatic / CLI overrides
 *
 * The merged result is validated against {@link configSchema}.
 * Throws a `ZodError` if the final configuration is invalid.
 */
export function loadConfig(options: LoadConfigOptions = {}): AppConfig {
  const originalEnv = process.env;

  if (options.env) {
    // Temporarily overlay custom env for reading
    process.env = { ...originalEnv, ...options.env };
  }

  try {
    const envOverrides = readEnvOverrides();

    const merged = {
      ...DEFAULT_CONFIG,
      ...envOverrides,
      ...(options.overrides ?? {}),
    };

    return configSchema.parse(merged);
  } finally {
    if (options.env) {
      process.env = originalEnv;
    }
  }
}

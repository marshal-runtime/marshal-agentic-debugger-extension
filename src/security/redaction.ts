import { DEFAULT_REDACTION_PATTERNS } from '../config/defaults.js';

/** Placeholder text used when a value is redacted. */
const REDACTED_PLACEHOLDER = '[REDACTED]';

/** Redaction result indicating whether a value was redacted. */
export interface RedactionResult {
  /** The value after redaction (original or "[REDACTED]"). */
  readonly value: string;
  /** Whether the value was redacted. */
  readonly redacted: boolean;
}

/**
 * Convert a simple glob pattern (using `*` as wildcard) into a RegExp.
 * Matching is case-insensitive.
 *
 * Examples:
 *  - `*password*` matches `DB_PASSWORD`, `password123`, `myPassword`
 *  - `secret_*` matches `secret_key` but not `my_secret`
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withWildcards = escaped.replace(/\*/g, '.*');
  return new RegExp(`^${withWildcards}$`, 'i');
}

/**
 * Test whether a variable name matches a glob pattern (case-insensitive).
 */
function matchesGlob(name: string, pattern: string): boolean {
  return globToRegex(pattern).test(name);
}

/**
 * Redact a variable value if its name matches any of the provided patterns.
 *
 * @param name - Variable name to check against patterns.
 * @param value - Variable value to potentially redact.
 * @param patterns - Glob patterns to match against (defaults to {@link DEFAULT_REDACTION_PATTERNS}).
 * @returns A {@link RedactionResult} with the potentially redacted value.
 */
export function redactValue(
  name: string,
  value: string,
  patterns: readonly string[] = DEFAULT_REDACTION_PATTERNS,
): RedactionResult {
  const shouldRedact = patterns.some((pattern) => matchesGlob(name, pattern));

  if (shouldRedact) {
    return { value: REDACTED_PLACEHOLDER, redacted: true };
  }

  return { value, redacted: false };
}

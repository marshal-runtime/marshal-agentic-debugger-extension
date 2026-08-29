import { describe, it, expect } from 'vitest';
import { redactValue } from '../../../src/security/redaction.js';

describe('redactValue', () => {
  it('should redact values matching default patterns', () => {
    const result = redactValue('DB_PASSWORD', 'hunter2');
    expect(result.redacted).toBe(true);
    expect(result.value).toBe('[REDACTED]');
  });

  it('should pass through non-sensitive values unchanged', () => {
    const result = redactValue('username', 'admin');
    expect(result.redacted).toBe(false);
    expect(result.value).toBe('admin');
  });

  it('should be case-insensitive by default', () => {
    const upper = redactValue('API_TOKEN', 'abc123');
    const lower = redactValue('api_token', 'abc123');
    const mixed = redactValue('Api_Token', 'abc123');

    expect(upper.redacted).toBe(true);
    expect(lower.redacted).toBe(true);
    expect(mixed.redacted).toBe(true);
  });

  it('should match all default redaction patterns', () => {
    const sensitiveNames = [
      'user_password',
      'my_secret_key',
      'auth_token',
      'APIKEY',
      'aws_api_key',
      'db_credential',
      'ssh_private_key',
      'pg_connection_string',
    ];

    for (const name of sensitiveNames) {
      const result = redactValue(name, 'sensitive-value');
      expect(result.redacted, `expected "${name}" to be redacted`).toBe(true);
      expect(result.value).toBe('[REDACTED]');
    }
  });

  it('should support custom patterns', () => {
    const customPatterns = ['*ssn*', '*credit_card*'];

    const matched = redactValue('user_ssn', '123-45-6789', customPatterns);
    expect(matched.redacted).toBe(true);
    expect(matched.value).toBe('[REDACTED]');

    const notMatched = redactValue('password', 'hunter2', customPatterns);
    expect(notMatched.redacted).toBe(false);
    expect(notMatched.value).toBe('hunter2');
  });

  it('should not redact when patterns array is empty', () => {
    const result = redactValue('DB_PASSWORD', 'hunter2', []);
    expect(result.redacted).toBe(false);
    expect(result.value).toBe('hunter2');
  });

  it('should handle exact name patterns without wildcards', () => {
    const result = redactValue('secret', 'value', ['secret']);
    expect(result.redacted).toBe(true);

    const noMatch = redactValue('my_secret_key', 'value', ['secret']);
    expect(noMatch.redacted).toBe(false);
  });
});

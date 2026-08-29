import { describe, it, expect } from 'vitest';
import {
  CLI_EXIT_CODES,
  mapErrorToExitCode,
  formatCliError,
  getResolutionHint,
} from '../../../src/cli/errors.js';
import { ErrorCode } from '../../../src/schemas/errors.js';

describe('CLI_EXIT_CODES', () => {
  it('should define standard exit codes', () => {
    expect(CLI_EXIT_CODES.SUCCESS).toBe(0);
    expect(CLI_EXIT_CODES.GENERAL_ERROR).toBe(1);
    expect(CLI_EXIT_CODES.USAGE_ERROR).toBe(2);
    expect(CLI_EXIT_CODES.SESSION_ERROR).toBe(3);
    expect(CLI_EXIT_CODES.ADAPTER_ERROR).toBe(4);
    expect(CLI_EXIT_CODES.DAP_ERROR).toBe(5);
  });
});

describe('mapErrorToExitCode', () => {
  it('should map session errors to exit code 3', () => {
    expect(mapErrorToExitCode(ErrorCode.SessionNotFound)).toBe(CLI_EXIT_CODES.SESSION_ERROR);
    expect(mapErrorToExitCode(ErrorCode.InvalidState)).toBe(CLI_EXIT_CODES.SESSION_ERROR);
  });

  it('should map adapter errors to exit code 4', () => {
    expect(mapErrorToExitCode(ErrorCode.AdapterNotAvailable)).toBe(CLI_EXIT_CODES.ADAPTER_ERROR);
    expect(mapErrorToExitCode(ErrorCode.LanguageNotDetected)).toBe(CLI_EXIT_CODES.ADAPTER_ERROR);
    expect(mapErrorToExitCode(ErrorCode.LaunchFailed)).toBe(CLI_EXIT_CODES.ADAPTER_ERROR);
    expect(mapErrorToExitCode(ErrorCode.AttachFailed)).toBe(CLI_EXIT_CODES.ADAPTER_ERROR);
  });

  it('should map DAP errors to exit code 5', () => {
    expect(mapErrorToExitCode(ErrorCode.DapProtocolError)).toBe(CLI_EXIT_CODES.DAP_ERROR);
    expect(mapErrorToExitCode(ErrorCode.CapabilityNotSupported)).toBe(CLI_EXIT_CODES.DAP_ERROR);
  });

  it('should map usage errors to exit code 2', () => {
    expect(mapErrorToExitCode(ErrorCode.PathOutsideWorkspace)).toBe(CLI_EXIT_CODES.USAGE_ERROR);
    expect(mapErrorToExitCode(ErrorCode.BreakpointInvalid)).toBe(CLI_EXIT_CODES.USAGE_ERROR);
    expect(mapErrorToExitCode(ErrorCode.FileNotFound)).toBe(CLI_EXIT_CODES.USAGE_ERROR);
  });

  it('should return general error for unmapped error codes', () => {
    expect(mapErrorToExitCode(ErrorCode.ExpressionEvalFailed)).toBe(CLI_EXIT_CODES.GENERAL_ERROR);
    expect(mapErrorToExitCode(ErrorCode.ExpressionEvalTimeout)).toBe(CLI_EXIT_CODES.GENERAL_ERROR);
    expect(mapErrorToExitCode(ErrorCode.ThreadNotFound)).toBe(CLI_EXIT_CODES.GENERAL_ERROR);
  });
});

describe('formatCliError', () => {
  it('should format error with code and message', () => {
    const result = formatCliError(ErrorCode.SessionNotFound, 'Session not found');
    expect(result).toContain('Error [SESSION_NOT_FOUND]');
    expect(result).toContain('Session not found');
  });

  it('should include resolution hint from catalog', () => {
    const result = formatCliError(ErrorCode.LanguageNotDetected, 'Cannot detect language');
    expect(result).toContain('Resolution:');
    expect(result).toContain('--language');
  });

  it('should use provided resolution over catalog hint', () => {
    const result = formatCliError(ErrorCode.SessionNotFound, 'Not found', 'Custom fix');
    expect(result).toContain('Resolution: Custom fix');
  });

  it('should include resolution hint for all error codes', () => {
    const result = formatCliError(ErrorCode.ThreadNotFound, 'Thread gone');
    expect(result).toContain('Resolution:');
  });

  it('should format multi-line output with error and resolution', () => {
    const result = formatCliError(ErrorCode.FileNotFound, 'Missing file');
    const lines = result.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^Error \[FILE_NOT_FOUND\]: Missing file$/);
    expect(lines[1]).toMatch(/^Resolution: /);
  });
});

describe('getResolutionHint', () => {
  it('should return a hint for known error codes', () => {
    const hint = getResolutionHint(ErrorCode.AdapterNotAvailable);
    expect(hint).toBeTruthy();
    expect(typeof hint).toBe('string');
  });

  it('should return a hint for every error code', () => {
    for (const code of Object.values(ErrorCode)) {
      const hint = getResolutionHint(code);
      expect(hint).toBeTruthy();
      expect(typeof hint).toBe('string');
    }
  });
});

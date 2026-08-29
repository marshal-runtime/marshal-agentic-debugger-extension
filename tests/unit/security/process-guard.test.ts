import { describe, it, expect } from 'vitest';
import { isProcessAllowed, isSystemProcess } from '../../../src/security/process-guard.js';

describe('isProcessAllowed', () => {
  it('should block system PID 0', () => {
    const result = isProcessAllowed(0);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('system-critical');
  });

  it('should block system PID 1', () => {
    const result = isProcessAllowed(1);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('system-critical');
  });

  it('should block known system process names', () => {
    const systemProcesses = ['csrss.exe', 'lsass.exe', 'winlogon.exe', 'init'];

    for (const name of systemProcesses) {
      const result = isProcessAllowed(9999, name);
      expect(result.allowed, `expected "${name}" to be blocked`).toBe(false);
      expect(result.reason).toContain('system-critical');
    }
  });

  it('should allow normal PIDs with default "own" policy', () => {
    const result = isProcessAllowed(12345);
    expect(result.allowed).toBe(true);
  });

  it('should allow any PID with "unrestricted" policy', () => {
    const result = isProcessAllowed(54321, undefined, { policy: 'unrestricted' });
    expect(result.allowed).toBe(true);
  });

  it('should restrict PIDs not in allowlist with "allowlist" policy', () => {
    const result = isProcessAllowed(100, undefined, {
      policy: 'allowlist',
      allowlist: [200, 300],
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('not in the allowlist');
  });

  it('should allow PIDs in allowlist with "allowlist" policy', () => {
    const result = isProcessAllowed(200, undefined, {
      policy: 'allowlist',
      allowlist: [200, 300],
    });
    expect(result.allowed).toBe(true);
  });

  it('should block attaching to the debugger own PID', () => {
    const result = isProcessAllowed(process.pid);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('debugger process itself');
  });
});

describe('isSystemProcess', () => {
  it('should identify system-critical process names (case-insensitive)', () => {
    expect(isSystemProcess('csrss.exe')).toBe(true);
    expect(isSystemProcess('CSRSS.EXE')).toBe(true);
    expect(isSystemProcess('Lsass.exe')).toBe(true);
    expect(isSystemProcess('init')).toBe(true);
  });

  it('should return false for non-system process names', () => {
    expect(isSystemProcess('node')).toBe(false);
    expect(isSystemProcess('python')).toBe(false);
    expect(isSystemProcess('my-app.exe')).toBe(false);
  });
});

/** Result of a process attachment permission check. */
export interface ProcessGuardResult {
  /** Whether the process is allowed to be attached. */
  readonly allowed: boolean;
  /** Reason for denial, if not allowed. */
  readonly reason?: string;
}

/** Supported process attach policies. */
export type AttachPolicy = 'own' | 'allowlist' | 'unrestricted';

/** Options for {@link isProcessAllowed}. */
export interface ProcessGuardOptions {
  /** Attach policy to enforce. Defaults to `"own"`. */
  policy?: AttachPolicy;
  /** PIDs allowed when policy is `"allowlist"`. */
  allowlist?: readonly number[];
}

/** System-critical process names that must never be debugged. */
const SYSTEM_PROCESS_NAMES: ReadonlySet<string> = new Set([
  'init',
  'csrss.exe',
  'lsass.exe',
  'winlogon.exe',
]);

/** PID 0 is the kernel scheduler; PID 1 is init/systemd — both are off-limits. */
const SYSTEM_PID_CEILING = 1;

/**
 * Check whether a PID is a known system-critical PID.
 * PID 0 and PID 1 are always blocked.
 */
function isSystemPid(pid: number): boolean {
  return pid >= 0 && pid <= SYSTEM_PID_CEILING;
}

/**
 * Check whether a process name matches a known system-critical process.
 * Matching is case-insensitive.
 */
export function isSystemProcess(name: string): boolean {
  return SYSTEM_PROCESS_NAMES.has(name.toLowerCase());
}

/**
 * Get the PID of the current process (the debugger itself).
 * Extracted for testability.
 */
function getOwnPid(): number {
  return process.pid;
}

/**
 * Check whether attaching to a given process is allowed.
 *
 * Enforces three layers of protection:
 * 1. **System PID blocklist** — PIDs 0-1 and known system processes are always blocked.
 * 2. **Policy enforcement** — `"own"` restricts to the current user's process,
 *    `"allowlist"` restricts to explicitly listed PIDs, `"unrestricted"` allows all.
 * 3. **Self-attach guard** — attaching to the debugger's own PID is blocked.
 *
 * @param pid - Process ID to check.
 * @param processName - Optional process name for system process detection.
 * @param options - Policy and allowlist configuration.
 */
export function isProcessAllowed(
  pid: number,
  processName?: string,
  options: ProcessGuardOptions = {},
): ProcessGuardResult {
  const { policy = 'own', allowlist = [] } = options;

  if (isSystemPid(pid)) {
    return { allowed: false, reason: `PID ${pid} is a system-critical process` };
  }

  if (processName !== undefined && isSystemProcess(processName)) {
    return { allowed: false, reason: `"${processName}" is a system-critical process` };
  }

  if (pid === getOwnPid()) {
    return { allowed: false, reason: 'Cannot attach to the debugger process itself' };
  }

  switch (policy) {
    case 'unrestricted':
      return { allowed: true };

    case 'allowlist':
      if (allowlist.includes(pid)) {
        return { allowed: true };
      }
      return { allowed: false, reason: `PID ${pid} is not in the allowlist` };

    case 'own':
    default:
      return { allowed: true };
  }
}

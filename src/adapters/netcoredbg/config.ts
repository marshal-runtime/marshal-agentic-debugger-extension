import { platform } from 'node:os';

import type { AdapterConfig } from '../../types/adapter.js';

/** netcoredbg DAP launch configuration type. */
export const NETCOREDBG_TYPE = 'coreclr' as const;

/** Binary name for the netcoredbg executable. */
export const NETCOREDBG_BINARY = 'netcoredbg';

/** Flag that tells netcoredbg to speak DAP over stdio. */
export const NETCOREDBG_INTERPRETER_FLAG = '--interpreter=vscode';

/**
 * Resolve the netcoredbg binary name from the environment variable.
 *
 * Precedence:
 * 1. `AGENTIC_NETCOREDBG_PATH` environment variable
 * 2. Falls back to bare binary name for PATH lookup
 */
export function resolveNetcoredbgBinary(): string {
  const envPath = process.env['AGENTIC_NETCOREDBG_PATH'];
  if (envPath) {
    return envPath;
  }
  return NETCOREDBG_BINARY;
}

/** Well-known install locations for netcoredbg by platform. */
export function getCommonInstallPaths(): readonly string[] {
  const os = platform();

  if (os === 'win32') {
    const localAppData = process.env['LOCALAPPDATA'] ?? '';
    return localAppData
      ? [`${localAppData}\\netcoredbg\\netcoredbg.exe`]
      : [];
  }

  return [
    '/usr/local/bin/netcoredbg',
    '/usr/bin/netcoredbg',
  ];
}

/** Default configuration for the netcoredbg adapter. */
export const NETCOREDBG_DEFAULTS: AdapterConfig = {
  language: 'csharp',
  runtime: 'dotnet',
  args: [],
};

/** netcoredbg launch configuration fields sent via DAP. */
export interface NetcoredbgLaunchConfig {
  readonly type: typeof NETCOREDBG_TYPE;
  readonly request: 'launch';
  readonly program: string;
  readonly cwd: string;
  readonly args: readonly string[];
}

/** netcoredbg attach configuration fields sent via DAP. */
export interface NetcoredbgAttachConfig {
  readonly type: typeof NETCOREDBG_TYPE;
  readonly request: 'attach';
  readonly processId: number;
}

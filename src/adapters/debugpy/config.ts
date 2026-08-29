import { platform } from 'node:os';

import type { AdapterConfig } from '../../types/adapter.js';

/** debugpy DAP launch configuration type. */
export const DEBUGPY_TYPE = 'python' as const;

/** Default DAP port for debugpy attach sessions. */
export const DEBUGPY_DEFAULT_PORT = 5678;

/** Default host for debugpy attach sessions. */
export const DEBUGPY_DEFAULT_HOST = 'localhost';

/** Module path used to invoke debugpy as a DAP server. */
export const DEBUGPY_MODULE = 'debugpy.adapter' as const;

/**
 * Resolve the Python interpreter path using the following precedence:
 *
 * 1. `AGENTIC_PYTHON_PATH` environment variable
 * 2. `python3` on PATH (preferred on unix)
 * 3. `python` on PATH (fallback, required on Windows)
 */
export function resolvePythonBinary(): string {
  const envPath = process.env['AGENTIC_PYTHON_PATH'];
  if (envPath) {
    return envPath;
  }

  return platform() === 'win32' ? 'python' : 'python3';
}

/** Default configuration for the debugpy adapter. */
export const DEBUGPY_DEFAULTS: AdapterConfig = {
  language: 'python',
  runtime: 'python3',
  args: [],
};

/** debugpy launch configuration fields sent via DAP. */
export interface DebugpyLaunchConfig {
  readonly type: typeof DEBUGPY_TYPE;
  readonly request: 'launch';
  readonly program: string;
  readonly pythonPath: string;
  readonly cwd: string;
  readonly args: readonly string[];
}

/** debugpy attach configuration fields sent via DAP. */
export interface DebugpyAttachConfig {
  readonly type: typeof DEBUGPY_TYPE;
  readonly request: 'attach';
  readonly connect: {
    readonly host: string;
    readonly port: number;
  };
}

import { join } from 'node:path';

import type { AdapterConfig } from '../../types/adapter.js';
import { resolvePackageRoot } from '../package-root.js';

/**
 * Name of the clr-debug executable.
 *
 * The .exe is a .NET 8 framework-dependent binary that wraps
 * ICorDebug via the ClrDebug NuGet package.
 */
export const CLR_DEBUG_BINARY = 'clr-debug.exe';

/** Default configuration for the clr-debug adapter. */
export const CLR_DEBUG_DEFAULTS: AdapterConfig = {
  language: 'csharp',
  runtime: 'dotnet',
  args: [],
};

/**
 * Resolve the conventional local clr-debug binary path.
 *
 * The binary lives at `<project-root>/adapters/clr-debug/bin/publish/clr-debug.exe`
 * relative to the source tree.
 */
export function getBundledClrDebugPath(): string {
  return join(
    resolvePackageRoot(import.meta.url),
    'adapters',
    'clr-debug',
    'bin',
    'publish',
    CLR_DEBUG_BINARY,
  );
}

import { platform } from 'node:os';

import type { AdapterConfig } from '../../types/adapter.js';

/** vsdbg DAP type for .NET Core / .NET 5+ targets. */
export const VSDBG_TYPE_CORECLR = 'coreclr' as const;

/** vsdbg DAP type for .NET Framework targets. */
export const VSDBG_TYPE_CLR = 'clr' as const;

/** Valid vsdbg runtime type identifiers. */
export type VsdbgRuntimeType = typeof VSDBG_TYPE_CORECLR | typeof VSDBG_TYPE_CLR;

/** Binary name for the vsdbg executable. */
export const VSDBG_BINARY = platform() === 'win32' ? 'vsdbg.exe' : 'vsdbg';

/** Flag that tells vsdbg to speak DAP over stdio (same protocol as netcoredbg). */
export const VSDBG_INTERPRETER_FLAG = '--interpreter=vscode';

/** Default configuration for the vsdbg adapter. */
export const VSDBG_DEFAULTS: AdapterConfig = {
  language: 'csharp',
  runtime: 'dotnet',
  args: [],
};

/** Well-known install locations for vsdbg by platform. */
export function getVsdbgInstallPaths(): readonly string[] {
  const os = platform();
  const paths: string[] = [];

  if (os === 'win32') {
    // VS Code C# extension location
    const home = process.env['USERPROFILE'] ?? '';
    if (home) {
      // The C# extension puts vsdbg in various subdirectories
      paths.push(`${home}\\.vscode\\extensions\\ms-dotnettools.csharp-*\\.debugger\\x86_64\\vsdbg.exe`);
    }
    // VS Code extension managed debugger
    const localAppData = process.env['LOCALAPPDATA'] ?? '';
    if (localAppData) {
      paths.push(`${localAppData}\\vsdbg\\vsdbg.exe`);
    }
  } else {
    paths.push('/usr/local/vsdbg/vsdbg');
    paths.push(`${process.env['HOME'] ?? ''}/.vsdbg/vsdbg`);
  }

  return paths;
}

/** vsdbg launch configuration fields sent via DAP. */
export interface VsdbgLaunchConfig {
  readonly type: VsdbgRuntimeType;
  readonly request: 'launch';
  readonly program: string;
  readonly cwd: string;
  readonly args: readonly string[];
}

/** vsdbg attach configuration fields sent via DAP. */
export interface VsdbgAttachConfig {
  readonly type: VsdbgRuntimeType;
  readonly request: 'attach';
  readonly processId: number;
}

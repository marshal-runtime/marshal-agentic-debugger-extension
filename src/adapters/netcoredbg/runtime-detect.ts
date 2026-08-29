import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';

/** Result of a .NET runtime detection check. */
export interface RuntimeDetectionResult {
  /** Whether the process is using .NET Core / .NET 5+. */
  readonly isNetCore: boolean;
  /** Whether the process is using .NET Framework (CLR). */
  readonly isNetFramework: boolean;
  /** Human-readable description of the detected runtime. */
  readonly description: string;
}

/**
 * Detect whether a process is running on .NET Core or .NET Framework.
 *
 * Detection approach (Windows only):
 * 1. Check loaded modules for `coreclr.dll` (.NET Core) vs `clrjit.dll` without `coreclr.dll` (.NET Framework)
 * 2. Check for `<exe>.runtimeconfig.json` (Core) vs `<exe>.exe.config` (Framework) next to the binary
 *
 * On non-Windows platforms, assumes .NET Core (Framework is Windows-only).
 *
 * @param pid - The process ID to inspect.
 * @returns Detection result, or null if detection could not be performed.
 */
export function detectDotnetRuntime(pid: number): RuntimeDetectionResult | null {
  if (platform() !== 'win32') {
    // .NET Framework is Windows-only; on other platforms, assume Core
    return {
      isNetCore: true,
      isNetFramework: false,
      description: '.NET Core / .NET 5+ (non-Windows platform)',
    };
  }

  return detectViaModules(pid) ?? detectViaProcessPath(pid);
}

/** Detect runtime by checking loaded DLL modules via PowerShell. */
function detectViaModules(pid: number): RuntimeDetectionResult | null {
  try {
    const script = `
      try {
        $proc = Get-Process -Id ${pid} -ErrorAction Stop
        $modules = $proc.Modules | ForEach-Object { $_.ModuleName.ToLowerInvariant() }
        $hasCoreclr = $modules -contains 'coreclr.dll'
        $hasClrjit = $modules -contains 'clrjit.dll'
        $hasClr = $modules -contains 'clr.dll'
        Write-Output "$hasCoreclr|$hasClrjit|$hasClr"
      } catch {
        Write-Output "error|$($_.Exception.Message)"
      }
    `;

    const result = execSync(`powershell -NoProfile -NonInteractive -Command "${script.replace(/"/g, '\\"')}"`, {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (result.startsWith('error|')) {
      return null;
    }

    const [hasCoreclr, hasClrjit, hasClr] = result.split('|').map((v) => v === 'True');

    if (hasCoreclr) {
      return {
        isNetCore: true,
        isNetFramework: false,
        description: '.NET Core / .NET 5+',
      };
    }

    if (hasClr || hasClrjit) {
      return {
        isNetCore: false,
        isNetFramework: true,
        description: '.NET Framework (CLR)',
      };
    }

    return null;
  } catch {
    return null;
  }
}

/** Detect runtime by checking for config files next to the process executable. */
function detectViaProcessPath(pid: number): RuntimeDetectionResult | null {
  try {
    const result = execSync(
      `powershell -NoProfile -NonInteractive -Command "(Get-Process -Id ${pid}).Path"`,
      { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();

    if (!result) {
      return null;
    }

    const exePath = result;

    // .NET Core apps have <name>.runtimeconfig.json
    if (existsSync(`${exePath.replace(/\.exe$/i, '')}.runtimeconfig.json`)) {
      return {
        isNetCore: true,
        isNetFramework: false,
        description: '.NET Core / .NET 5+ (has runtimeconfig.json)',
      };
    }

    // .NET Framework apps have <name>.exe.config
    if (existsSync(`${exePath}.config`)) {
      return {
        isNetCore: false,
        isNetFramework: true,
        description: '.NET Framework (has .exe.config)',
      };
    }

    return null;
  } catch {
    return null;
  }
}

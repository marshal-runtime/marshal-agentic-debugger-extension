#!/usr/bin/env pwsh
# ==============================================================================
# Agentic Debugger — Windows Setup Script
#
# Downloads and installs all prerequisites, builds the project, and installs
# the CLI tool globally so it can be used as `agentic-debugger` from any terminal.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/setup-windows.ps1
#
# Prerequisites that will be installed if missing:
#   - Node.js >= 18 (via winget)
#   - Python 3.8+ (via winget)
#   - .NET SDK 8.0+ (via winget)
#   - debugpy (via pip)
#   - netcoredbg (from GitHub releases)
#   - js-debug (via npm)
# ==============================================================================

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# --- Colours for output -------------------------------------------------------
function Write-Step  { param([string]$msg) Write-Host "`n▶ $msg" -ForegroundColor Cyan }
function Write-OK    { param([string]$msg) Write-Host "  ✔ $msg" -ForegroundColor Green }
function Write-Skip  { param([string]$msg) Write-Host "  ⏭ $msg" -ForegroundColor Yellow }
function Write-Warn  { param([string]$msg) Write-Host "  ⚠ $msg" -ForegroundColor Yellow }
function Write-Fail  { param([string]$msg) Write-Host "  ✖ $msg" -ForegroundColor Red }

# --- Helpers -------------------------------------------------------------------
function Test-Command {
    param([string]$cmd)
    try { Get-Command $cmd -ErrorAction Stop | Out-Null; return $true }
    catch { return $false }
}

function Get-SemVer {
    param([string]$raw)
    if ($raw -match '(\d+\.\d+(\.\d+)?)') { return $Matches[1] }
    return $null
}

# --- Resolve repo root ---------------------------------------------------------
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (!(Test-Path (Join-Path $repoRoot "package.json"))) {
    # Fallback: script may be run from repo root directly
    $repoRoot = $PSScriptRoot | Split-Path -Parent
    if (!(Test-Path (Join-Path $repoRoot "package.json"))) {
        $repoRoot = Get-Location
    }
}
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Magenta
Write-Host "  Agentic Debugger — Windows Setup" -ForegroundColor Magenta
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Magenta
Write-Host "  Repo root: $repoRoot"

# ==============================================================================
# 1. Node.js
# ==============================================================================
Write-Step "Checking Node.js (>= 18)..."
if (Test-Command "node") {
    $nodeVersion = Get-SemVer (node --version 2>&1)
    $major = [int]($nodeVersion -split '\.')[0]
    if ($major -ge 18) {
        Write-OK "Node.js $nodeVersion found"
    } else {
        Write-Warn "Node.js $nodeVersion is too old (need >= 18). Attempting upgrade..."
        winget install --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    }
} else {
    Write-Warn "Node.js not found. Installing via winget..."
    winget install --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    if (Test-Command "node") {
        Write-OK "Node.js $(node --version) installed"
    } else {
        Write-Fail "Node.js installation failed. Install manually from https://nodejs.org/"
        Write-Fail "After installing, restart this script."
        exit 1
    }
}

# ==============================================================================
# 2. Python
# ==============================================================================
Write-Step "Checking Python (>= 3.8)..."
$pythonCmd = $null
foreach ($cmd in @("python3", "python")) {
    if (Test-Command $cmd) {
        $pyVer = Get-SemVer (& $cmd --version 2>&1)
        if ($pyVer) {
            $parts = $pyVer -split '\.'
            if ([int]$parts[0] -ge 3 -and [int]$parts[1] -ge 8) {
                $pythonCmd = $cmd
                Write-OK "Python $pyVer found ($cmd)"
                break
            }
        }
    }
}
if (!$pythonCmd) {
    Write-Warn "Python >= 3.8 not found. Installing via winget..."
    winget install --id Python.Python.3.12 --accept-package-agreements --accept-source-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    if (Test-Command "python") { $pythonCmd = "python" }
    elseif (Test-Command "python3") { $pythonCmd = "python3" }
    if ($pythonCmd) {
        Write-OK "Python $(& $pythonCmd --version 2>&1) installed"
    } else {
        Write-Warn "Python installation may require a terminal restart. Continuing..."
    }
}

# ==============================================================================
# 3. .NET SDK
# ==============================================================================
Write-Step "Checking .NET SDK (>= 8.0)..."
if (Test-Command "dotnet") {
    $dotnetVersion = Get-SemVer (dotnet --version 2>&1)
    $major = [int]($dotnetVersion -split '\.')[0]
    if ($major -ge 8) {
        Write-OK ".NET SDK $dotnetVersion found"
    } else {
        Write-Warn ".NET SDK $dotnetVersion is too old (need >= 8.0). Installing..."
        winget install --id Microsoft.DotNet.SDK.8 --accept-package-agreements --accept-source-agreements
    }
} else {
    Write-Warn ".NET SDK not found. Installing via winget..."
    winget install --id Microsoft.DotNet.SDK.8 --accept-package-agreements --accept-source-agreements
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    if (Test-Command "dotnet") {
        Write-OK ".NET SDK $(dotnet --version) installed"
    } else {
        Write-Warn ".NET SDK installation may require a terminal restart. Continuing..."
    }
}

# ==============================================================================
# 4. debugpy (Python debug adapter)
# ==============================================================================
Write-Step "Checking debugpy..."
if ($pythonCmd) {
    $hasDebugpy = & $pythonCmd -m debugpy --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-OK "debugpy found: $hasDebugpy"
    } else {
        Write-Warn "debugpy not found. Installing via pip..."
        & $pythonCmd -m pip install --user debugpy
        if ($LASTEXITCODE -eq 0) { Write-OK "debugpy installed" }
        else { Write-Warn "debugpy install failed — Python debugging will not be available" }
    }
} else {
    Write-Skip "Skipping debugpy (Python not available)"
}

# ==============================================================================
# 5. netcoredbg (.NET debug adapter)
# ==============================================================================
Write-Step "Checking netcoredbg..."
$netcoredbgDir = "$env:LOCALAPPDATA\netcoredbg"
$netcoredbgExe = "$netcoredbgDir\netcoredbg.exe"

if (Test-Command "netcoredbg") {
    Write-OK "netcoredbg found on PATH"
} elseif (Test-Path $netcoredbgExe) {
    Write-OK "netcoredbg found at $netcoredbgExe"
    # Ensure it's on PATH for this session
    if ($env:Path -notlike "*$netcoredbgDir*") {
        $env:Path = "$netcoredbgDir;$env:Path"
    }
} else {
    Write-Warn "netcoredbg not found. Downloading from GitHub releases..."
    $zipUrl = "https://github.com/Samsung/netcoredbg/releases/latest/download/netcoredbg-win64.zip"
    $zipPath = "$env:TEMP\netcoredbg-win64.zip"

    try {
        if (!(Test-Path $netcoredbgDir)) {
            New-Item -ItemType Directory -Path $netcoredbgDir -Force | Out-Null
        }
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
        Expand-Archive -Path $zipPath -DestinationPath $netcoredbgDir -Force
        Remove-Item $zipPath -ErrorAction SilentlyContinue

        # The zip may contain a nested netcoredbg/ folder — flatten if needed
        $nested = Join-Path $netcoredbgDir "netcoredbg\netcoredbg.exe"
        if ((Test-Path $nested) -and !(Test-Path $netcoredbgExe)) {
            Get-ChildItem (Join-Path $netcoredbgDir "netcoredbg") | Move-Item -Destination $netcoredbgDir -Force
            Remove-Item (Join-Path $netcoredbgDir "netcoredbg") -Recurse -ErrorAction SilentlyContinue
        }

        # Add to user PATH permanently
        $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
        if ($userPath -notlike "*$netcoredbgDir*") {
            [System.Environment]::SetEnvironmentVariable("Path", "$netcoredbgDir;$userPath", "User")
        }
        $env:Path = "$netcoredbgDir;$env:Path"

        if (Test-Path $netcoredbgExe) {
            $ver = & $netcoredbgExe --version 2>&1 | Select-Object -First 1
            Write-OK "netcoredbg installed: $ver"
        } else {
            Write-Fail "netcoredbg download succeeded but binary not found at $netcoredbgExe"
        }
    } catch {
        Write-Fail "Failed to download netcoredbg: $_"
        Write-Warn "Install manually from https://github.com/Samsung/netcoredbg/releases"
    }
}

# ==============================================================================
# 6. js-debug (JavaScript/TypeScript debug adapter)
# ==============================================================================
Write-Step "Checking js-debug (dapDebugServer.js)..."

# js-debug is automatically downloaded by the postinstall script.
# Check if it's already available (bundled or VS Code).
$jsDebugFound = $false

# Check bundled location (from postinstall)
$bundledJsDebug = Join-Path $repoRoot "adapters\js-debug\dapDebugServer.js"
if (Test-Path $bundledJsDebug) {
    Write-OK "js-debug found (bundled): $bundledJsDebug"
    $jsDebugFound = $true
}

# Check VS Code bundled location
if (!$jsDebugFound) {
    $vsCodeJsDebug = "$env:LOCALAPPDATA\Programs\Microsoft VS Code\resources\app\extensions\ms-vscode.js-debug\src\dapDebugServer.js"
    if (Test-Path $vsCodeJsDebug) {
        Write-OK "js-debug found (VS Code): $vsCodeJsDebug"
        $jsDebugFound = $true
    }
}

if (!$jsDebugFound) {
    Write-Warn "js-debug not found. It will be downloaded during 'npm install' (postinstall script)."
}

# ==============================================================================
# 7. Install npm dependencies & build the project
# ==============================================================================
Write-Step "Installing npm dependencies..."
Push-Location $repoRoot
try {
    npm install 2>&1 | Out-Null
    Write-OK "npm install complete"
} catch {
    Write-Fail "npm install failed: $_"
    exit 1
}

Write-Step "Building the project..."
try {
    npm run build 2>&1 | Out-Null
    Write-OK "Build complete"
} catch {
    Write-Fail "Build failed: $_"
    exit 1
}

# ==============================================================================
# 8. Install the CLI globally
# ==============================================================================
Write-Step "Installing agentic-debugger CLI globally..."
try {
    npm link 2>&1 | Out-Null
    Write-OK "agentic-debugger CLI linked globally"
} catch {
    Write-Warn "npm link failed, trying npm install -g..."
    npm install -g . 2>&1 | Out-Null
}

Pop-Location

# ==============================================================================
# 9. Verification
# ==============================================================================
Write-Step "Verifying installation..."

$checks = @(
    @{ Name = "agentic-debugger CLI"; Cmd = "agentic-debugger"; Args = @("--version") },
    @{ Name = "Node.js";              Cmd = "node";             Args = @("--version") },
    @{ Name = "npm";                  Cmd = "npm";              Args = @("--version") },
    @{ Name = "netcoredbg";           Cmd = "netcoredbg";       Args = @("--version") }
)

$allOk = $true
foreach ($check in $checks) {
    if (Test-Command $check.Cmd) {
        $ver = & $check.Cmd @($check.Args) 2>&1 | Select-Object -First 1
        Write-OK "$($check.Name): $ver"
    } else {
        Write-Warn "$($check.Name): not found on PATH"
        $allOk = $false
    }
}

# Python check
if ($pythonCmd -and (Test-Command $pythonCmd)) {
    $pyVer = & $pythonCmd --version 2>&1
    Write-OK "Python: $pyVer"
    $dbgpyVer = & $pythonCmd -m debugpy --version 2>&1
    if ($LASTEXITCODE -eq 0) { Write-OK "debugpy: $dbgpyVer" }
    else { Write-Warn "debugpy: not installed" }
} else {
    Write-Warn "Python: not found"
}

# .NET check
if (Test-Command "dotnet") {
    Write-OK ".NET SDK: $(dotnet --version)"
} else {
    Write-Warn ".NET SDK: not found"
}

# ==============================================================================
# Done
# ==============================================================================
Write-Host "`n═══════════════════════════════════════════════════════" -ForegroundColor Magenta
if ($allOk) {
    Write-Host "  ✔ Setup complete! Run 'agentic-debugger --help' to get started." -ForegroundColor Green
} else {
    Write-Host "  ⚠ Setup complete with warnings. Some adapters may not be available." -ForegroundColor Yellow
    Write-Host "    Restart your terminal to pick up PATH changes, then re-run this script." -ForegroundColor Yellow
}
Write-Host "═══════════════════════════════════════════════════════`n" -ForegroundColor Magenta

#!/usr/bin/env node
// ==============================================================================
// Agentic Debugger — Postinstall Script
//
// Downloads bundled debug adapters that cannot be obtained via npm:
//   1. js-debug DAP server  (from microsoft/vscode-js-debug GitHub releases)
//   2. vsdbg                (from Microsoft's CDN, .NET Framework + .NET Core)
//
// All downloads are optional — if they fail, a warning is printed and the tool
// falls back to finding adapters on the user's system at runtime.
// ==============================================================================

import { execSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, readdirSync, statSync } from 'node:fs';
import { get as httpsGet } from 'node:https';
import { get as httpGet } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, arch } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, '..');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** js-debug version to download (should match VS Code's bundled version). */
const JS_DEBUG_VERSION = '1.105.0';

/** GitHub release URL for the standalone js-debug DAP server tarball. */
const JS_DEBUG_TARBALL_URL =
  `https://github.com/microsoft/vscode-js-debug/releases/download/v${JS_DEBUG_VERSION}/js-debug-dap-v${JS_DEBUG_VERSION}.tar.gz`;

/** Directory where bundled js-debug files are stored. */
const JS_DEBUG_DIR = join(PACKAGE_ROOT, 'adapters', 'js-debug');

/** vsdbg install directory. */
const VSDBG_DIR = join(PACKAGE_ROOT, 'adapters', 'vsdbg');

/** vsdbg version (latest stable from Microsoft CDN). */
const VSDBG_VERSION = '18.0.10821.2';

/** Microsoft CDN base URL for vsdbg downloads. */
const VSDBG_CDN_BASE = 'https://vsdebugger-cyg0dxb6czfafzaz.b01.azurefd.net';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(msg) {
  console.log(`  [postinstall] ${msg}`);
}

function warn(msg) {
  console.warn(`  [postinstall] ⚠ ${msg}`);
}

/**
 * Follow redirects and download a URL to a file path.
 * Returns a promise that resolves when the file is written.
 */
function downloadFile(url, destPath, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) {
      return reject(new Error('Too many redirects'));
    }

    const getter = url.startsWith('https') ? httpsGet : httpGet;
    const req = getter(url, { headers: { 'User-Agent': 'agentic-debugger-postinstall' }, timeout: 60_000 }, (res) => {
      // Follow redirects (301, 302, 303, 307, 308)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.destroy();
        return downloadFile(res.headers.location, destPath, maxRedirects - 1).then(resolve, reject);
      }

      if (res.statusCode !== 200) {
        res.destroy();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }

      const stream = createWriteStream(destPath);
      res.pipe(stream);
      stream.on('finish', () => { stream.close(); resolve(); });
      stream.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Download timeout')); });
  });
}

// ---------------------------------------------------------------------------
// 1. js-debug DAP server
// ---------------------------------------------------------------------------

async function installJsDebug() {
  const dapServerPath = join(JS_DEBUG_DIR, 'dapDebugServer.js');

  if (existsSync(dapServerPath)) {
    log('js-debug DAP server already installed');
    return;
  }

  log(`Downloading js-debug DAP server v${JS_DEBUG_VERSION}...`);
  mkdirSync(JS_DEBUG_DIR, { recursive: true });

  const tarballPath = join(JS_DEBUG_DIR, 'js-debug-dap.tar.gz');

  try {
    await downloadFile(JS_DEBUG_TARBALL_URL, tarballPath);
    log('Extracting dapDebugServer.js...');

    // Extract only the files we need from the tarball
    // The tarball contains files under js-debug-dap/ or directly
    execSync(`tar -xzf "${tarballPath}" -C "${JS_DEBUG_DIR}"`, {
      stdio: 'pipe',
      timeout: 30_000,
    });

    // The tarball may nest files. Find dapDebugServer.js wherever it ends up.
    const findDap = findFile(JS_DEBUG_DIR, 'dapDebugServer.js');
    if (findDap && findDap !== dapServerPath) {
      // Move it to the expected location
      const content = readFileSync(findDap);
      writeFileSync(dapServerPath, content);
    }

    // Clean up the tarball
    try { execSync(`${platform() === 'win32' ? 'del' : 'rm'} "${tarballPath}"`, { stdio: 'pipe' }); } catch { /* ignore */ }

    if (existsSync(dapServerPath)) {
      const sizeKB = Math.round(readFileSync(dapServerPath).length / 1024);
      log(`js-debug DAP server installed (${sizeKB} KB)`);

      // dapDebugServer.js is a CommonJS bundle but the root package.json sets
      // "type": "module". We need a local package.json to force CJS mode.
      const cjsPkg = join(JS_DEBUG_DIR, 'package.json');
      if (!existsSync(cjsPkg)) {
        writeFileSync(cjsPkg, '{ "type": "commonjs" }\n');
        log('Created adapters/js-debug/package.json for CJS compatibility');
      }
    } else {
      warn('dapDebugServer.js not found after extraction');
    }
  } catch (err) {
    warn(`Failed to install js-debug: ${err.message}`);
    warn('JS/TS debugging will look for VS Code\'s bundled js-debug at runtime.');
    // Clean up partial downloads
    try { execSync(`${platform() === 'win32' ? 'del' : 'rm'} "${tarballPath}"`, { stdio: 'pipe' }); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// 2. vsdbg (.NET debugger — supports .NET Framework + .NET Core)
// ---------------------------------------------------------------------------

async function installVsdbg() {
  const os = platform();
  const cpuArch = arch();
  const binaryName = os === 'win32' ? 'vsdbg.exe' : 'vsdbg';
  const vsdbgBinary = join(VSDBG_DIR, binaryName);

  if (existsSync(vsdbgBinary)) {
    log('vsdbg already installed');
    return;
  }

  // Determine the runtime ID for the current platform
  let rid;
  if (os === 'win32') {
    rid = 'win7-x64';
  } else if (os === 'darwin') {
    rid = cpuArch === 'arm64' ? 'osx-arm64' : 'osx-x64';
  } else {
    rid = cpuArch === 'arm64' ? 'linux-arm64' : 'linux-x64';
  }

  // Construct the download URL (same pattern used by Microsoft's GetVsDbg.ps1)
  const versionDashed = VSDBG_VERSION.replaceAll('.', '-');
  const zipFileName = `vsdbg-${rid}.zip`;
  const downloadUrl = `${VSDBG_CDN_BASE}/vsdbg-${versionDashed}/${zipFileName}`;

  log(`Downloading vsdbg v${VSDBG_VERSION} (${rid})...`);
  mkdirSync(VSDBG_DIR, { recursive: true });

  const zipPath = join(VSDBG_DIR, zipFileName);

  try {
    await downloadFile(downloadUrl, zipPath);
    log('Extracting vsdbg...');

    // Extract the zip using tar (available on Windows 10+, Linux, macOS)
    execSync(`tar -xf "${zipPath}" -C "${VSDBG_DIR}"`, {
      stdio: 'pipe',
      timeout: 30_000,
    });

    // Clean up the zip
    try { execSync(`${os === 'win32' ? 'del' : 'rm'} "${zipPath}"`, { stdio: 'pipe' }); } catch { /* ignore */ }

    // Make binary executable on Unix
    if (os !== 'win32' && existsSync(vsdbgBinary)) {
      chmodSync(vsdbgBinary, 0o755);
    }

    if (existsSync(vsdbgBinary)) {
      log('vsdbg installed successfully');
    } else {
      warn('vsdbg binary not found after extraction');
    }
  } catch (err) {
    warn(`Failed to install vsdbg: ${err.message}`);
    warn('C#/.NET Framework debugging will require manual vsdbg installation.');
    warn('You can still debug .NET Core apps using netcoredbg.');
    // Clean up partial downloads
    try { execSync(`${os === 'win32' ? 'del' : 'rm'} "${zipPath}"`, { stdio: 'pipe' }); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Recursively find a file by name within a directory. */
function findFile(dir, name) {
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      try {
        const stat = statSync(full);
        if (stat.isFile() && entry === name) return full;
        if (stat.isDirectory()) {
          const found = findFile(full, name);
          if (found) return found;
        }
      } catch { /* skip inaccessible entries */ }
    }
  } catch { /* skip inaccessible dirs */ }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('');
  log('Setting up bundled debug adapters...');

  // Install js-debug (essential for JS/TS debugging).
  await installJsDebug();

  // vsdbg is intentionally NOT downloaded by default. Microsoft's license
  // check rejects all hosts that are not Microsoft VS Code, so vsdbg fails
  // immediately at configurationDone for every standalone-CLI user. The .NET
  // Core path now prefers netcoredbg (open-source, no DRM) and .NET Framework
  // uses the bundled clr-debug.exe. Users who specifically need vsdbg (e.g.,
  // because they have a licensed VS Code distribution at hand) can opt in by
  // setting AGENTIC_INSTALL_VSDBG=1 before `npm install`.
  if (process.env['AGENTIC_INSTALL_VSDBG'] === '1') {
    log('AGENTIC_INSTALL_VSDBG=1 set — downloading vsdbg as opt-in fallback');
    await installVsdbg();
  } else {
    log('Skipping vsdbg download (license-locked outside VS Code). Set AGENTIC_INSTALL_VSDBG=1 to opt in.');
  }

  console.log('');
}

main().catch((err) => {
  warn(`Postinstall failed: ${err.message}`);
  // Don't exit with error code — adapter downloads are optional
});

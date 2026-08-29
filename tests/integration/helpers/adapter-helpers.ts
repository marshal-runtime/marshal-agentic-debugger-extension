import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform } from 'node:os';

import { DapClient } from '../../../src/dap/client.js';
import { StdioTransport } from '../../../src/dap/transport/stdio.js';
import { DebugSession } from '../../../src/session/session.js';
import { SessionState } from '../../../src/types/session.js';
import { SessionEventType } from '../../../src/session/events.js';
import type { DapEvent } from '../../../src/dap/types.js';
import type { LanguageId } from '../../../src/types/adapter.js';

/** Well-known VS Code extension paths where js-debug may be bundled. */
const VSCODE_EXTENSION_RELATIVE_PATHS: readonly string[] = [
  'ms-vscode.js-debug/src/dapDebugServer.js',
  'ms-vscode.js-debug-nightly/src/dapDebugServer.js',
];

/** Adapter binary resolution map. */
const ADAPTER_BINARIES: Readonly<Record<string, string>> = {
  'js-debug': 'js-debug-dap',
  debugpy: 'debugpy',
  netcoredbg: 'netcoredbg',
};

/** Resources returned by createTestSession for lifecycle management. */
export interface TestSession {
  readonly transport: StdioTransport;
  readonly client: DapClient;
  readonly session: DebugSession;
  readonly threadId: number;
}

/** Options for creating a test session. */
export interface CreateTestSessionOptions {
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly stopOnEntry?: boolean;
  readonly language?: LanguageId;
}

/**
 * Check whether a debug adapter binary is available on this system.
 *
 * Uses the same 3-tier resolution as the production adapters:
 * 1. Environment variable (AGENTIC_JSDEBUG_PATH)
 * 2. Standalone binary on PATH
 * 3. VS Code bundled extension
 */
export function hasBinary(adapterName: string): boolean {
  try {
    resolveAdapterBinary(adapterName);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a fully wired debug session for integration testing.
 *
 * Spawns the adapter binary, initializes DAP, launches the program,
 * and waits for the session to be running (or stopped if stopOnEntry).
 *
 * @returns A TestSession with transport, client, and session ready for use.
 */
export async function createTestSession(
  adapterName: string,
  program: string,
  options?: CreateTestSessionOptions,
): Promise<TestSession> {
  const { command, args: binaryArgs } = resolveAdapterBinary(adapterName);
  const language = options?.language ?? 'javascript';
  const cwd = options?.cwd ?? process.cwd();

  const transport = new StdioTransport({
    command,
    args: binaryArgs,
    cwd,
  });

  await transport.connect();

  const client = new DapClient({
    transport,
    timeouts: { requestTimeoutMs: 10_000 },
  });

  const session = new DebugSession({
    config: {
      sessionId: `test-${Date.now()}`,
      program,
      language,
    },
    client,
  });

  await session.initialize();

  const launchArgs: Record<string, unknown> = {
    type: 'pwa-node',
    request: 'launch',
    program,
    cwd,
    runtimeExecutable: 'node',
    sourceMaps: false,
    stopOnEntry: options?.stopOnEntry ?? true,
    __sessionId: session.id,
  };

  if (options?.args) {
    launchArgs['args'] = options.args;
  }

  await session.launch(launchArgs);

  let threadId = 1;

  if (options?.stopOnEntry !== false) {
    const stoppedEvent = await waitForDapEvent(client, 'stopped', 10_000);
    const body = stoppedEvent.body as { threadId?: number } | undefined;
    threadId = body?.threadId ?? 1;
  }

  return { transport, client, session, threadId };
}

/**
 * Wait for the session to reach the "stopped" state.
 *
 * Listens for the DAP "stopped" event and returns the thread ID.
 */
export async function waitForStop(
  session: TestSession,
  timeoutMs = 10_000,
): Promise<{ threadId: number; reason: string }> {
  const event = await waitForDapEvent(session.client, 'stopped', timeoutMs);
  const body = event.body as { threadId?: number; reason?: string } | undefined;
  return {
    threadId: body?.threadId ?? session.threadId,
    reason: body?.reason ?? 'unknown',
  };
}

/**
 * Gracefully disconnect and clean up all test session resources.
 */
export async function cleanupSession(session: TestSession): Promise<void> {
  try {
    if (session.session.state !== SessionState.Terminated) {
      await Promise.race([
        session.client.disconnect({ terminateDebuggee: true }),
        new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
      ]);
    }
  } catch {
    // Adapter may already be gone
  }

  try {
    session.client.dispose();
  } catch {
    // Best-effort cleanup
  }

  try {
    session.transport.close();
  } catch {
    // Best-effort cleanup
  }
}

/** Wait for a specific DAP event with a timeout. */
function waitForDapEvent(
  client: DapClient,
  eventType: string,
  timeoutMs: number,
): Promise<DapEvent> {
  return new Promise<DapEvent>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for DAP event '${eventType}' after ${timeoutMs}ms`));
    }, timeoutMs);

    client.onEvent(eventType, (event: DapEvent) => {
      clearTimeout(timer);
      resolve(event);
    });
  });
}

/** Resolve the adapter binary command and arguments. */
function resolveAdapterBinary(adapterName: string): { command: string; args: readonly string[] } {
  if (adapterName === 'js-debug') {
    return resolveJsDebugBinary();
  }

  const binary = ADAPTER_BINARIES[adapterName];
  if (!binary) {
    throw new Error(`Unknown adapter: ${adapterName}`);
  }

  const resolved = findOnPath(binary);
  if (!resolved) {
    throw new Error(`Binary not found for adapter '${adapterName}': ${binary}`);
  }

  return { command: resolved, args: [] };
}

/** Resolve the js-debug binary using 3-tier resolution. */
function resolveJsDebugBinary(): { command: string; args: readonly string[] } {
  const envPath = process.env['AGENTIC_JSDEBUG_PATH'];
  if (envPath && existsSync(envPath)) {
    if (envPath.endsWith('.js')) {
      return { command: 'node', args: [envPath] };
    }
    return { command: envPath, args: [] };
  }

  const standalonePath = findOnPath('js-debug-dap');
  if (standalonePath) {
    return { command: standalonePath, args: [] };
  }

  const vscodePath = findVsCodeJsDebug();
  if (vscodePath) {
    return { command: 'node', args: [vscodePath] };
  }

  throw new Error(
    'js-debug binary not found. Install VS Code or set AGENTIC_JSDEBUG_PATH.',
  );
}

/** Attempt to find an executable on the system PATH. */
function findOnPath(binary: string): string | undefined {
  const command = platform() === 'win32' ? 'where' : 'which';
  try {
    const result = execFileSync(command, [binary], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const resolved = result.trim().split('\n')[0]?.trim();
    return resolved || undefined;
  } catch {
    return undefined;
  }
}

/** Find js-debug in VS Code extension directories. */
function findVsCodeJsDebug(): string | undefined {
  const home = homedir();
  const extensionsDir = join(home, '.vscode', 'extensions');

  for (const relPath of VSCODE_EXTENSION_RELATIVE_PATHS) {
    const fullPath = join(extensionsDir, relPath);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }

  return undefined;
}

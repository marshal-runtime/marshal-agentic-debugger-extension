import { describe, it, expect } from 'vitest';

import { NetcoredbgAdapter } from '../../../src/adapters/netcoredbg/index.js';
import type { AdapterConfig } from '../../../src/types/adapter.js';
import type { AttachOptions, LaunchOptions } from '../../../src/adapters/types.js';

/**
 * Regression coverage for commit 2efa1c9.
 *
 * Earlier, NetcoredbgAdapter built CLI args like
 *   ['--interpreter=vscode', '--type=coreclr', '--request=attach', '--processId=N']
 * which Samsung netcoredbg rejects with "Unknown option --type=coreclr" and exits
 * immediately at adapter startup. Those fields belong in the DAP request body,
 * not on argv. The only legal CLI arg is `--interpreter=vscode`.
 */
describe('NetcoredbgAdapter CLI args', () => {
  // Access the protected helpers via a typed cast. They are deliberately
  // protected on BaseAdapter but exposed for adapter subclasses to override.
  type ArgsExposed = {
    getAttachArgs(config: AdapterConfig, options: AttachOptions): readonly string[];
    getLaunchArgs(config: AdapterConfig, options: LaunchOptions): readonly string[];
  };

  const config: AdapterConfig = {
    sessionId: 'test-args',
    program: 'irrelevant.dll',
    language: 'csharp',
  };

  it('attach args are exactly ["--interpreter=vscode"] (no --type/--request/--processId on argv)', () => {
    const adapter = new NetcoredbgAdapter() as unknown as ArgsExposed;
    const args = adapter.getAttachArgs(config, { processId: 12345 });
    expect([...args]).toEqual(['--interpreter=vscode']);
  });

  it('launch args are exactly ["--interpreter=vscode"]', () => {
    const adapter = new NetcoredbgAdapter() as unknown as ArgsExposed;
    const args = adapter.getLaunchArgs(config, {
      program: 'test-app.dll',
      cwd: 'C:\\tmp',
      args: ['one', 'two'],
    });
    expect([...args]).toEqual(['--interpreter=vscode']);
  });

  it('attach without processId throws (caller contract)', () => {
    const adapter = new NetcoredbgAdapter() as unknown as ArgsExposed;
    expect(() =>
      adapter.getAttachArgs(config, {} as AttachOptions),
    ).toThrow(/processId is required/);
  });
});

import { describe, expect, it } from 'vitest';

import { DebugpyAdapter } from '../../../src/adapters/debugpy/index.js';
import type { AdapterConfig } from '../../../src/types/adapter.js';
import type { AttachOptions, LaunchOptions } from '../../../src/adapters/types.js';

class TestDebugpyAdapter extends DebugpyAdapter {
  launchArgs(config: AdapterConfig, options: LaunchOptions): readonly string[] {
    return this.getLaunchArgs(config, options);
  }

  attachArgs(config: AdapterConfig, options: AttachOptions): readonly string[] {
    return this.getAttachArgs(config, options);
  }
}

describe('DebugpyAdapter arguments', () => {
  const adapter = new TestDebugpyAdapter();

  it('starts the stdio adapter without passing DAP launch fields as CLI arguments', () => {
    expect(
      adapter.launchArgs(
        { language: 'python', args: ['--log-stderr'] },
        { program: 'Q:\\fixture\\app.py', args: ['one'], cwd: 'Q:\\fixture' },
      ),
    ).toEqual(['-m', 'debugpy.adapter', '--log-stderr']);
  });

  it('starts the stdio adapter without passing DAP attach fields as CLI arguments', () => {
    expect(adapter.attachArgs({ language: 'python' }, { host: '127.0.0.1', port: 5678 })).toEqual([
      '-m',
      'debugpy.adapter',
    ]);
  });
});

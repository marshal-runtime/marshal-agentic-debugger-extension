# Adapter Development Guide

This guide walks through creating a custom debug adapter for the agentic debugger. By the end, you will have a fully registered adapter that can launch and attach to debug sessions for a new language or runtime.

## Architecture Overview

The adapter system has four key components:

```
┌─────────────────────────────────────────────────────┐
│ AdapterRegistry                                     │
│   Maps AdapterType → IAdapter instances             │
│   Maps LanguageId → AdapterType                     │
├─────────────────────────────────────────────────────┤
│ IAdapter (interface)                                │
│   Defines: launch, attach, disconnect, terminate,   │
│            dispose, getCapabilities                 │
├─────────────────────────────────────────────────────┤
│ BaseAdapter (abstract class)                        │
│   Provides: spawn(), createClient(), dispose(),     │
│             process monitoring, crash detection     │
├─────────────────────────────────────────────────────┤
│ Your Adapter (e.g., GdbAdapter)                     │
│   Implements: getCommand(), getLaunchArgs(),         │
│               getAttachArgs(), launch(), attach(),  │
│               getCapabilities()                     │
└─────────────────────────────────────────────────────┘
```

**Key types** (defined in `src/types/adapter.ts`):

- `LanguageId` — `'javascript' | 'typescript' | 'python' | 'csharp'` (extend for your language)
- `AdapterType` — `'js-debug' | 'debugpy' | 'netcoredbg'` (extend for your adapter)
- `AdapterConfig` — `{ language, runtime?, args? }`

**Adapter interface** (defined in `src/adapters/types.ts`):

- `IAdapter` — the contract every adapter must satisfy
- `BaseAdapter` — abstract class providing process lifecycle, transport, and DAP client wiring
- `AdapterCapabilities` — declares which DAP features the adapter supports
- `LaunchOptions` — `{ program, args?, cwd?, env? }`
- `AttachOptions` — `{ port?, host?, processId? }`

## Step-by-Step: Create a New Adapter

This example creates an adapter for GDB (GNU Debugger) to debug C/C++ programs. Adapt the pattern for any DAP-compatible debug server.

### Step 1: Extend the Type Definitions

Add your language and adapter type to `src/types/adapter.ts`:

```typescript
// src/types/adapter.ts

export type LanguageId = 'javascript' | 'typescript' | 'python' | 'csharp' | 'cpp';

export type AdapterType = 'js-debug' | 'debugpy' | 'netcoredbg' | 'cppdbg';
```

### Step 2: Create the Adapter Directory

```
src/adapters/cppdbg/
├── config.ts    # Constants and default configuration
└── index.ts     # Adapter implementation
```

### Step 3: Write the Config File

```typescript
// src/adapters/cppdbg/config.ts
import type { AdapterConfig } from '../../types/adapter.js';

/** Binary name for the cppdbg DAP server. */
export const CPPDBG_BINARY = 'OpenDebugAD7';

/** Default DAP port for attach sessions. */
export const CPPDBG_DEFAULT_PORT = 4711;

/** Default configuration for the cppdbg adapter. */
export const CPPDBG_DEFAULTS: AdapterConfig = {
  language: 'cpp',
  runtime: 'gdb',
  args: [],
};
```

### Step 4: Implement the Adapter

```typescript
// src/adapters/cppdbg/index.ts
import type { AdapterConfig, LanguageId } from '../../types/adapter.js';
import type { AdapterCapabilities, AttachOptions, LaunchOptions } from '../types.js';
import { BaseAdapter } from '../base-adapter.js';
import { CPPDBG_BINARY, CPPDBG_DEFAULT_PORT } from './config.js';

/** Debug adapter for C/C++ using cppdbg (OpenDebugAD7). */
export class CppDbgAdapter extends BaseAdapter {
  readonly type = 'cppdbg' as const;
  readonly languages: readonly LanguageId[] = ['cpp'];

  protected override getCommand(): string {
    const envPath = process.env['AGENTIC_CPPDBG_PATH'];
    if (envPath) {
      return envPath;
    }
    return CPPDBG_BINARY;
  }

  protected override getLaunchArgs(
    config: AdapterConfig,
    options: LaunchOptions,
  ): readonly string[] {
    return [
      '--interpreter=mi',
      `--program=${options.program}`,
      `--cwd=${options.cwd ?? process.cwd()}`,
      ...(options.args ?? []).map((arg) => `--arg=${arg}`),
      ...(config.args ?? []),
    ];
  }

  protected override getAttachArgs(
    config: AdapterConfig,
    options: AttachOptions,
  ): readonly string[] {
    const port = options.port ?? CPPDBG_DEFAULT_PORT;
    return [
      `--port=${port}`,
      `--host=${options.host ?? 'localhost'}`,
      ...(config.args ?? []),
    ];
  }

  override async launch(
    config: AdapterConfig,
    options: LaunchOptions,
  ): Promise<void> {
    const args = this.getLaunchArgs(config, options);
    await this.spawn(args, options.cwd);
    this.createClient();

    this.logger.info('cppdbg launch session started', {
      program: options.program,
      cwd: options.cwd,
    });
  }

  override async attach(
    config: AdapterConfig,
    options: AttachOptions,
  ): Promise<void> {
    const args = this.getAttachArgs(config, options);
    await this.spawn(args);
    this.createClient();

    this.logger.info('cppdbg attach session started', {
      port: options.port ?? CPPDBG_DEFAULT_PORT,
    });
  }

  override getCapabilities(): AdapterCapabilities {
    return {
      supportsConditionalBreakpoints: true,
      supportsFunctionBreakpoints: true,
      supportsEvaluateForHovers: true,
      supportsSetVariable: true,
      supportsExceptionInfoRequest: false,
      supportsTerminateRequest: true,
      supportsConfigurationDoneRequest: true,
      supportsDataBreakpoints: true,
    };
  }
}
```

### Step 5: Register the Adapter

Update the language-to-adapter mapping in `src/adapters/registry.ts`:

```typescript
const LANGUAGE_ADAPTER_MAP: Readonly<Record<LanguageId, AdapterType>> = {
  typescript: 'js-debug',
  javascript: 'js-debug',
  python: 'debugpy',
  csharp: 'netcoredbg',
  cpp: 'cppdbg',          // Add your mapping
};
```

Register the adapter instance in `src/adapters/index.ts`:

```typescript
import { CppDbgAdapter } from './cppdbg/index.js';

export function createAdapterManager(): AdapterRegistry {
  const registry = new AdapterRegistry();
  registry.register(new JsDebugAdapter());
  registry.register(new DebugpyAdapter());
  registry.register(new NetCoreDbgAdapter());
  registry.register(new CppDbgAdapter());  // Add your adapter
  return registry;
}
```

### Step 6: Add Language Detection

Update the file extension map in `src/adapters/detector.ts`:

```typescript
const EXTENSION_MAP = new Map<string, LanguageId>([
  // ... existing entries ...
  ['.c', 'cpp'],
  ['.cpp', 'cpp'],
  ['.cc', 'cpp'],
  ['.h', 'cpp'],
  ['.hpp', 'cpp'],
]);
```

And add project file detection:

```typescript
const PROJECT_FILE_PATTERNS: ReadonlyArray<{ pattern: string | RegExp; language: LanguageId }> = [
  // ... existing entries ...
  { pattern: 'CMakeLists.txt', language: 'cpp' },
  { pattern: 'Makefile', language: 'cpp' },
];
```

## Testing Your Adapter

### Unit Tests

Create `tests/unit/adapters/cppdbg.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { CppDbgAdapter } from '../../../src/adapters/cppdbg/index.js';

describe('CppDbgAdapter', () => {
  it('should have correct type and languages', () => {
    const adapter = new CppDbgAdapter();
    expect(adapter.type).toBe('cppdbg');
    expect(adapter.languages).toEqual(['cpp']);
  });

  it('should return expected capabilities', () => {
    const adapter = new CppDbgAdapter();
    const caps = adapter.getCapabilities();
    expect(caps.supportsConditionalBreakpoints).toBe(true);
    expect(caps.supportsTerminateRequest).toBe(true);
  });
});
```

### Integration Tests

Create `tests/integration/cppdbg.integration.test.ts` with a simple C program as the test target. See `tests/integration/helpers/test-programs/` for examples of test programs used by existing adapters.

### Manual Verification

```bash
# Build the project
npm run build

# Test launch
agentic-debugger launch --program ./test.cpp --language cpp

# Test via MCP
agentic-debugger serve --transport stdio
# Then send launch_debug tool call with language: "cpp"
```

## Reference: Existing Adapters

Study these existing implementations as references:

| Adapter | Directory | Languages | Binary |
|---------|-----------|-----------|--------|
| js-debug | `src/adapters/js-debug/` | JavaScript, TypeScript | `js-debug-dap` |
| debugpy | `src/adapters/debugpy/` | Python | `debugpy` (pip) |
| netcoredbg | `src/adapters/netcoredbg/` | C# | `netcoredbg` |

Each adapter follows the same pattern:
1. `config.ts` — binary name, defaults, DAP-specific types
2. `index.ts` — extends `BaseAdapter`, implements `launch()`, `attach()`, `getCapabilities()`

## Checklist

Before submitting your adapter:

- [ ] Type definitions updated (`LanguageId`, `AdapterType`)
- [ ] Config file created with binary name and defaults
- [ ] Adapter class extends `BaseAdapter` and implements all abstract methods
- [ ] `getCapabilities()` accurately reflects the DAP server's capabilities
- [ ] Adapter registered in `AdapterRegistry` and `createAdapterManager()`
- [ ] Language detection updated in `detector.ts`
- [ ] Unit tests pass
- [ ] Integration test with a real debug target works
- [ ] Binary resolution handles PATH lookup and environment variable override

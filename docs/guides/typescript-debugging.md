# TypeScript & JavaScript Debugging Guide

Debugging TypeScript and JavaScript applications with `agentic-debugger` using the **js-debug** adapter. This guide covers installation, source map handling, async debugging, and Node.js-specific workflows.

## Prerequisites

| Requirement | Minimum Version | Notes |
|-------------|-----------------|-------|
| Node.js | 18+ | Required for the debuggee and the debugger itself |
| js-debug | latest | Standalone DAP server or VS Code bundled |
| TypeScript | 4.7+ | Only needed when debugging `.ts` files |

## Installing js-debug

The `agentic-debugger` uses the `js-debug` DAP server (type `pwa-node`) to debug JavaScript and TypeScript. There are several ways to obtain it.

### Standalone binary

The standalone binary is called `js-debug-dap`. Install it globally:

```bash
npm install -g @vscode/js-debug
```

Verify it is on your PATH:

```bash
js-debug-dap --help
```

### VS Code bundled extension

If you have VS Code installed, `js-debug` is bundled as the `ms-vscode.js-debug` extension. The adapter auto-detects it at these locations:

| Platform | Path |
|----------|------|
| All | `.vscode/extensions/ms-vscode.js-debug/src/dapDebugServer.js` |
| All | `.vscode/extensions/ms-vscode.js-debug-nightly/src/dapDebugServer.js` |

You can also run the bundled server directly:

```bash
node /path/to/.vscode/extensions/ms-vscode.js-debug/src/dapDebugServer.js 0
```

### Platform notes

| Platform | Default Node.js location | Notes |
|----------|--------------------------|-------|
| Windows | `%PROGRAMFILES%\nodejs\node.exe` | Use backslashes in paths or quote forward slashes |
| macOS | `/usr/local/bin/node` or via nvm | Ensure correct Node version is active |
| Linux | `/usr/bin/node` or via nvm/fnm | Same as macOS; check `which node` |

## Launching a Debug Session

### CLI

Debug a JavaScript file:

```bash
agentic-debugger launch app.js
```

Debug a TypeScript file (requires compilation or `ts-node`):

```bash
agentic-debugger launch dist/app.js
```

Pass arguments to the debuggee:

```bash
agentic-debugger launch app.js -- --port 3000 --verbose
```

Stop on the first line:

```bash
agentic-debugger launch app.js --stop-on-entry
```

### MCP tool

```json
{
  "tool": "launch_debug",
  "arguments": {
    "program": "dist/app.js",
    "language": "javascript",
    "args": ["--port", "3000"],
    "stopOnEntry": true
  }
}
```

The `language` field accepts `"javascript"` or `"typescript"`. When omitted, the adapter auto-detects from the file extension.

## Attaching to a Running Process

Start your Node.js process with the inspect flag:

```bash
node --inspect=9229 app.js
```

### CLI

```bash
agentic-debugger attach --language javascript --port 9229
```

### MCP tool

```json
{
  "tool": "attach_debug",
  "arguments": {
    "language": "javascript",
    "host": "localhost",
    "port": 9229
  }
}
```

The default attach port for js-debug is **9229**.

## Source Map Handling

Source maps are critical when debugging TypeScript or transpiled JavaScript. The js-debug adapter sends `sourceMaps: true` by default.

### How source maps work with breakpoints

1. You set a breakpoint on a `.ts` file at line 25.
2. The adapter resolves the corresponding `.js` line via the source map.
3. The DAP server sets the breakpoint on the generated JavaScript.
4. When hit, the adapter maps back to the original TypeScript location.

### TypeScript compilation for debugging

Ensure your `tsconfig.json` has source maps enabled:

```json
{
  "compilerOptions": {
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

Compile before debugging:

```bash
npx tsc
agentic-debugger launch dist/app.js
```

### Source map resolution

The js-debug adapter uses `resolveSourceMapLocations` to control which directories are searched for source maps. The default covers the workspace and `node_modules`. If breakpoints are not binding, check that:

1. The `.js.map` file exists alongside the `.js` file.
2. The `sources` field inside the `.map` file points to the correct `.ts` path.
3. The `sourceRoot` in `tsconfig.json` is correct (or omitted).

### Inline source maps

For tools like `esbuild` or `tsx` that embed source maps, ensure your bundler emits inline maps:

```bash
esbuild src/app.ts --bundle --sourcemap=inline --outfile=dist/app.js
```

### Setting a breakpoint in TypeScript

#### CLI

```bash
agentic-debugger breakpoint set --file src/app.ts --line 25 --session <sessionId>
```

#### MCP tool

```json
{
  "tool": "set_breakpoint",
  "arguments": {
    "sessionId": "<sessionId>",
    "file": "src/app.ts",
    "line": 25
  }
}
```

> **Tip:** Always use the original `.ts` path when setting breakpoints, not the compiled `.js` path. The adapter handles the mapping automatically.

## Async Debugging

JavaScript's event-driven model and `async`/`await` patterns require specific debugging techniques.

### Stepping through async/await

When stopped at an `await` expression, use **step over** to skip to the next statement after the `await` resolves:

#### CLI

```bash
agentic-debugger step over --session <sessionId>
```

#### MCP tool

```json
{
  "tool": "step_over",
  "arguments": {
    "sessionId": "<sessionId>"
  }
}
```

Using **step into** on an `await` enters the awaited function body.

### Async stack traces

js-debug captures async call stacks, showing the full chain of `await` calls. Inspect the call stack to see both the synchronous and asynchronous frames:

#### CLI

```bash
agentic-debugger callstack --session <sessionId> --thread 1
```

#### MCP tool

```json
{
  "tool": "get_call_stack",
  "arguments": {
    "sessionId": "<sessionId>",
    "threadId": 1
  }
}
```

Async frames appear below a separator labeled `async` in the call stack.

### Promise debugging

To catch unhandled promise rejections, set exception breakpoints:

#### CLI

```bash
agentic-debugger exception-breakpoints --session <sessionId> --filters uncaught
```

#### MCP tool

```json
{
  "tool": "set_exception_breakpoints",
  "arguments": {
    "sessionId": "<sessionId>",
    "filters": ["uncaught"]
  }
}
```

To break on all exceptions (caught and uncaught):

```json
{
  "tool": "set_exception_breakpoints",
  "arguments": {
    "sessionId": "<sessionId>",
    "filters": ["all"]
  }
}
```

### Event loop inspection

Evaluate the state of pending timers and I/O handles:

```bash
agentic-debugger evaluate --session <sessionId> --expression "process._getActiveHandles().length"
```

## Node.js Specifics

### Module resolution: CommonJS vs ESM

| Module system | File extension | Debug notes |
|---------------|----------------|-------------|
| CommonJS | `.js`, `.cjs` | `require()` calls are synchronous; step into works naturally |
| ESM | `.mjs`, `.js` (with `"type": "module"`) | Dynamic `import()` is async; use step over at `await import()` |

When debugging ESM modules, ensure your `package.json` has `"type": "module"` or use `.mjs` extensions.

### Native addons

Native C++ addons (`.node` files) cannot be stepped into. The debugger treats them as opaque function calls. Set breakpoints before and after native calls to inspect inputs and outputs.

### Environment variables

Inspect environment variables at a breakpoint:

```bash
agentic-debugger evaluate --session <sessionId> --expression "process.env.NODE_ENV"
```

### Worker threads

Node.js worker threads run in separate V8 isolates. Each worker appears as a separate thread in the threads list:

```bash
agentic-debugger threads --session <sessionId>
```

Set breakpoints in worker files the same way as the main file. The adapter maps breakpoints to the correct thread.

### Child processes

When using `child_process.fork()`, the child process does not automatically attach. Start the child with `--inspect` to allow separate attachment:

```javascript
const child = fork('./worker.js', [], { execArgv: ['--inspect=9230'] });
```

Then attach a second session:

```bash
agentic-debugger attach --language javascript --port 9230
```

## Inspecting Variables

### View local variables

#### CLI

```bash
agentic-debugger variables --session <sessionId> --reference <variablesReference>
```

#### MCP tool

```json
{
  "tool": "get_variables",
  "arguments": {
    "sessionId": "<sessionId>",
    "variablesReference": 1,
    "depth": 2
  }
}
```

### Evaluate expressions

#### CLI

```bash
agentic-debugger evaluate --session <sessionId> --expression "users.filter(u => u.active)"
```

#### MCP tool

```json
{
  "tool": "evaluate",
  "arguments": {
    "sessionId": "<sessionId>",
    "expression": "users.filter(u => u.active)",
    "context": "repl"
  }
}
```

### Watch expressions

```bash
agentic-debugger watch --session <sessionId> --action add --expression "request.headers"
agentic-debugger watch --session <sessionId> --action evaluate
```

## Adapter Configuration Reference

The js-debug adapter uses DAP type `pwa-node`. Key configuration fields:

### Launch configuration

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"pwa-node"` | Adapter type (set automatically) |
| `request` | `"launch"` | Launch mode |
| `program` | `string` | Path to the entry file |
| `cwd` | `string` | Working directory |
| `args` | `string[]` | Arguments for the debuggee |
| `runtimeExecutable` | `string` | Node.js binary path |
| `sourceMaps` | `boolean` | Enable source map support (default: `true`) |
| `resolveSourceMapLocations` | `string[]` | Glob patterns for source map search |

### Attach configuration

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"pwa-node"` | Adapter type (set automatically) |
| `request` | `"attach"` | Attach mode |
| `port` | `number` | Debug port (default: `9229`) |
| `host` | `string` | Debug host |
| `sourceMaps` | `boolean` | Enable source map support |
| `resolveSourceMapLocations` | `string[]` | Glob patterns for source map search |

## Common Pitfalls and Solutions

### Breakpoints not binding in TypeScript

**Symptom:** Breakpoints set in `.ts` files show as unverified.

**Causes and fixes:**

1. **Missing source maps** — Run `npx tsc` with `"sourceMap": true` in `tsconfig.json`.
2. **Stale build output** — Delete `dist/` and recompile.
3. **Source map path mismatch** — Check that `sources` in the `.map` file resolves to the actual `.ts` path.
4. **Bundler stripping maps** — Configure your bundler (`webpack`, `esbuild`, `rollup`) to emit source maps.

### Source map mismatches after editing

**Symptom:** Breakpoints hit on the wrong line.

**Fix:** Recompile the project before launching a new debug session. Source maps are generated at compile time and become stale when source files change.

### `Cannot find module` errors

**Symptom:** Debug session fails to start with a module resolution error.

**Fixes:**

1. Ensure `cwd` is set to the project root.
2. Run `npm install` to restore dependencies.
3. For TypeScript path aliases (`paths` in `tsconfig.json`), use `tsconfig-paths` or ensure your bundler resolves them.

### Debugging transpiled code without maps

**Symptom:** Breakpoints only work in `.js` files, not `.ts` files.

**Fix:** This means source maps are missing. Either enable `sourceMap` in `tsconfig.json` or use `tsx` / `ts-node` which handle compilation transparently:

```bash
agentic-debugger launch --runtime-executable npx -- tsx src/app.ts
```

### Worker threads not appearing

**Symptom:** Worker threads are running but not visible in the debugger.

**Fix:** js-debug auto-attaches to worker threads by default. If workers don't appear, ensure you are using Node.js 12.x+ and that the workers are created with `new Worker()` from the `worker_threads` module.

### Port conflicts on attach

**Symptom:** `EADDRINUSE` when starting `--inspect`.

**Fix:** Choose a different port: `node --inspect=9230 app.js`. Each concurrent debug target needs its own port.

### Hanging on async operations

**Symptom:** Stepping over an `await` never returns.

**Possible causes:**

1. The awaited promise never resolves (deadlock or missing callback).
2. An unhandled rejection is swallowed silently.

**Diagnosis:** Set exception breakpoints for `uncaught` to catch silent failures. Evaluate `process._getActiveHandles()` and `process._getActiveRequests()` to inspect pending I/O.

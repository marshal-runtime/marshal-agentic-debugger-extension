# Agentic Debugger — CLI Skill Guide

How to use the `agentic-debugger` command-line tool and MCP server effectively. This guide covers every command, flag, and workflow pattern an AI coding agent (or human) needs to master the debugger.

---

## Overview

`agentic-debugger` is a CLI tool **and** MCP server that provides programmatic access to interactive debugging via the Debug Adapter Protocol (DAP). It supports **JavaScript/TypeScript**, **Python**, and **C#/.NET**.

There are two modes of operation:

| Mode | When to use | How to invoke |
|------|-------------|---------------|
| **CLI** | Direct terminal use, scripting, CI pipelines | `agentic-debugger <command> [options]` |
| **MCP Server** | AI agent integration (Copilot, Roo Code, Cline, Cursor) | `agentic-debugger serve --transport stdio` |

All CLI output is **structured JSON**, making it ideal for machine consumption.

---

## Installation

```bash
# Install globally from npm
npm install -g @marshal/agentic-debugger-extension

# Or run from source
git clone <repo-url> && cd marshal-agentic-debugger-extension
npm install && npm run build && npm link
```

Verify:

```bash
agentic-debugger --version
```

### Debug Adapter Requirements

Each language needs its own DAP server. Normal package installation does not download adapters. From a source checkout, run `AGENTIC_INSTALL_VSDBG=1 npm run provision:adapters` for js-debug and vsdbg; for a global installation, run `AGENTIC_INSTALL_VSDBG=1 npm explore -g @marshal/agentic-debugger-extension -- npm run provision:adapters`.

| Language | Preferred adapter | Auto-installed? | Manual install |
|----------|-------------------|:---:|------------------|
| JavaScript / TypeScript | js-debug (pwa-node) | ❌ | Run `npm run provision:adapters`, use VS Code's copy, or set `AGENTIC_JSDEBUG_PATH` to `dapDebugServer.js` |
| C# / .NET Core / .NET 5+ | **netcoredbg** | ❌ | Download from [GitHub](https://github.com/Samsung/netcoredbg/releases) and put on PATH or set `AGENTIC_NETCOREDBG_PATH` |
| C# / .NET Framework 4.x | clr-debug (Windows only) | ❌ | Build locally or set `AGENTIC_CLR_DEBUG_PATH` |
| C# / .NET Core (fallback) | vsdbg | ❌ | Run `AGENTIC_INSTALL_VSDBG=1 npm run provision:adapters` or set `AGENTIC_VSDBG_PATH` to `vsdbg.exe` |
| Python | debugpy | ❌ | `python -m pip install debugpy` |

**C# adapter search order: netcoredbg → vsdbg → clr-debug.**

* netcoredbg is preferred because it's open-source and works outside VS Code.
* vsdbg is a fallback — Microsoft's license check rejects all hosts that aren't Microsoft VS Code, so it almost always fails at `configurationDone` with a license error. The CLI silently falls back to the next adapter when this happens. Set `AGENTIC_INSTALL_VSDBG=1` when running the provisioning command, or point `AGENTIC_VSDBG_PATH` at an existing install.
* clr-debug is the only working option for .NET Framework 4.x (ICorDebug). Use `--type clr` to force it.

**Browser/CDP attach (`--type chrome|msedge`) is not currently supported in the standalone CLI.** js-debug's standalone `dapDebugServer.js` requires VS Code's multi-session infrastructure to bind to Chrome/Edge/WebView2 targets. Tracked as bug 4. For Node.js, use V8 inspector attach (see `attach` below).

You can also use the setup scripts (`scripts/setup-windows.ps1` or `scripts/setup-linux.sh`) to install everything.

---

## Global Options

These flags apply to every command:

| Flag | Description |
|------|-------------|
| `-s, --session <id>` | Target a specific debug session by ID |
| `--verbose` | Output DAP protocol messages to stderr |
| `--pretty` | Pretty-print JSON output |
| `--version` | Print version and exit |
| `--help` | Show help for any command |

---

## Commands Reference

### Session Lifecycle

#### `launch` — Start a debug session

```bash
agentic-debugger launch <program> [options]
```

| Option | Description |
|--------|-------------|
| `--language <lang>` | Force language: `typescript`, `javascript`, `python`, `csharp` (auto-detected from extension if omitted) |
| `--args <args...>` | Arguments passed to the debuggee |
| `--cwd <dir>` | Working directory for the debuggee |
| `--env <KEY=VALUE...>` | Environment variables for the debuggee |
| `--stop-on-entry` | Break on the first executable line |

**Examples:**

```bash
# Auto-detect language from file extension
agentic-debugger launch ./src/app.ts

# Explicit language + arguments
agentic-debugger launch ./app.py --language python --args --port 8080

# C# DLL with stop-on-entry
agentic-debugger launch ./bin/Debug/net8.0/MyApp.dll --language csharp --stop-on-entry

# Set environment variables
agentic-debugger launch ./server.js --env NODE_ENV=development DEBUG=true
```

The response includes the `sessionId` you'll use for all subsequent commands:

```json
{
  "success": true,
  "command": "launch",
  "data": {
    "sessionId": "sess-abc123",
    "status": "running"
  }
}
```

---

#### `attach` — Connect to a running process

```bash
agentic-debugger attach [options]
```

| Option | Description |
|--------|-------------|
| `--language <lang>` | Programming language (required) |
| `--address <host:port>` | Host and port to connect to |
| `--pid <pid>` | Process ID to attach to |
| `--type <type>` | Debug target type: `node` (V8 inspector, default), `clr` (.NET Framework 4.x via clr-debug). `chrome` / `msedge` (CDP) are NOT currently supported in standalone CLI — tracked as bug 4 |

**Examples:**

```bash
# Attach to Node.js inspect port (V8 inspector — default)
agentic-debugger attach --address localhost:9229 --language typescript

# Attach to a C# / .NET Core or .NET 5+ process by PID (uses netcoredbg)
agentic-debugger attach --language csharp --pid 12345

# Attach to a C# / .NET Framework 4.x process (Windows; uses clr-debug)
agentic-debugger attach --language csharp --pid 12345 --type clr

# Attach to a Python process by PID
agentic-debugger attach --pid 12345 --language python
```

> **Note:** Either `--address` or `--pid` must be provided. C# requires `--pid` (none of the .NET adapters support `--address`).
>
> **Browser/CDP attach (`--type chrome|msedge`) is NOT currently supported in standalone CLI.** js-debug's `dapDebugServer.js` requires VS Code's multi-session infrastructure to bind to browser targets. Tracked as bug 4. For Node.js, use V8 inspector attach with `--inspect-brk=PORT` instead.

---

#### `disconnect` — End a debug session

```bash
agentic-debugger disconnect --session <id> [--terminate]
```

| Option | Description |
|--------|-------------|
| `--terminate` | Also kill the debuggee process (default: detach only) |

---

#### `terminate` — Force-terminate the debuggee

```bash
agentic-debugger terminate --session <id>
```

---

### Breakpoints

#### `breakpoint set` — Set a breakpoint

```bash
agentic-debugger breakpoint set [<file:line>] [options] [--session <id>]
```

| Option | Description |
|--------|-------------|
| `--file <path>` | File path (alternative to positional `file:line`) |
| `--line <number>` | Line number (used with `--file`) |
| `--condition <expr>` | Only break when expression evaluates to `true` |
| `--hit-condition <expr>` | Break after N hits (e.g., `>= 5`, `% 10`) |
| `--log-message <msg>` | Log a message instead of breaking (logpoint); use `{expr}` for interpolation |
| `--function <name>` | Set a function breakpoint instead of a line breakpoint |

> **Auto-session:** If `-s` / `--session` is omitted, the most recently attached/launched session is used automatically.

**Examples:**

```bash
# Simple line breakpoint (positional file:line)
agentic-debugger breakpoint set src/app.ts:42 --session sess-1

# Using --file and --line options (equivalent to above)
agentic-debugger breakpoint set --file src/app.ts --line 42

# Conditional breakpoint
agentic-debugger breakpoint set src/handler.ts:100 --condition "status === 500" --session sess-1

# Hit count breakpoint
agentic-debugger breakpoint set src/loop.py:15 --hit-condition ">= 100" --session sess-1

# Logpoint (logs without stopping)
agentic-debugger breakpoint set src/api.ts:55 --log-message "Request: {req.method} {req.url}" --session sess-1

# Function breakpoint
agentic-debugger breakpoint set --function processOrder --session sess-1
```

---

#### `breakpoint remove` — Remove breakpoints

```bash
agentic-debugger breakpoint remove <file:line> --session <id>
agentic-debugger breakpoint remove --all --session <id>
```

---

#### `breakpoint list` — List all breakpoints

```bash
agentic-debugger breakpoint list [--session <id>]
```

> **Auto-session & cross-process:** If `--session` is omitted, the most recent session is used. Breakpoint state is persisted to disk (`~/.agentic-debugger/breakpoints/`), so `breakpoint list` works even from a different terminal process than the one that ran `attach`.

---

#### `exception-breakpoints` — Configure exception breakpoints

```bash
agentic-debugger exception-breakpoints set --filter <filter> --session <id>
```

| Filter | Behaviour |
|--------|-----------|
| `all` | Break on all thrown exceptions |
| `caught` | Break only on caught exceptions |
| `uncaught` | Break only on uncaught exceptions |

**Example:**

```bash
# Break on uncaught exceptions only
agentic-debugger exception-breakpoints set --filter uncaught --session sess-1
```

---

### Execution Control

#### `continue` — Resume execution

```bash
agentic-debugger continue --session <id> [--thread <tid>]
```

---

#### `step` — Step through code

```bash
agentic-debugger step <direction> --session <id> [--thread-id <tid>]
```

| Direction | Description |
|-----------|-------------|
| `over` | Execute the current line and stop at the next line |
| `into` | Step into a function call |
| `out` | Step out of the current function |
| `restart-frame` | Restart the current stack frame (with `--frame-id`) |

**Examples:**

```bash
agentic-debugger step over --session sess-1
agentic-debugger step into --session sess-1
agentic-debugger step out --session sess-1
agentic-debugger step restart-frame --frame-id 0 --session sess-1
```

---

#### `pause` — Pause a running program

```bash
agentic-debugger pause --session <id> [--thread <tid>]
```

---

#### `set-next-statement` — Jump execution to a different line

```bash
agentic-debugger set-next-statement <file:line> --session <id> [--thread-id <tid>]
```

> **Note:** Not all adapters support this. The command will return an error if the capability is unavailable.

---

### Inspection

#### `variables` — Inspect variables

```bash
agentic-debugger variables --session <id> [options]
```

| Option | Description |
|--------|-------------|
| `--ref <num>` | Variables reference ID (from a scope or parent variable) |
| `--frame <id>` | Stack frame to inspect (fetches scopes automatically) |
| `--depth <n>` | Maximum nesting depth for recursive expansion (default: 1) |
| `--max-properties <n>` | Maximum properties per scope (default: 100) |

**Examples:**

```bash
# Inspect variables from a specific scope reference
agentic-debugger variables --ref 1001 --session sess-1

# Inspect all local variables at the current frame
agentic-debugger variables --frame 0 --depth 2 --session sess-1
```

---

#### `callstack` — View the call stack

```bash
agentic-debugger callstack --session <id> --thread <tid> [options]
```

| Option | Description |
|--------|-------------|
| `--start-frame <n>` | Start index for pagination |
| `--levels <n>` | Number of frames to return |

---

#### `threads` — List all threads

```bash
agentic-debugger threads --session <id>
```

---

#### `evaluate` — Evaluate an expression

```bash
agentic-debugger evaluate <expression> --session <id> [options]
```

| Option | Description |
|--------|-------------|
| `--frame <id>` | Stack frame context for evaluation |
| `--context <ctx>` | Evaluation context: `watch`, `repl`, or `hover` (default: `repl`) |
| `--timeout <ms>` | Evaluation timeout in milliseconds |
| `--safe-mode` | Warn on expressions that may mutate state |

**Examples:**

```bash
# Evaluate a simple expression
agentic-debugger evaluate "user.name" --session sess-1

# Evaluate in a specific frame with safe mode
agentic-debugger evaluate "items.filter(i => i.active)" --frame 0 --safe-mode --session sess-1

# REPL-style evaluation
agentic-debugger evaluate "a + b" --context repl --session sess-1
```

---

#### `watch` — Manage watch expressions

```bash
agentic-debugger watch add <expression> --session <id>
agentic-debugger watch remove <expression> --session <id>
agentic-debugger watch list --session <id>
agentic-debugger watch evaluate --session <id> [--frame <id>]
```

**Examples:**

```bash
# Add watch expressions
agentic-debugger watch add "request.body" --session sess-1
agentic-debugger watch add "response.status" --session sess-1

# Evaluate all watches at current frame
agentic-debugger watch evaluate --session sess-1

# List all active watches
agentic-debugger watch list --session sess-1

# Remove a watch
agentic-debugger watch remove "request.body" --session sess-1
```

---

### Interactive Mode

#### `repl` — Interactive debugging REPL

```bash
agentic-debugger repl --session <id>
```

Opens an interactive `dbg>` prompt where you can type any agentic-debugger command without the `agentic-debugger` prefix. Useful for exploratory debugging sessions.

**REPL commands:**

```
dbg> breakpoint set src/app.ts:42
dbg> continue
dbg> variables --frame 0
dbg> evaluate user.name
dbg> step over
dbg> callstack --thread 1
dbg> quit
```

---

### MCP Server Mode

#### `serve` — Start the MCP server

```bash
agentic-debugger serve [options]
```

| Option | Description |
|--------|-------------|
| `--transport <type>` | Transport type: `stdio` (default) or `sse` |
| `--port <number>` | Port for SSE transport (default: `3000`) |

**Examples:**

```bash
# stdio transport (for local AI agents)
agentic-debugger serve --transport stdio

# SSE transport (for remote/browser agents)
agentic-debugger serve --transport sse --port 3000
```

The MCP server exposes **31 tools** across four categories:

| Category | Tools |
|----------|-------|
| **Session** | `launch_debug`, `attach_debug`, `disconnect`, `terminate`, `restart_session`\*, `list_sessions`\* |
| **Breakpoints** | `set_breakpoint`, `remove_breakpoint`, `set_function_breakpoint`, `set_exception_breakpoints`, `set_data_breakpoint`\*, `list_breakpoints`, `enable_breakpoint`, `disable_breakpoint` |
| **Execution** | `continue_execution`, `step_over`, `step_into`, `step_out`, `pause_execution`, `set_next_statement`, `restart_frame`, `reverse_continue`\* |
| **Inspection** | `evaluate_expression`, `get_variables`, `get_call_stack`, `get_threads`, `get_scopes`\*, `manage_watch`, `get_loaded_sources`\*, `get_modules`\*, `get_exception_info`\* |

> **\* = MCP-only** — these tools have no CLI equivalent (see section below).

### MCP-only tools (not available via CLI)

The MCP server exposes 7 tools that are **not** available as standalone CLI commands:

| MCP tool | What it does | Why CLI doesn't have it |
|----------|-------------|-------------------------|
| `list_sessions` | List all active debug sessions | Agents manage multiple concurrent sessions; CLI is typically single-session |
| `restart_session` | Restart a debug session without re-launching | Agents benefit from stateless restart; CLI users re-run `launch` |
| `set_data_breakpoint` | Break on variable read/write (watchpoint) | Not all adapters support it; CLI uses conditional breakpoints instead |
| `reverse_continue` | Run execution backwards (time-travel debugging) | Requires adapter support (rare); primarily useful for agent-driven exploration |
| `get_scopes` | Retrieve scopes for a stack frame (standalone) | CLI folds this into `variables --frame <id>` automatically |
| `get_loaded_sources` | List all source files loaded by the debuggee | Useful for agents to discover files; CLI users already know their file paths |
| `get_modules` | List loaded modules/assemblies (with pagination) | Primarily useful for .NET module inspection by agents |
| `get_exception_info` | Get detailed info about the current exception | Agents use this to auto-diagnose; CLI users inspect via `evaluate` |

### CLI-only features (not in MCP)

| CLI feature | What it does |
|-------------|-------------|
| `repl` | Interactive `dbg>` prompt for exploratory debugging — agents don't need a REPL since they call tools directly |
| `serve` | Starts the MCP server itself — this *is* the MCP mode |

---

## Output Format

All CLI output uses a consistent JSON envelope:

```json
{
  "success": true,
  "command": "launch",
  "sessionId": "sess-abc123",
  "timestamp": "2026-02-15T10:30:00Z",
  "data": { /* command-specific payload */ },
  "error": null
}
```

On failure:

```json
{
  "success": false,
  "command": "attach",
  "sessionId": null,
  "timestamp": "2026-02-15T10:30:00Z",
  "data": null,
  "error": {
    "code": "ADAPTER_NOT_FOUND",
    "message": "js-debug DAP server not found.",
    "resolution": "Run: npm run provision:adapters from the package checkout"
  }
}
```

**Error codes:**

| Code | Meaning |
|------|---------|
| `SESSION_NOT_FOUND` | No session with the given ID |
| `ADAPTER_NOT_FOUND` | Debug adapter binary not installed |
| `ADAPTER_NOT_AVAILABLE` | Adapter exists but cannot be used |
| `LAUNCH_FAILED` | Failed to launch the debuggee |
| `ATTACH_FAILED` | Failed to attach to the target |
| `CONNECTION_REFUSED` | Cannot connect to the target address/port |
| `PROCESS_NOT_FOUND` | No process with the given PID |
| `RUNTIME_INCOMPATIBLE` | Adapter doesn't support the target runtime (e.g., netcoredbg vs .NET Framework) |
| `DAP_PROTOCOL_ERROR` | Debug adapter returned an error |
| `FILE_NOT_FOUND` | Program or source file not found |

---

## Common Workflows

### Workflow 1: Debug a crash

```bash
# 1. Launch with exception breakpoints
agentic-debugger launch ./app.ts --stop-on-entry
# → returns sessionId: sess-1

# 2. Set exception breakpoints to catch all uncaught errors
agentic-debugger exception-breakpoints set --filter uncaught --session sess-1

# 3. Continue execution — it will pause at the exception
agentic-debugger continue --session sess-1

# 4. Inspect the call stack
agentic-debugger callstack --thread 1 --session sess-1

# 5. Inspect variables at the crash site
agentic-debugger variables --frame 0 --depth 2 --session sess-1

# 6. Evaluate the failing expression
agentic-debugger evaluate "response.data" --session sess-1

# 7. Disconnect
agentic-debugger disconnect --session sess-1 --terminate
```

### Workflow 2: Debug a specific function

```bash
# 1. Launch the program
agentic-debugger launch ./server.py --language python
# → sess-1

# 2. Set a breakpoint at the function of interest
agentic-debugger breakpoint set src/services/payment.py:55 --session sess-1

# 3. Continue to the breakpoint
agentic-debugger continue --session sess-1

# 4. Step through the function line by line
agentic-debugger step over --session sess-1
agentic-debugger step over --session sess-1
agentic-debugger step into --session sess-1

# 5. Inspect local variables
agentic-debugger variables --frame 0 --session sess-1

# 6. Step out of the function
agentic-debugger step out --session sess-1
```

### Workflow 3: Debug a loop with conditional breakpoint

```bash
# 1. Launch
agentic-debugger launch ./processor.js
# → sess-1

# 2. Set a conditional breakpoint inside the loop
agentic-debugger breakpoint set src/processor.js:78 --condition "item.status === 'error'" --session sess-1

# 3. Continue — only stops when the condition is true
agentic-debugger continue --session sess-1

# 4. Evaluate the problematic item
agentic-debugger evaluate "JSON.stringify(item, null, 2)" --session sess-1

# 5. Check the call stack
agentic-debugger callstack --thread 1 --session sess-1
```

### Workflow 4: Debug C# / .NET Core (launch)

```bash
# 1. Build the .NET project
dotnet build -c Debug

# 2. Launch the DLL
agentic-debugger launch ./bin/Debug/net8.0/MyApp.dll --language csharp --stop-on-entry
# → sess-1

# 3. Set a breakpoint
agentic-debugger breakpoint set Program.cs:25 --session sess-1

# 4. Continue to the breakpoint
agentic-debugger continue --session sess-1

# 5. Evaluate a C# expression
agentic-debugger evaluate "myList.Count" --session sess-1
```

### Workflow 5: Debug C# / .NET Framework (attach by PID)

```bash
# 1. Find the PID of the running .NET Framework process
tasklist | findstr MyDesktopApp
# → MyDesktopApp.exe   12345   Console   1   48,000 K

# 2. Attach to the process (auto-detects .NET Framework vs Core)
agentic-debugger attach --language csharp --pid 12345
# → sessionId: sess-abc

# 3. Set breakpoints (--session is optional, auto-detected)
agentic-debugger breakpoint set --file src/MainWindow.cs --line 42

# 4. List breakpoints from any terminal
agentic-debugger breakpoint list

# 5. Disconnect
agentic-debugger disconnect -s sess-abc
```

### Workflow 6: Debug TypeScript in Edge/WebView2 (CDP attach)

> **NOT CURRENTLY SUPPORTED.** Tracked as bug 4. js-debug's standalone
> `dapDebugServer.js` cannot complete browser attach without VS Code's
> multi-session host. The CLI now downgrades this in `attach --help` and
> returns a clear error when `--type chrome|msedge` is used. Workarounds:
>
> * For Node.js, use V8 inspector attach (`node --inspect-brk=PORT` +
>   `attach --language javascript --address 127.0.0.1:PORT`).
> * For browsers/WebView2, attach via VS Code's JS debugger directly.

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENTIC_LOG_LEVEL` | Log verbosity: `debug`, `info`, `warn`, `error` | `info` |
| `AGENTIC_LOG_DIR` | Directory for log files | `./logs` |
| `AGENTIC_JSDEBUG_PATH` | Path to `dapDebugServer.js` (must be inside `js-debug/src/` alongside `.wasm` files) | Auto-detected |
| `AGENTIC_VSDBG_PATH` | Path to `vsdbg.exe` binary (license-locked to VS Code; fallback only) | Auto-detected |
| `AGENTIC_DEBUGPY_PATH` | Path to debugpy module | Auto-detected |
| `AGENTIC_NETCOREDBG_PATH` | Path to netcoredbg binary (preferred .NET Core adapter) | Auto-detected |
| `AGENTIC_CLR_DEBUG_PATH` | Path to `clr-debug.exe` binary (.NET Framework 4.x) | Required unless built locally |
| `AGENTIC_PYTHON_PATH` | Python interpreter path (for venvs) | Auto-detected |
| `AGENTIC_SAFE_MODE` | Enable expression safety checks | `true` |
| `AGENTIC_REDACT_PATTERNS` | Comma-separated redaction patterns | Built-in defaults |

---

## Security Features

The CLI includes built-in security guardrails:

- **Expression safety** — `--safe-mode` warns before evaluating expressions that may mutate state (assignments, function calls with side effects)
- **Value redaction** — Sensitive values matching patterns (API keys, passwords, tokens) are automatically redacted in output
- **Process guard** — The `attach --pid` command validates that the target process is safe to attach to

---

## Tips

1. **Always capture the `sessionId`** from the `launch` or `attach` response — useful when you need to disambiguate, though `--session` is now optional everywhere (the CLI auto-selects the most recently created session).
2. **Auto-session detection** — when `--session` is omitted, the CLI falls back to the most recently created session. Works across processes via `~/.agentic-debugger/sessions/`.
3. **Auto thread-id detection** — when `--thread-id` is omitted on `callstack`/`continue`/`pause`/`step`/`goto`, the session host injects the most recent `stopped` event's thread ID. Useful because adapters like netcoredbg return OS thread IDs (5-digit) that aren't guessable.
4. **Cross-process persistence** — session and breakpoint state is persisted to `~/.agentic-debugger/`. You can run `attach` in one terminal and `breakpoint set/list` from another.
5. **Use `--stop-on-entry`** when you need to set breakpoints before the program runs past them.
6. **Set exception breakpoints first** — they catch errors at their origin, before stack unwinding.
7. **Use conditional breakpoints** in loops to avoid stopping on every iteration.
8. **Use logpoints** (`--log-message`) when you need to trace execution flow without pausing.
9. **Limit variable depth** — large objects produce enormous output; start with `--depth 1` and drill deeper as needed.
10. **C# requires `--pid`** — none of the .NET adapters support `--address`. Use `tasklist | findstr MyApp` (Windows) or `ps aux | grep MyApp` (Linux/macOS) to find the PID.
11. **For .NET Framework 4.x**, pass `--type clr` so the CLI uses clr-debug directly (ICorDebug). For .NET Core / .NET 5+, omit `--type` and the CLI tries netcoredbg first, then vsdbg, then clr-debug.
12. **Browser/CDP attach is unsupported in standalone CLI (bug 4)** — `--type chrome|msedge` returns a clear error. For Node.js, use V8 inspector attach (`node --inspect-brk=PORT`).
13. **If attach fails**, check the error `code` field: `CONNECTION_REFUSED` means the target isn't running or the port is wrong; `ADAPTER_NOT_FOUND` means the debug adapter binary is missing (run `npm run provision:adapters` from the package checkout or configure the adapter path explicitly).
14. **Multiple sessions** — you can run `launch`/`attach` multiple times to debug several programs concurrently; each gets a unique `sessionId`.

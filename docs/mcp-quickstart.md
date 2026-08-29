# MCP Quickstart Guide

Connect your AI coding agent to the agentic debugger via the Model Context Protocol (MCP). This guide covers configuration for popular MCP clients.

## Prerequisites

```bash
npm install -g agentic-debugger
```

Verify the installation:

```bash
agentic-debugger --version
```

## Transport Options

The agentic debugger supports two MCP transports:

| Transport | Use Case | Command |
|-----------|----------|---------|
| **stdio** | Local AI agent on the same machine | `agentic-debugger serve --transport stdio` |
| **SSE** | Remote agents or browser-based clients | `agentic-debugger serve --transport sse --port 3000` |

## Roo Code

### stdio Transport

Add to your workspace MCP configuration (`.roo/mcp.json`):

```json
{
  "mcpServers": {
    "agentic-debugger": {
      "command": "agentic-debugger",
      "args": ["serve", "--transport", "stdio"],
      "disabled": false
    }
  }
}
```

### SSE Transport

Start the server manually first:

```bash
agentic-debugger serve --transport sse --port 3000
```

Then configure in `.roo/mcp.json`:

```json
{
  "mcpServers": {
    "agentic-debugger": {
      "url": "http://localhost:3000/sse",
      "disabled": false
    }
  }
}
```

### Verify Connection

1. Open Roo Code in VS Code
2. Check the MCP server list — `agentic-debugger` should appear as connected
3. Test with a tool call: ask Roo to "launch a debug session for ./app.js"

## Cline

### stdio Transport

Add to your VS Code settings (`settings.json`) under the Cline MCP configuration:

```json
{
  "cline.mcpServers": {
    "agentic-debugger": {
      "command": "agentic-debugger",
      "args": ["serve", "--transport", "stdio"],
      "disabled": false
    }
  }
}
```

### SSE Transport

```json
{
  "cline.mcpServers": {
    "agentic-debugger": {
      "url": "http://localhost:3000/sse",
      "disabled": false
    }
  }
}
```

### Verify Connection

1. Open the Cline sidebar in VS Code
2. Click the MCP servers icon to confirm `agentic-debugger` is connected
3. Test: "Use the debugger to launch ./app.js and set a breakpoint at line 10"

## Cursor

### stdio Transport

Add to your Cursor MCP settings (Settings → MCP → Add Server):

```json
{
  "mcpServers": {
    "agentic-debugger": {
      "command": "agentic-debugger",
      "args": ["serve", "--transport", "stdio"]
    }
  }
}
```

### SSE Transport

```json
{
  "mcpServers": {
    "agentic-debugger": {
      "url": "http://localhost:3000/sse"
    }
  }
}
```

### Verify Connection

1. Open Cursor Settings → MCP
2. Confirm `agentic-debugger` shows a green status indicator
3. Test: ask Cursor agent to "debug ./app.js and show me the variables at line 15"

## Available MCP Tools

Once connected, the agent has access to 31 debugging tools:

### Session Management

| Tool | Description |
|------|-------------|
| `launch_debug` | Launch a new debug session for a program |
| `attach_debug` | Attach to a running process for debugging |
| `disconnect` | Gracefully disconnect from a debug session |
| `terminate` | Forcefully terminate the debuggee process |
| `list_sessions` | List all active debug sessions |
| `restart_session` | Restart the debug session |

### Breakpoints

| Tool | Description |
|------|-------------|
| `set_breakpoint` | Set a line breakpoint with optional condition |
| `remove_breakpoint` | Remove a breakpoint at a specific location |
| `set_function_breakpoint` | Break when a named function is called |
| `set_exception_breakpoints` | Configure which exceptions cause a break |
| `set_data_breakpoint` | Set a data watchpoint on memory access |
| `list_breakpoints` | List all active breakpoints |
| `enable_breakpoint` | Re-enable a disabled breakpoint |
| `disable_breakpoint` | Disable a breakpoint without removing it |

### Execution Control

| Tool | Description |
|------|-------------|
| `continue_execution` | Continue execution of a paused session |
| `step_over` | Step over the current statement |
| `step_into` | Step into a function call |
| `step_out` | Step out of the current function |
| `pause_execution` | Pause execution of a running session |
| `set_next_statement` | Move the execution point to a specific line |
| `restart_frame` | Restart execution from a specific stack frame |
| `reverse_continue` | Continue execution in reverse |

### Inspection

| Tool | Description |
|------|-------------|
| `evaluate_expression` | Evaluate an expression in the debug context |
| `get_variables` | Get variables for a given scope or object |
| `get_call_stack` | Get the call stack for a thread |
| `get_threads` | List all threads in the debuggee |
| `get_scopes` | Get variable scopes for a stack frame |
| `manage_watch` | Add, remove, list, or evaluate watch expressions |
| `get_loaded_sources` | Get all loaded source files |
| `get_modules` | Get loaded modules with pagination |
| `get_exception_info` | Get exception details at a breakpoint |

## First Debugging Session

Here is a minimal tool invocation sequence to verify everything works:

**1. Launch a debug session:**

```json
// Tool: launch_debug
{ "program": "./app.js" }
```

**2. Set a breakpoint:**

```json
// Tool: set_breakpoint
{ "sessionId": "<id-from-step-1>", "file": "app.js", "line": 5 }
```

**3. Continue to the breakpoint:**

```json
// Tool: continue_execution
{ "sessionId": "<id-from-step-1>" }
```

**4. Inspect variables:**

```json
// Tool: get_call_stack
{ "sessionId": "<id-from-step-1>", "threadId": 1 }
```

```json
// Tool: get_scopes
{ "sessionId": "<id-from-step-1>", "frameId": 1 }
```

```json
// Tool: get_variables
{ "sessionId": "<id-from-step-1>", "variablesReference": 100 }
```

**5. Clean up:**

```json
// Tool: terminate
{ "sessionId": "<id-from-step-1>" }
```

## Troubleshooting

### Server not found

Ensure `agentic-debugger` is installed globally and on your PATH:

```bash
which agentic-debugger    # macOS/Linux
where agentic-debugger    # Windows
```

If not found, reinstall:

```bash
npm install -g agentic-debugger
```

### Connection refused (SSE)

Verify the server is running and the port matches:

```bash
agentic-debugger serve --transport sse --port 3000
```

Check that nothing else is using port 3000.

### Debug adapter not found

The agentic debugger requires language-specific debug adapters:

| Language | Adapter | Install |
|----------|---------|---------|
| JavaScript/TypeScript | js-debug | Bundled with VS Code, or `npm install -g @vscode/js-debug` |
| Python | debugpy | `pip install debugpy` |
| C#/.NET | netcoredbg | [Install from Samsung/netcoredbg](https://github.com/nicknsy/netcoredbg) |

### Tool call returns an error

Check the session ID is valid — sessions expire when the debuggee terminates. Use `list_sessions` to see active sessions.

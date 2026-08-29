# Best Practices

Guidelines for AI coding agents to maximize debugging efficiency using the agentic debugger MCP tools while maintaining safety and reproducibility.

---

## Efficient Breakpoint Placement

### Where to Set Breakpoints

Place breakpoints at high-value locations to minimize the number of continue/step cycles needed:

| Location | When to Use | Example |
|----------|-------------|---------|
| Function entry | Verify arguments are correct | First line of `processOrder()` |
| Error boundaries | Catch failures at try/catch | The `catch` block line |
| Loop conditions | Inspect iteration state | The `for`/`while` condition line |
| Return statements | Verify output before it leaves | The `return` line |
| Branch conditions | Check which path is taken | The `if` condition line |
| After external calls | Verify API/DB responses | Line after `await fetch()` |

### Minimize Breakpoint Count

Set 1–3 breakpoints at a time. Too many breakpoints cause frequent stops and make it hard to track progress.

```json
// Good: targeted breakpoints at function entry and error boundary
{ "tool": "set_breakpoint", "params": {
  "sessionId": "sess-1",
  "file": "src/services/payment.ts",
  "line": 15
}}

{ "tool": "set_breakpoint", "params": {
  "sessionId": "sess-1",
  "file": "src/services/payment.ts",
  "line": 42,
  "condition": "response.status !== 200"
}}
```

### Use Conditional Breakpoints to Reduce Noise

In loops or frequently-called functions, add a condition to stop only on the interesting case:

```json
// Only stop on the failing item
{ "tool": "set_breakpoint", "params": {
  "sessionId": "sess-1",
  "file": "src/pipeline.ts",
  "line": 67,
  "condition": "item.status === 'error'"
}}
```

### Use Hit Count Breakpoints

Stop after a specific number of hits to skip past initialization:

```json
{ "tool": "set_breakpoint", "params": {
  "sessionId": "sess-1",
  "file": "src/loader.ts",
  "line": 30,
  "hitCondition": ">= 100"
}}
```

### Clean Up Breakpoints

Remove breakpoints when they are no longer needed. Use `list_breakpoints` to audit:

```json
{ "tool": "list_breakpoints", "params": {
  "sessionId": "sess-1"
}}
// Review the list, then remove unneeded ones

{ "tool": "remove_breakpoint", "params": {
  "sessionId": "sess-1",
  "file": "src/pipeline.ts",
  "line": 67
}}
```

### Disable Instead of Remove

If you might need a breakpoint again, disable it instead of removing it:

```json
{ "tool": "disable_breakpoint", "params": {
  "sessionId": "sess-1",
  "breakpointId": "bp-3"
}}

// Re-enable later
{ "tool": "enable_breakpoint", "params": {
  "sessionId": "sess-1",
  "breakpointId": "bp-3"
}}
```

---

## Variable Inspection Strategies

### Control Inspection Depth

Large objects can produce enormous output. Use `depth` and `maxProperties` to limit what you retrieve:

```json
// Shallow inspection first
{ "tool": "get_variables", "params": {
  "sessionId": "sess-1",
  "variablesReference": 1001,
  "depth": 1,
  "maxProperties": 10
}}
```

If you need more detail on a specific property, drill into it:

```json
// Drill into a specific nested object
{ "tool": "get_variables", "params": {
  "sessionId": "sess-1",
  "variablesReference": 1005,
  "depth": 2,
  "maxProperties": 20
}}
```

### Scope-First Approach

Always start with `get_scopes` to understand what scope categories are available, then target the right one:

```json
{ "tool": "get_scopes", "params": {
  "sessionId": "sess-1",
  "frameId": 0
}}
```

Typical scopes:
- **Local** — Variables in the current function (inspect this first)
- **Closure** — Variables captured from enclosing scopes
- **Global** — Global/module-level variables (expensive; avoid unless needed)

### Redaction Awareness

The debugger may redact sensitive values (passwords, tokens, API keys). If a variable shows as `"[REDACTED]"`, this is intentional security behavior. Do not attempt to circumvent it with expression evaluation.

### Inspect Across Stack Frames

When a variable looks wrong, trace it back through the call stack:

```json
// Check frame 0 (current function)
{ "tool": "get_scopes", "params": { "sessionId": "sess-1", "frameId": 0 }}
{ "tool": "get_variables", "params": { "sessionId": "sess-1", "variablesReference": 1001 }}

// Check frame 1 (caller function) to see what was passed
{ "tool": "get_scopes", "params": { "sessionId": "sess-1", "frameId": 1 }}
{ "tool": "get_variables", "params": { "sessionId": "sess-1", "variablesReference": 2001 }}
```

### Use Watch Expressions for Repeated Inspections

If you need to check the same expression after every step, add a watch:

```json
{ "tool": "manage_watch", "params": {
  "sessionId": "sess-1",
  "action": "add",
  "expression": "this.state.isValid"
}}

// After each step, evaluate all watches at once
{ "tool": "manage_watch", "params": {
  "sessionId": "sess-1",
  "action": "evaluate",
  "frameId": 0
}}
```

---

## Expression Evaluation Tips

### Safe vs Unsafe Expressions

| Type | Example | Safe? | Notes |
|------|---------|-------|-------|
| Property access | `user.name` | ✅ | Read-only, no side effects |
| String formatting | `JSON.stringify(obj)` | ✅ | Read-only |
| Array methods (non-mutating) | `arr.filter(x => x > 0)` | ✅ | Creates new array |
| Arithmetic | `price * quantity` | ✅ | Pure computation |
| Mutating methods | `arr.push(item)` | ⚠️ | Modifies program state |
| Assignment | `user.name = 'test'` | ⚠️ | Modifies program state |
| Function calls | `service.reset()` | ⚠️ | May have side effects |
| Network calls | `fetch(url)` | ❌ | External side effects |
| File operations | `fs.writeFileSync(...)` | ❌ | Destructive side effects |

### Choose the Right Evaluation Context

```json
// Use "repl" for interactive exploration (allows statements)
{ "tool": "evaluate_expression", "params": {
  "sessionId": "sess-1",
  "expression": "Object.keys(config)",
  "frameId": 0,
  "context": "repl"
}}

// Use "watch" for repeated evaluation (expressions only)
{ "tool": "evaluate_expression", "params": {
  "sessionId": "sess-1",
  "expression": "items.length",
  "frameId": 0,
  "context": "watch"
}}

// Use "hover" for quick value peek
{ "tool": "evaluate_expression", "params": {
  "sessionId": "sess-1",
  "expression": "status",
  "frameId": 0,
  "context": "hover"
}}
```

### Frame Context Matters

Always specify `frameId` to evaluate in the correct stack frame. Without it, the expression evaluates in the topmost frame which may not have the variables you expect:

```json
// Evaluate in the caller's context (frame 1) instead of current (frame 0)
{ "tool": "evaluate_expression", "params": {
  "sessionId": "sess-1",
  "expression": "requestBody",
  "frameId": 1,
  "context": "repl"
}}
```

### Complex Object Inspection

For large objects, convert to string first:

```json
{ "tool": "evaluate_expression", "params": {
  "sessionId": "sess-1",
  "expression": "JSON.stringify(config, null, 2)",
  "frameId": 0,
  "context": "repl"
}}
```

For Python:

```json
{ "tool": "evaluate_expression", "params": {
  "sessionId": "sess-1",
  "expression": "str(vars(config))",
  "frameId": 0,
  "context": "repl"
}}
```

---

## Session Management

### Session Lifecycle

1. **Create** — `launch_debug` or `attach_debug` creates a session
2. **Use** — Set breakpoints, continue, step, inspect
3. **Clean up** — `disconnect` (detach) or `terminate` (kill process)

### Choosing Disconnect vs Terminate

| Tool | Effect | Use When |
|------|--------|----------|
| `disconnect` with `terminateDebuggee: true` | Detach and kill the process | Done debugging a launched program |
| `disconnect` with `terminateDebuggee: false` | Detach, leave process running | Attached to a running server |
| `terminate` | Send terminate request to debuggee | Graceful shutdown needed |

### Always Clean Up

Every debug session must be disconnected when done. Leaked sessions consume resources:

```json
// Check for orphaned sessions
{ "tool": "list_sessions", "params": {} }

// Clean up each one
{ "tool": "disconnect", "params": {
  "sessionId": "sess-1",
  "terminateDebuggee": true
}}
```

### Multiple Sessions

When debugging interacting processes (e.g., client and server), use separate sessions and switch between them by specifying the correct `sessionId`:

```json
// Inspect the server
{ "tool": "get_variables", "params": {
  "sessionId": "server-sess",
  "variablesReference": 1001
}}

// Inspect the client
{ "tool": "get_variables", "params": {
  "sessionId": "client-sess",
  "variablesReference": 2001
}}
```

### Restart Sessions

Use `restart_session` to re-run the program from scratch without creating a new session:

```json
{ "tool": "restart_session", "params": {
  "sessionId": "sess-1"
}}
```

Breakpoints and exception filters persist across restarts.

---

## Error Handling

### Interpreting Error Responses

All tools return a standard envelope. On failure:

```json
{
  "success": false,
  "sessionId": "sess-1",
  "command": "set_breakpoint",
  "timestamp": "2026-01-15T10:30:05Z",
  "data": null,
  "error": {
    "code": "BREAKPOINT_NOT_VERIFIED",
    "message": "Breakpoint at line 42 could not be verified",
    "resolution": "Check that the file path is correct and the line contains executable code"
  }
}
```

### Common Error Codes and Remedies

| Error Code | Meaning | Remedy |
|------------|---------|--------|
| `SESSION_NOT_FOUND` | Session ID is invalid or expired | Call `list_sessions` to find active sessions |
| `BREAKPOINT_NOT_VERIFIED` | Line doesn't contain executable code | Try an adjacent line with actual code |
| `EVALUATION_FAILED` | Expression could not be evaluated | Check syntax; ensure variables are in scope |
| `THREAD_NOT_FOUND` | Thread ID doesn't exist | Call `get_threads` to get valid thread IDs |
| `FRAME_NOT_FOUND` | Frame ID doesn't exist | Call `get_call_stack` to get valid frame IDs |
| `ADAPTER_NOT_FOUND` | No debug adapter for this language | Check supported languages |
| `LAUNCH_FAILED` | Program could not start | Verify the program path and arguments |

### Retry Strategies

**Transient errors** (adapter not ready, process starting):
- Wait briefly, then retry the same operation
- Maximum 2–3 retries

**Permanent errors** (wrong file path, invalid expression):
- Do not retry the same operation
- Fix the input and try again

```json
// If set_breakpoint fails with BREAKPOINT_NOT_VERIFIED,
// try the next line:
{ "tool": "set_breakpoint", "params": {
  "sessionId": "sess-1",
  "file": "src/service.ts",
  "line": 43
}}
```

### Verify Breakpoints After Setting

Always check the response to confirm the breakpoint was verified:

```json
{ "tool": "set_breakpoint", "params": {
  "sessionId": "sess-1",
  "file": "src/handler.ts",
  "line": 25
}}
// Check response: data.verified should be true
// If false, the breakpoint may have been moved to an adjacent line
// Check data.line for the actual verified line number
```

---

## General Tips

### Start with Exception Breakpoints

Before investigating any bug, enable exception breakpoints. This catches the error at its origin rather than after it has propagated:

```json
{ "tool": "set_exception_breakpoints", "params": {
  "sessionId": "sess-1",
  "filters": ["uncaught"]
}}
```

### Use `stopOnEntry` for Unknown Programs

When debugging unfamiliar code, launch with `stopOnEntry: true` to pause at the first line:

```json
{ "tool": "launch_debug", "params": {
  "program": "src/unknown-script.py",
  "language": "python",
  "stopOnEntry": true
}}
```

### Prefer Step Over to Step Into

Step over (`step_over`) keeps you at the current abstraction level. Only step into (`step_into`) when you suspect the bug is inside the called function. Excessive stepping into standard library or framework code wastes time.

### Use Function Breakpoints for Dynamic Code

When the exact file and line are unknown (e.g., dynamically loaded modules), use function breakpoints:

```json
{ "tool": "set_function_breakpoint", "params": {
  "sessionId": "sess-1",
  "name": "handleError"
}}
```

### Check Loaded Sources and Modules

To understand what code is loaded in the runtime:

```json
{ "tool": "get_loaded_sources", "params": {
  "sessionId": "sess-1"
}}

{ "tool": "get_modules", "params": {
  "sessionId": "sess-1"
}}
```

This helps verify that the correct version of a file is loaded, especially in environments with bundlers or transpilers.

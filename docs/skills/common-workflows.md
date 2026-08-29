# Common Debugging Workflows

Step-by-step tool invocation sequences for common debugging scenarios. Each workflow provides a repeatable pattern that AI coding agents can follow to diagnose specific categories of issues.

All tool responses use the standard envelope format:

```json
{
  "success": true,
  "sessionId": "sess-1",
  "command": "<tool_name>",
  "timestamp": "2026-01-15T10:30:00Z",
  "data": { /* tool-specific payload */ },
  "error": null
}
```

On failure, `success` is `false` and `error` contains `code`, `message`, and optionally `resolution`.

---

## 1. Basic Debug Workflow

Use this workflow to launch a program, pause at a specific location, inspect state, and clean up.

### Step 1: Launch the Debug Session

```json
{ "tool": "launch_debug", "params": {
  "program": "src/app.ts",
  "language": "typescript",
  "stopOnEntry": false
}}
```

**Expected response:**

```json
{
  "success": true,
  "sessionId": "sess-1",
  "command": "launch_debug",
  "timestamp": "2026-01-15T10:30:00Z",
  "data": { "sessionId": "sess-1", "status": "running" },
  "error": null
}
```

### Step 2: Set a Breakpoint

```json
{ "tool": "set_breakpoint", "params": {
  "sessionId": "sess-1",
  "file": "src/services/order-service.ts",
  "line": 55
}}
```

**Expected response:**

```json
{
  "success": true,
  "sessionId": "sess-1",
  "command": "set_breakpoint",
  "timestamp": "2026-01-15T10:30:01Z",
  "data": { "verified": true, "file": "src/services/order-service.ts", "line": 55 },
  "error": null
}
```

### Step 3: Continue Execution

```json
{ "tool": "continue_execution", "params": {
  "sessionId": "sess-1"
}}
```

Execution runs until the breakpoint is hit. The response indicates the program is paused.

### Step 4: Inspect Variables

```json
// Get scopes for the stopped frame
{ "tool": "get_scopes", "params": {
  "sessionId": "sess-1",
  "frameId": 0
}}
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "scopes": [
      { "name": "Local", "variablesReference": 1001, "expensive": false },
      { "name": "Closure", "variablesReference": 1002, "expensive": false },
      { "name": "Global", "variablesReference": 1003, "expensive": true }
    ]
  }
}
```

```json
// Get local variables
{ "tool": "get_variables", "params": {
  "sessionId": "sess-1",
  "variablesReference": 1001
}}
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "variables": [
      { "name": "order", "value": "Order { id: 'ord-123', total: 49.99 }", "type": "Order", "variablesReference": 1005 },
      { "name": "customer", "value": "undefined", "type": "undefined", "variablesReference": 0 }
    ]
  }
}
```

### Step 5: Evaluate an Expression

```json
{ "tool": "evaluate_expression", "params": {
  "sessionId": "sess-1",
  "expression": "order.items.length",
  "frameId": 0,
  "context": "repl"
}}
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "result": "3",
    "type": "number",
    "variablesReference": 0
  }
}
```

### Step 6: Disconnect

```json
{ "tool": "disconnect", "params": {
  "sessionId": "sess-1",
  "terminateDebuggee": true
}}
```

---

## 2. Exception Diagnosis Workflow

Use this workflow when the program throws an error and you need to find the root cause.

### Step 1: Launch and Set Exception Breakpoints

```json
{ "tool": "launch_debug", "params": {
  "program": "src/server.ts",
  "language": "typescript"
}}
```

```json
{ "tool": "set_exception_breakpoints", "params": {
  "sessionId": "sess-1",
  "filters": ["uncaught"]
}}
```

### Step 2: Run Until the Exception

```json
{ "tool": "continue_execution", "params": {
  "sessionId": "sess-1"
}}
```

Execution pauses when an uncaught exception is thrown.

### Step 3: Get Exception Details

```json
{ "tool": "get_exception_info", "params": {
  "sessionId": "sess-1",
  "threadId": 1
}}
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "exceptionId": "TypeError",
    "description": "Cannot read properties of undefined (reading 'email')",
    "breakMode": "unhandled",
    "details": {
      "stackTrace": "at sendNotification (notification.ts:23)\nat processOrder (order-service.ts:67)"
    }
  }
}
```

### Step 4: Examine the Call Stack

```json
{ "tool": "get_call_stack", "params": {
  "sessionId": "sess-1",
  "threadId": 1
}}
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "stackFrames": [
      { "id": 0, "name": "sendNotification", "source": "notification.ts", "line": 23, "column": 15 },
      { "id": 1, "name": "processOrder", "source": "order-service.ts", "line": 67, "column": 5 },
      { "id": 2, "name": "handleRequest", "source": "router.ts", "line": 112, "column": 8 }
    ],
    "totalFrames": 3
  }
}
```

### Step 5: Inspect State at the Crash Point

```json
{ "tool": "get_scopes", "params": {
  "sessionId": "sess-1",
  "frameId": 0
}}
```

```json
{ "tool": "get_variables", "params": {
  "sessionId": "sess-1",
  "variablesReference": 1001
}}
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "variables": [
      { "name": "user", "value": "undefined", "type": "undefined", "variablesReference": 0 },
      { "name": "orderId", "value": "'ord-456'", "type": "string", "variablesReference": 0 }
    ]
  }
}
```

The `user` variable is `undefined`, which explains why `user.email` throws a TypeError.

### Step 6: Inspect the Caller Frame

```json
{ "tool": "get_scopes", "params": {
  "sessionId": "sess-1",
  "frameId": 1
}}
```

```json
{ "tool": "get_variables", "params": {
  "sessionId": "sess-1",
  "variablesReference": 2001
}}
```

This reveals what was passed to `sendNotification`, tracing the undefined value to its source.

### Step 7: Clean Up

```json
{ "tool": "disconnect", "params": {
  "sessionId": "sess-1",
  "terminateDebuggee": true
}}
```

---

## 3. Multi-Threaded Debugging Workflow

Use this workflow for programs with multiple threads (e.g., web servers, worker pools).

### Step 1: Launch the Program

```json
{ "tool": "launch_debug", "params": {
  "program": "src/worker-pool.py",
  "language": "python"
}}
```

### Step 2: List Threads

```json
{ "tool": "get_threads", "params": {
  "sessionId": "sess-1"
}}
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "threads": [
      { "id": 1, "name": "MainThread" },
      { "id": 2, "name": "Worker-1" },
      { "id": 3, "name": "Worker-2" },
      { "id": 4, "name": "Worker-3" }
    ]
  }
}
```

### Step 3: Set a Breakpoint in Shared Code

```json
{ "tool": "set_breakpoint", "params": {
  "sessionId": "sess-1",
  "file": "src/task_handler.py",
  "line": 30,
  "condition": "task.priority == 'high'"
}}
```

### Step 4: Continue and Hit the Breakpoint

```json
{ "tool": "continue_execution", "params": {
  "sessionId": "sess-1"
}}
```

### Step 5: Identify Which Thread Stopped

```json
{ "tool": "get_threads", "params": {
  "sessionId": "sess-1"
}}
```

Check which thread is in a "stopped" state — this is the thread that hit the breakpoint.

### Step 6: Inspect the Stopped Thread

```json
{ "tool": "get_call_stack", "params": {
  "sessionId": "sess-1",
  "threadId": 3
}}
```

```json
{ "tool": "get_scopes", "params": {
  "sessionId": "sess-1",
  "frameId": 0
}}
```

```json
{ "tool": "get_variables", "params": {
  "sessionId": "sess-1",
  "variablesReference": 1001
}}
```

### Step 7: Inspect Another Thread for Comparison

```json
// Pause a different thread
{ "tool": "pause_execution", "params": {
  "sessionId": "sess-1",
  "threadId": 2
}}

{ "tool": "get_call_stack", "params": {
  "sessionId": "sess-1",
  "threadId": 2
}}
```

### Step 8: Continue a Specific Thread

```json
{ "tool": "continue_execution", "params": {
  "sessionId": "sess-1",
  "threadId": 3
}}
```

### Step 9: Clean Up

```json
{ "tool": "disconnect", "params": {
  "sessionId": "sess-1",
  "terminateDebuggee": true
}}
```

---

## 4. Attach Workflow

Use this workflow to debug an already-running process.

### Step 1: Attach to the Process

```json
{ "tool": "attach_debug", "params": {
  "host": "localhost",
  "port": 9229,
  "language": "typescript"
}}
```

**Expected response:**

```json
{
  "success": true,
  "sessionId": "sess-2",
  "command": "attach_debug",
  "timestamp": "2026-01-15T10:35:00Z",
  "data": { "sessionId": "sess-2", "status": "attached" },
  "error": null
}
```

Or attach by process ID:

```json
{ "tool": "attach_debug", "params": {
  "pid": 12345,
  "language": "python"
}}
```

### Step 2: Set Breakpoints

```json
{ "tool": "set_breakpoint", "params": {
  "sessionId": "sess-2",
  "file": "src/api/handler.ts",
  "line": 88
}}
```

### Step 3: Continue and Trigger the Code Path

```json
{ "tool": "continue_execution", "params": {
  "sessionId": "sess-2"
}}
```

Trigger the relevant code path externally (e.g., send an HTTP request). Execution pauses at the breakpoint.

### Step 4: Inspect State

```json
{ "tool": "get_scopes", "params": {
  "sessionId": "sess-2",
  "frameId": 0
}}

{ "tool": "get_variables", "params": {
  "sessionId": "sess-2",
  "variablesReference": 1001
}}
```

### Step 5: Disconnect Without Terminating

```json
{ "tool": "disconnect", "params": {
  "sessionId": "sess-2",
  "terminateDebuggee": false
}}
```

Setting `terminateDebuggee: false` leaves the process running after detaching.

---

## 5. Performance Investigation Workflow

Use this workflow to investigate slow code paths by measuring timing at strategic points.

### Step 1: Launch the Program

```json
{ "tool": "launch_debug", "params": {
  "program": "src/batch-processor.ts",
  "language": "typescript",
  "args": ["--input", "data/large-dataset.json"]
}}
```

### Step 2: Set a Breakpoint Before the Slow Section

```json
{ "tool": "set_breakpoint", "params": {
  "sessionId": "sess-1",
  "file": "src/batch-processor.ts",
  "line": 40
}}
```

### Step 3: Continue to the Breakpoint

```json
{ "tool": "continue_execution", "params": {
  "sessionId": "sess-1"
}}
```

### Step 4: Capture Start Time

```json
{ "tool": "evaluate_expression", "params": {
  "sessionId": "sess-1",
  "expression": "Date.now()",
  "frameId": 0,
  "context": "repl"
}}
```

**Expected response:**

```json
{
  "success": true,
  "data": { "result": "1705312200000", "type": "number" }
}
```

### Step 5: Set a Breakpoint After the Slow Section

```json
{ "tool": "set_breakpoint", "params": {
  "sessionId": "sess-1",
  "file": "src/batch-processor.ts",
  "line": 85
}}
```

### Step 6: Continue to the Second Breakpoint

```json
{ "tool": "continue_execution", "params": {
  "sessionId": "sess-1"
}}
```

### Step 7: Measure Elapsed Time

```json
{ "tool": "evaluate_expression", "params": {
  "sessionId": "sess-1",
  "expression": "Date.now() - 1705312200000",
  "frameId": 0,
  "context": "repl"
}}
```

**Expected response:**

```json
{
  "success": true,
  "data": { "result": "3450", "type": "number" }
}
```

The slow section took 3450 ms.

### Step 8: Inspect State to Understand Why

```json
{ "tool": "evaluate_expression", "params": {
  "sessionId": "sess-1",
  "expression": "items.length",
  "frameId": 0,
  "context": "repl"
}}

{ "tool": "evaluate_expression", "params": {
  "sessionId": "sess-1",
  "expression": "cache.stats()",
  "frameId": 0,
  "context": "repl"
}}
```

### Step 9: Clean Up

```json
{ "tool": "disconnect", "params": {
  "sessionId": "sess-1",
  "terminateDebuggee": true
}}
```

---

## 6. Session Management Workflow

Use this workflow when managing multiple debug sessions simultaneously.

### Step 1: Launch Multiple Sessions

```json
{ "tool": "launch_debug", "params": {
  "program": "src/api-server.ts",
  "language": "typescript"
}}
// Returns sessionId: "sess-1"

{ "tool": "launch_debug", "params": {
  "program": "src/worker.ts",
  "language": "typescript"
}}
// Returns sessionId: "sess-2"
```

### Step 2: List Active Sessions

```json
{ "tool": "list_sessions", "params": {} }
```

**Expected response:**

```json
{
  "success": true,
  "data": {
    "sessions": [
      { "sessionId": "sess-1", "program": "src/api-server.ts", "status": "running" },
      { "sessionId": "sess-2", "program": "src/worker.ts", "status": "running" }
    ]
  }
}
```

### Step 3: Set Breakpoints in Each Session

```json
{ "tool": "set_breakpoint", "params": {
  "sessionId": "sess-1",
  "file": "src/api-server.ts",
  "line": 30
}}

{ "tool": "set_breakpoint", "params": {
  "sessionId": "sess-2",
  "file": "src/worker.ts",
  "line": 15
}}
```

### Step 4: Terminate One Session

```json
{ "tool": "terminate", "params": {
  "sessionId": "sess-2"
}}
```

### Step 5: Clean Up Remaining Sessions

```json
{ "tool": "disconnect", "params": {
  "sessionId": "sess-1",
  "terminateDebuggee": true
}}
```

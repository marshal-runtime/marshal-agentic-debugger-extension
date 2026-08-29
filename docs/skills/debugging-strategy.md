# Debugging Strategy

How to formulate effective debugging strategies using the agentic debugger MCP tools. This guide targets AI coding agents and covers systematic approaches to identifying, isolating, and resolving bugs.

## Systematic Debugging Method

Follow this cycle for every debugging task:

1. **Reproduce** — Launch the program and trigger the bug
2. **Isolate** — Narrow down to the failing component using breakpoints and exception filters
3. **Inspect** — Examine state at the point of failure
4. **Fix** — Apply the minimal code change
5. **Verify** — Re-run to confirm the fix and check for regressions

## When to Use Breakpoints vs Logging

### Breakpoints: State Inspection

Use breakpoints when you need to pause execution and inspect live state. They are the primary tool for understanding *what* values exist at a given point.

**Best for:**
- Examining variable values at a specific line
- Stepping through logic branch-by-branch
- Inspecting objects with unknown structure
- Verifying function arguments and return values

```json
// Set a breakpoint to inspect state at a suspicious line
{ "tool": "set_breakpoint", "params": {
  "sessionId": "sess-1",
  "file": "src/services/user-service.ts",
  "line": 42
}}
```

After hitting the breakpoint, inspect variables:

```json
// Get scopes for the current frame
{ "tool": "get_scopes", "params": {
  "sessionId": "sess-1",
  "frameId": 0
}}
// Response includes variablesReference for each scope

// Inspect local variables
{ "tool": "get_variables", "params": {
  "sessionId": "sess-1",
  "variablesReference": 1001,
  "depth": 2
}}
```

### Logpoints: Flow Tracing

Use logpoints (breakpoints with `logMessage`) when you need to trace execution flow without stopping. They print a message each time the line is hit.

**Best for:**
- Tracing which code paths execute
- Counting how often a line runs
- Logging values across loop iterations without pausing
- Observing behavior in timing-sensitive code

```json
// Set a logpoint to trace loop iterations
{ "tool": "set_breakpoint", "params": {
  "sessionId": "sess-1",
  "file": "src/services/data-processor.ts",
  "line": 78,
  "logMessage": "Processing item {i}: type={item.type}, status={item.status}"
}}
```

### Conditional Breakpoints: Targeted Pausing

Use conditional breakpoints to pause only when a specific condition is true. This avoids stopping on every iteration of a loop or every call to a function.

```json
// Only break when the user ID matches a specific value
{ "tool": "set_breakpoint", "params": {
  "sessionId": "sess-1",
  "file": "src/services/user-service.ts",
  "line": 42,
  "condition": "userId === 'user-abc-123'"
}}
```

### Decision Matrix

| Scenario | Technique | Reason |
|----------|-----------|--------|
| Unknown variable value | Breakpoint | Need to pause and inspect |
| Which branch executes | Logpoint | Flow tracing without pause |
| Bug only for specific input | Conditional breakpoint | Targeted pause |
| Loop runs too many times | Hit count breakpoint | Count-based pause |
| Variable changes unexpectedly | Data breakpoint | Trigger on write |

## Exception-First Approach

Start every debugging session by setting exception breakpoints. This catches errors at their origin before they propagate up the call stack.

### Step 1: Enable Exception Breakpoints

```json
// Catch all uncaught exceptions
{ "tool": "set_exception_breakpoints", "params": {
  "sessionId": "sess-1",
  "filters": ["uncaught"]
}}
```

For deeper investigation, catch all exceptions including caught ones:

```json
{ "tool": "set_exception_breakpoints", "params": {
  "sessionId": "sess-1",
  "filters": ["all"]
}}
```

### Step 2: Run and Wait for the Exception

```json
{ "tool": "continue_execution", "params": {
  "sessionId": "sess-1"
}}
```

### Step 3: Inspect the Exception

When execution pauses on an exception:

```json
// Get exception details
{ "tool": "get_exception_info", "params": {
  "sessionId": "sess-1",
  "threadId": 1
}}
// Response:
// {
//   "success": true,
//   "data": {
//     "exceptionId": "TypeError",
//     "description": "Cannot read properties of undefined (reading 'name')",
//     "breakMode": "unhandled"
//   }
// }
```

### Step 4: Examine the Call Stack

```json
{ "tool": "get_call_stack", "params": {
  "sessionId": "sess-1",
  "threadId": 1
}}
// Response:
// {
//   "success": true,
//   "data": {
//     "stackFrames": [
//       { "id": 0, "name": "processUser", "source": "user-service.ts", "line": 42 },
//       { "id": 1, "name": "handleRequest", "source": "router.ts", "line": 18 }
//     ]
//   }
// }
```

### Step 5: Inspect State at the Exception

```json
{ "tool": "get_scopes", "params": {
  "sessionId": "sess-1",
  "frameId": 0
}}

{ "tool": "get_variables", "params": {
  "sessionId": "sess-1",
  "variablesReference": 1001
}}
```

### Exception Filter Reference

| Filter | Use When |
|--------|----------|
| `"uncaught"` | Default starting point — catches unhandled errors |
| `"caught"` | Errors are caught but you suspect incorrect handling |
| `"all"` | Need full picture of every exception thrown |

## State Inspection Patterns

### Variable Tree Traversal

Variables are organized hierarchically. Start from scopes, then drill into specific objects:

```json
// 1. Get scopes for the current frame
{ "tool": "get_scopes", "params": {
  "sessionId": "sess-1",
  "frameId": 0
}}
// Returns scopes with variablesReference values:
// Local scope: variablesReference=1001
// Closure scope: variablesReference=1002

// 2. Get top-level local variables
{ "tool": "get_variables", "params": {
  "sessionId": "sess-1",
  "variablesReference": 1001,
  "depth": 1
}}
// Returns variables, some with their own variablesReference for drilling deeper

// 3. Drill into a nested object
{ "tool": "get_variables", "params": {
  "sessionId": "sess-1",
  "variablesReference": 1005,
  "depth": 2,
  "maxProperties": 20
}}
```

### Watch Expressions

Use watches to track specific expressions across stepping operations:

```json
// Add a watch expression
{ "tool": "manage_watch", "params": {
  "sessionId": "sess-1",
  "action": "add",
  "expression": "users.filter(u => u.active).length"
}}

// Evaluate all watches at the current position
{ "tool": "manage_watch", "params": {
  "sessionId": "sess-1",
  "action": "evaluate",
  "frameId": 0
}}
```

### Inline Expression Evaluation

Evaluate arbitrary expressions in the current frame context:

```json
{ "tool": "evaluate_expression", "params": {
  "sessionId": "sess-1",
  "expression": "JSON.stringify(config, null, 2)",
  "frameId": 0,
  "context": "repl"
}}
// Response:
// {
//   "success": true,
//   "data": {
//     "result": "{\n  \"host\": \"localhost\",\n  \"port\": 3000\n}",
//     "type": "string"
//   }
// }
```

## Stepping Strategies

### Step Over vs Step Into

- **Step over** (`step_over`): Execute the current line and stop at the next line in the same function. Use when you trust the called function works correctly.
- **Step into** (`step_into`): Enter the function being called on the current line. Use when you suspect the bug is inside the called function.
- **Step out** (`step_out`): Run until the current function returns. Use when you've confirmed this function is not the problem.

```json
// Step over a trusted function call
{ "tool": "step_over", "params": {
  "sessionId": "sess-1"
}}

// Step into a suspicious function call
{ "tool": "step_into", "params": {
  "sessionId": "sess-1"
}}

// Step out when done inspecting this function
{ "tool": "step_out", "params": {
  "sessionId": "sess-1"
}}
```

### Binary Search with Breakpoints

For bugs in long functions or sequences, use a binary search approach:

1. Set a breakpoint at the midpoint of the suspicious region
2. Check if state is already corrupted at that point
3. If corrupted: the bug is before the midpoint — move the breakpoint earlier
4. If correct: the bug is after the midpoint — move the breakpoint later
5. Repeat until the exact line is found

```json
// Set breakpoint at midpoint
{ "tool": "set_breakpoint", "params": {
  "sessionId": "sess-1",
  "file": "src/pipeline.ts",
  "line": 50
}}

// After hitting it, evaluate the state
{ "tool": "evaluate_expression", "params": {
  "sessionId": "sess-1",
  "expression": "data.isValid",
  "frameId": 0
}}

// Move breakpoint based on result
{ "tool": "remove_breakpoint", "params": {
  "sessionId": "sess-1",
  "file": "src/pipeline.ts",
  "line": 50
}}

{ "tool": "set_breakpoint", "params": {
  "sessionId": "sess-1",
  "file": "src/pipeline.ts",
  "line": 25
}}
```

## Data Breakpoints

Use data breakpoints to pause when a specific variable is modified. This is useful for tracking unexpected mutations:

```json
{ "tool": "set_data_breakpoint", "params": {
  "sessionId": "sess-1",
  "dataId": "user.settings.theme",
  "accessType": "write"
}}
```

## Function Breakpoints

Break on entry to a function by name, without knowing its file or line:

```json
{ "tool": "set_function_breakpoint", "params": {
  "sessionId": "sess-1",
  "name": "processPayment",
  "condition": "amount > 1000"
}}
```

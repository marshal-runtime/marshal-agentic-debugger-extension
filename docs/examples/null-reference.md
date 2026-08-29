# Example: Debugging a Null Reference

This walkthrough demonstrates diagnosing a null reference error using the agentic debugger's MCP tools. The scenario uses a Node.js application, but the same approach applies to Python (`AttributeError: 'NoneType'`) and C# (`NullReferenceException`).

## The Buggy Code

```javascript
// user-service.js
function getUser(id) {
  const users = [
    { id: 1, name: 'Alice', address: { city: 'Portland' } },
    { id: 2, name: 'Bob', address: null },
    { id: 3, name: 'Carol', address: { city: 'Seattle' } },
  ];
  return users.find((u) => u.id === id);
}

function formatUserAddress(userId) {
  const user = getUser(userId);
  // Bug: user.address may be null, causing crash on .city access
  return `${user.name} lives in ${user.address.city}`;
}

console.log(formatUserAddress(2));
```

Running this program produces:

```
TypeError: Cannot read properties of null (reading 'city')
    at formatUserAddress (user-service.js:13:49)
    at Object.<anonymous> (user-service.js:16:13)
```

## Step-by-Step Debugging with MCP Tools

### Step 1: Set Exception Breakpoints

Before launching, configure the debugger to break on all uncaught exceptions so execution pauses at the crash site.

```json
// Tool: set_exception_breakpoints
{
  "sessionId": "session-1",
  "filters": ["uncaught"]
}
```

> **Note:** Call this after launching — the session must exist first. The step ordering here shows intent; the actual sequence starts with `launch_debug`.

### Step 2: Launch the Debug Session

```json
// Tool: launch_debug
{
  "program": "./user-service.js",
  "language": "javascript"
}
```

**Response:**

```json
{
  "sessionId": "session-1",
  "status": "running",
  "language": "javascript",
  "adapter": "js-debug"
}
```

### Step 3: Set Exception Breakpoints (after launch)

Now that the session exists, set the exception breakpoints:

```json
// Tool: set_exception_breakpoints
{
  "sessionId": "session-1",
  "filters": ["uncaught"]
}
```

**Response:**

```json
{
  "success": true,
  "filters": ["uncaught"]
}
```

### Step 4: Continue Execution

The program was launched with `stopOnEntry` defaulting to false, so it runs until the exception is hit. If it paused on entry, continue:

```json
// Tool: continue_execution
{
  "sessionId": "session-1"
}
```

The debugger pauses when the `TypeError` is thrown at line 13.

### Step 5: Get Exception Info

Inspect the exception details to understand the error:

```json
// Tool: get_exception_info
{
  "sessionId": "session-1",
  "threadId": 1
}
```

**Response:**

```json
{
  "exceptionId": "TypeError",
  "description": "Cannot read properties of null (reading 'city')",
  "breakMode": "unhandled",
  "details": {
    "message": "Cannot read properties of null (reading 'city')",
    "typeName": "TypeError",
    "stackTrace": "at formatUserAddress (user-service.js:13:49)\nat Object.<anonymous> (user-service.js:16:13)"
  }
}
```

The exception tells us: something is `null` and we tried to access `.city` on it.

### Step 6: Get the Call Stack

Examine where execution stopped:

```json
// Tool: get_call_stack
{
  "sessionId": "session-1",
  "threadId": 1
}
```

**Response:**

```json
{
  "stackFrames": [
    {
      "id": 1,
      "name": "formatUserAddress",
      "source": { "path": "/project/user-service.js" },
      "line": 13,
      "column": 49
    },
    {
      "id": 2,
      "name": "<anonymous>",
      "source": { "path": "/project/user-service.js" },
      "line": 16,
      "column": 13
    }
  ],
  "totalFrames": 2
}
```

The crash is in `formatUserAddress` at line 13, column 49 — the `.city` property access.

### Step 7: Get Scopes for the Crash Frame

```json
// Tool: get_scopes
{
  "sessionId": "session-1",
  "frameId": 1
}
```

**Response:**

```json
{
  "scopes": [
    { "name": "Local", "variablesReference": 100, "expensive": false },
    { "name": "Closure", "variablesReference": 101, "expensive": false },
    { "name": "Global", "variablesReference": 102, "expensive": true }
  ]
}
```

### Step 8: Inspect Local Variables

```json
// Tool: get_variables
{
  "sessionId": "session-1",
  "variablesReference": 100
}
```

**Response:**

```json
{
  "variables": [
    { "name": "userId", "value": "2", "type": "number" },
    { "name": "user", "value": "Object", "type": "object", "variablesReference": 200 }
  ]
}
```

### Step 9: Drill Into the User Object

```json
// Tool: get_variables
{
  "sessionId": "session-1",
  "variablesReference": 200
}
```

**Response:**

```json
{
  "variables": [
    { "name": "id", "value": "2", "type": "number" },
    { "name": "name", "value": "\"Bob\"", "type": "string" },
    { "name": "address", "value": "null", "type": "object" }
  ]
}
```

**Root cause found:** `user.address` is `null` for user Bob (id: 2). The code assumes every user has an address object.

### Step 10: Verify with Expression Evaluation

```json
// Tool: evaluate_expression
{
  "sessionId": "session-1",
  "expression": "user.address === null",
  "frameId": 1
}
```

**Response:**

```json
{
  "result": "true",
  "type": "boolean"
}
```

### Step 11: Clean Up

```json
// Tool: terminate
{
  "sessionId": "session-1"
}
```

## Root Cause and Fix

**Root cause:** `formatUserAddress` does not handle the case where `user.address` is `null`.

**Fix:**

```javascript
function formatUserAddress(userId) {
  const user = getUser(userId);
  if (!user) {
    return 'Unknown user';
  }
  if (!user.address) {
    return `${user.name} has no address on file`;
  }
  return `${user.name} lives in ${user.address.city}`;
}
```

## Key Takeaways

1. **Set exception breakpoints first** — `set_exception_breakpoints` with `["uncaught"]` catches null reference errors at the crash site
2. **Use `get_exception_info`** to read the error message and stack trace without scanning logs
3. **Drill into variables** with `get_scopes` → `get_variables` to trace the null value through the object graph
4. **Confirm hypotheses** with `evaluate_expression` before making changes

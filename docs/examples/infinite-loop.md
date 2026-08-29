# Example: Debugging an Infinite Loop

This walkthrough demonstrates diagnosing a hung program caused by an infinite loop. The key technique is **pausing** a running process and inspecting its state to understand why the loop never terminates.

## The Buggy Code

```javascript
// data-processor.js
function processRecords(records) {
  const results = [];
  let i = 0;

  while (i < records.length) {
    const record = records[i];

    if (record.status === 'pending') {
      results.push({ ...record, status: 'processed' });
      // Bug: missing i++ here — loop never advances for pending records
      continue;
    }

    results.push(record);
    i++;
  }

  return results;
}

const data = [
  { id: 1, status: 'done' },
  { id: 2, status: 'pending' },
  { id: 3, status: 'done' },
];

console.log('Processing...');
const output = processRecords(data);
console.log('Done:', output);
```

Running this program prints `Processing...` and then hangs indefinitely.

## Step-by-Step Debugging with MCP Tools

### Step 1: Launch the Program

Start the debug session. The program will begin running and hang at the loop.

```json
// Tool: launch_debug
{
  "program": "./data-processor.js",
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

The program starts and hangs — `Processing...` appears but `Done:` never does.

### Step 2: Pause Execution

Since the program is stuck, pause it to inspect the current state:

```json
// Tool: pause_execution
{
  "sessionId": "session-1"
}
```

**Response:**

```json
{
  "success": true
}
```

The debugger interrupts the running program and freezes execution at whatever line is currently executing.

### Step 3: Get the Call Stack

Find out where the program is stuck:

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
      "name": "processRecords",
      "source": { "path": "/project/data-processor.js" },
      "line": 8,
      "column": 5
    },
    {
      "id": 2,
      "name": "<anonymous>",
      "source": { "path": "/project/data-processor.js" },
      "line": 29,
      "column": 16
    }
  ],
  "totalFrames": 2
}
```

Execution is inside `processRecords` at line 8 — within the `while` loop body.

### Step 4: Inspect Loop Variables

Get the scopes and then inspect the local variables to understand the loop state:

```json
// Tool: get_scopes
{
  "sessionId": "session-1",
  "frameId": 1
}
```

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
    { "name": "records", "value": "Array(3)", "type": "object", "variablesReference": 200 },
    { "name": "results", "value": "Array(5812)", "type": "object", "variablesReference": 201 },
    { "name": "i", "value": "1", "type": "number" },
    { "name": "record", "value": "Object", "type": "object", "variablesReference": 202 }
  ]
}
```

Key observations:
- `i` is `1` — the loop index is stuck and never advancing past index 1
- `results` has **5,812 entries** — the loop has been adding the same record thousands of times
- `records` has only 3 items

### Step 5: Inspect the Current Record

```json
// Tool: get_variables
{
  "sessionId": "session-1",
  "variablesReference": 202
}
```

**Response:**

```json
{
  "variables": [
    { "name": "id", "value": "2", "type": "number" },
    { "name": "status", "value": "\"pending\"", "type": "string" }
  ]
}
```

The current record is `{ id: 2, status: 'pending' }` — the record at index 1.

### Step 6: Evaluate the Loop Condition

```json
// Tool: evaluate_expression
{
  "sessionId": "session-1",
  "expression": "i < records.length",
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

The loop condition is always `true` because `i` stays at `1` and `records.length` is `3`.

### Step 7: Confirm the Root Cause

Check that the `continue` statement skips the `i++`:

```json
// Tool: evaluate_expression
{
  "sessionId": "session-1",
  "expression": "record.status === 'pending'",
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

**Root cause found:** When `record.status === 'pending'`, the `continue` statement jumps back to the loop condition without incrementing `i`. The loop processes the same record forever.

### Step 8: Clean Up

```json
// Tool: terminate
{
  "sessionId": "session-1"
}
```

## Alternative: Attaching to an Already-Running Process

If the program is already running outside the debugger (e.g., a Node.js server that stopped responding), use `attach_debug` instead:

```bash
# Start the program with the inspect flag
node --inspect=9229 data-processor.js
```

```json
// Tool: attach_debug
{
  "port": 9229,
  "host": "localhost",
  "language": "javascript"
}
```

Then proceed with `pause_execution` → `get_call_stack` → `get_variables` as shown above.

## Root Cause and Fix

**Root cause:** The `continue` statement inside the `if (record.status === 'pending')` block skips the `i++` increment at the bottom of the loop.

**Fix:**

```javascript
while (i < records.length) {
  const record = records[i];

  if (record.status === 'pending') {
    results.push({ ...record, status: 'processed' });
  } else {
    results.push(record);
  }

  i++; // Always increment, regardless of record status
}
```

## Key Takeaways

1. **Use `pause_execution` for hung programs** — it interrupts the running process at the current instruction
2. **Check loop variables immediately** — `i` being stuck and `results` growing unbounded are clear signs of an infinite loop
3. **Use `evaluate_expression`** to test the loop condition and branch conditions interactively
4. **`attach_debug` works for external processes** — start Node.js with `--inspect`, Python with `debugpy`, or .NET with `dotnet run` and attach via port

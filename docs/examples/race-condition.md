# Example: Debugging a Race Condition

This walkthrough demonstrates debugging a race condition in multi-threaded code. The scenario uses a Python program with threads, but the debugging approach applies to any language with concurrent execution (C# `Task`/`Thread`, Node.js worker threads).

## The Buggy Code

```python
# bank_transfer.py
import threading
import time

balance = 1000

def withdraw(amount, label):
    global balance
    current = balance
    time.sleep(0.01)  # Simulate processing delay
    if current >= amount:
        balance = current - amount
        print(f"[{label}] Withdrew {amount}, balance: {balance}")
    else:
        print(f"[{label}] Insufficient funds: {current}")

def deposit(amount, label):
    global balance
    current = balance
    time.sleep(0.01)  # Simulate processing delay
    balance = current + amount
    print(f"[{label}] Deposited {amount}, balance: {balance}")

# Two concurrent withdrawals of 800 from a balance of 1000
t1 = threading.Thread(target=withdraw, args=(800, "Thread-1"))
t2 = threading.Thread(target=withdraw, args=(800, "Thread-2"))

t1.start()
t2.start()
t1.join()
t2.join()

print(f"Final balance: {balance}")
# Expected: one withdrawal succeeds, one fails (balance >= 0)
# Actual: both succeed, balance becomes -600
```

The race condition: both threads read `balance = 1000` before either writes, so both pass the `current >= amount` check.

## Step-by-Step Debugging with MCP Tools

### Step 1: Launch the Debug Session

```json
// Tool: launch_debug
{
  "program": "./bank_transfer.py",
  "language": "python",
  "stopOnEntry": true
}
```

**Response:**

```json
{
  "sessionId": "session-1",
  "status": "paused",
  "language": "python",
  "adapter": "debugpy"
}
```

### Step 2: Set Breakpoints in the Critical Section

Place breakpoints where the shared state is read and written in both functions:

```json
// Tool: set_breakpoint
{
  "sessionId": "session-1",
  "file": "bank_transfer.py",
  "line": 9
}
```

Line 9 (`current = balance`) is where each thread reads the shared variable.

```json
// Tool: set_breakpoint
{
  "sessionId": "session-1",
  "file": "bank_transfer.py",
  "line": 12
}
```

Line 12 (`balance = current - amount`) is where the thread writes back.

### Step 3: Continue to Let Threads Start

```json
// Tool: continue_execution
{
  "sessionId": "session-1"
}
```

Execution continues until one of the threads hits the breakpoint at line 9.

### Step 4: List All Threads

```json
// Tool: get_threads
{
  "sessionId": "session-1"
}
```

**Response:**

```json
{
  "threads": [
    { "id": 1, "name": "MainThread" },
    { "id": 2, "name": "Thread-1" },
    { "id": 3, "name": "Thread-2" }
  ]
}
```

Three threads are visible: the main thread (waiting on `join()`) and the two worker threads.

### Step 5: Inspect Thread-1 State

Get the call stack for Thread-1 to confirm it hit the breakpoint:

```json
// Tool: get_call_stack
{
  "sessionId": "session-1",
  "threadId": 2
}
```

**Response:**

```json
{
  "stackFrames": [
    {
      "id": 10,
      "name": "withdraw",
      "source": { "path": "/project/bank_transfer.py" },
      "line": 9,
      "column": 0
    }
  ],
  "totalFrames": 1
}
```

Thread-1 is paused at line 9 (`current = balance`), about to read the shared balance.

### Step 6: Check the Balance Before Thread-1 Reads

```json
// Tool: evaluate_expression
{
  "sessionId": "session-1",
  "expression": "balance",
  "frameId": 10
}
```

**Response:**

```json
{
  "result": "1000",
  "type": "int"
}
```

The global `balance` is `1000` — Thread-1 will read this value.

### Step 7: Step Thread-1 Past the Read

```json
// Tool: step_over
{
  "sessionId": "session-1",
  "threadId": 2
}
```

Thread-1 executes `current = balance`, storing `1000` in its local `current`.

### Step 8: Continue to Let Thread-2 Hit the Breakpoint

```json
// Tool: continue_execution
{
  "sessionId": "session-1"
}
```

Thread-2 now hits the same breakpoint at line 9.

### Step 9: Inspect Thread-2 State

```json
// Tool: get_call_stack
{
  "sessionId": "session-1",
  "threadId": 3
}
```

**Response:**

```json
{
  "stackFrames": [
    {
      "id": 20,
      "name": "withdraw",
      "source": { "path": "/project/bank_transfer.py" },
      "line": 9,
      "column": 0
    }
  ],
  "totalFrames": 1
}
```

### Step 10: Check Balance — Still 1000

```json
// Tool: evaluate_expression
{
  "sessionId": "session-1",
  "expression": "balance",
  "frameId": 20
}
```

**Response:**

```json
{
  "result": "1000",
  "type": "int"
}
```

**The race condition is visible:** Thread-1 already read `balance = 1000` into its local `current`, but hasn't written back yet. Thread-2 also sees `balance = 1000`. Both threads will pass the `current >= amount` check.

### Step 11: Verify Both Threads Have Stale Reads

Check Thread-1's local variable (it should already have `current = 1000`):

```json
// Tool: get_call_stack
{
  "sessionId": "session-1",
  "threadId": 2
}
```

```json
// Tool: get_scopes
{
  "sessionId": "session-1",
  "frameId": 10
}
```

```json
// Tool: get_variables
{
  "sessionId": "session-1",
  "variablesReference": 300
}
```

**Response:**

```json
{
  "variables": [
    { "name": "amount", "value": "800", "type": "int" },
    { "name": "label", "value": "'Thread-1'", "type": "str" },
    { "name": "current", "value": "1000", "type": "int" }
  ]
}
```

Thread-1 has `current = 1000`. Thread-2 is about to set its own `current = 1000`. Both will proceed to withdraw 800, resulting in `balance = 1000 - 800 = 200` written twice — but the second write overwrites the first, giving a final balance of `200` instead of the correct `-600` (or properly, only one withdrawal should succeed).

### Step 12: Clean Up

```json
// Tool: terminate
{
  "sessionId": "session-1"
}
```

## Root Cause and Fix

**Root cause:** The read-modify-write sequence (`current = balance` → check → `balance = current - amount`) is not atomic. Both threads read the same value before either writes, so the balance check passes for both.

**Fix — use a lock:**

```python
import threading

balance = 1000
lock = threading.Lock()

def withdraw(amount, label):
    global balance
    with lock:
        if balance >= amount:
            balance -= amount
            print(f"[{label}] Withdrew {amount}, balance: {balance}")
        else:
            print(f"[{label}] Insufficient funds: {balance}")
```

## Key Takeaways

1. **Use `get_threads`** to see all active threads and identify which ones are competing for shared state
2. **Set breakpoints at shared state access points** — both reads and writes to shared variables
3. **Step one thread at a time** — use `step_over` with a specific `threadId` to control execution order and expose the race window
4. **Compare thread-local state** — use `get_variables` and `evaluate_expression` on different threads' frames to see stale reads
5. **The race window is the gap** between reading shared state and writing it back — if another thread can interleave in that window, there is a race condition

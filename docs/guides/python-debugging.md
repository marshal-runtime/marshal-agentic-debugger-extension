# Python Debugging Guide

Debugging Python applications with `agentic-debugger` using the **debugpy** adapter. This guide covers installation, virtual environment setup, Django/Flask debugging, and common pitfalls.

## Prerequisites

| Requirement | Minimum Version | Notes |
|-------------|-----------------|-------|
| Python | 3.8+ | CPython recommended; PyPy has limited support |
| debugpy | 1.6+ | DAP server for Python |
| pip | 21+ | For installing debugpy |

## Installing debugpy

debugpy is Microsoft's Debug Adapter Protocol implementation for Python. Install it into the environment you intend to debug.

### pip install

```bash
pip install debugpy
```

Or with a specific Python:

```bash
python3 -m pip install debugpy
```

### Verify installation

```bash
python3 -m debugpy --version
```

### Version requirements

| debugpy version | Python support | Notes |
|-----------------|----------------|-------|
| 1.6.x | 3.7–3.11 | Stable baseline |
| 1.7.x | 3.8–3.12 | Recommended |
| 1.8.x+ | 3.8–3.13 | Latest features |

> **Important:** Install debugpy into the same environment as your project dependencies. The debugger launches Python from that environment.

## Virtual Environments

### Why virtual environments matter

The debugpy adapter needs to invoke the correct Python interpreter — the one inside your project's virtual environment. If it uses the system Python, your project's dependencies will not be available and imports will fail at runtime.

### Configuring the Python path

The adapter resolves the Python binary in this order:

1. `AGENTIC_PYTHON_PATH` environment variable (highest priority)
2. `python3` on PATH (Unix)
3. `python` on PATH (Windows fallback)

#### Using `AGENTIC_PYTHON_PATH`

Set this to point directly at your venv's interpreter:

**Linux / macOS:**
```bash
export AGENTIC_PYTHON_PATH=/path/to/project/.venv/bin/python
agentic-debugger launch app.py
```

**Windows (cmd):**
```cmd
set AGENTIC_PYTHON_PATH=C:\path\to\project\.venv\Scripts\python.exe
agentic-debugger launch app.py
```

**Windows (PowerShell):**
```powershell
$env:AGENTIC_PYTHON_PATH = "C:\path\to\project\.venv\Scripts\python.exe"
agentic-debugger launch app.py
```

#### Activating the venv first

Alternatively, activate the virtual environment before launching. The adapter will find the activated Python on PATH:

```bash
source .venv/bin/activate
agentic-debugger launch app.py
```

### Common virtual environment tools

| Tool | Interpreter location | Example |
|------|----------------------|---------|
| `venv` | `.venv/bin/python` (Unix), `.venv\Scripts\python.exe` (Windows) | `python3 -m venv .venv` |
| `virtualenv` | Same as `venv` | `virtualenv .venv` |
| `conda` | `<conda-env>/bin/python` (Unix), `<conda-env>\python.exe` (Windows) | `conda activate myenv` |
| `poetry` | `.venv/bin/python` (if `in-project = true`) | `poetry shell` |
| `pipenv` | `~/.local/share/virtualenvs/<hash>/bin/python` | `pipenv shell` |

## Launching a Debug Session

### CLI

Debug a Python script:

```bash
agentic-debugger launch app.py
```

Pass arguments to the script:

```bash
agentic-debugger launch app.py -- --config config.yaml --verbose
```

Stop on the first line:

```bash
agentic-debugger launch app.py --stop-on-entry
```

Debug a module:

```bash
agentic-debugger launch -m mypackage.main
```

### MCP tool

```json
{
  "tool": "launch_debug",
  "arguments": {
    "program": "app.py",
    "language": "python",
    "args": ["--config", "config.yaml"],
    "stopOnEntry": true
  }
}
```

## Attaching to a Running Process

### Start the process with debugpy listening

Add this to the top of your script or entry point:

```python
import debugpy

debugpy.listen(("localhost", 5678))
print("Waiting for debugger to attach...")
debugpy.wait_for_client()
```

Or run as a module:

```bash
python3 -m debugpy --listen localhost:5678 --wait-for-client app.py
```

### CLI

```bash
agentic-debugger attach --language python --host localhost --port 5678
```

### MCP tool

```json
{
  "tool": "attach_debug",
  "arguments": {
    "language": "python",
    "host": "localhost",
    "port": 5678
  }
}
```

The default attach port for debugpy is **5678**.

## Django Debugging

### Setup

1. Install debugpy in your Django project's virtual environment:
   ```bash
   pip install debugpy
   ```

2. Launch the Django development server under the debugger:
   ```bash
   agentic-debugger launch manage.py -- runserver --noreload
   ```

   > **Important:** Use `--noreload` to prevent Django's auto-reloader from spawning a child process that the debugger cannot attach to.

### MCP tool

```json
{
  "tool": "launch_debug",
  "arguments": {
    "program": "manage.py",
    "language": "python",
    "args": ["runserver", "--noreload"],
    "cwd": "/path/to/django-project"
  }
}
```

### Setting breakpoints in views

#### CLI

```bash
agentic-debugger breakpoint set --file myapp/views.py --line 42 --session <sessionId>
```

#### MCP tool

```json
{
  "tool": "set_breakpoint",
  "arguments": {
    "sessionId": "<sessionId>",
    "file": "myapp/views.py",
    "line": 42
  }
}
```

### Conditional breakpoints

Break only when a specific user is making the request:

```json
{
  "tool": "set_breakpoint",
  "arguments": {
    "sessionId": "<sessionId>",
    "file": "myapp/views.py",
    "line": 42,
    "condition": "request.user.username == 'admin'"
  }
}
```

### Attach to a running Django server

If Django is already running, add debugpy to `manage.py`:

```python
import debugpy
debugpy.listen(("0.0.0.0", 5678))
```

Then attach:

```bash
agentic-debugger attach --language python --port 5678
```

## Flask Debugging

### Setup

1. Install debugpy:
   ```bash
   pip install debugpy
   ```

2. Launch Flask under the debugger:
   ```bash
   agentic-debugger launch app.py
   ```

   If Flask uses the `flask run` command:
   ```bash
   agentic-debugger launch -m flask -- run --no-reload
   ```

   > **Important:** Use `--no-reload` to prevent Flask's reloader from interfering with the debug session.

### MCP tool

```json
{
  "tool": "launch_debug",
  "arguments": {
    "program": "app.py",
    "language": "python",
    "cwd": "/path/to/flask-project"
  }
}
```

### Debugging Flask with factory pattern

If your app uses the factory pattern (`create_app()`), create a launch script:

```python
# debug_entry.py
from myapp import create_app

app = create_app()
app.run(debug=False, use_reloader=False, port=5000)
```

```bash
agentic-debugger launch debug_entry.py
```

> Set `debug=False` in `app.run()` — the debugger itself provides debugging. Flask's built-in debug mode enables the reloader, which conflicts with DAP.

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
    "depth": 3
  }
}
```

### Evaluate expressions

#### CLI

```bash
agentic-debugger evaluate --session <sessionId> --expression "len(users)"
```

#### MCP tool

```json
{
  "tool": "evaluate",
  "arguments": {
    "sessionId": "<sessionId>",
    "expression": "[u.name for u in users if u.active]",
    "context": "repl"
  }
}
```

### Watch expressions

```bash
agentic-debugger watch --session <sessionId> --action add --expression "request.method"
agentic-debugger watch --session <sessionId> --action evaluate
```

## Exception Handling

### Break on all exceptions

#### CLI

```bash
agentic-debugger exception-breakpoints --session <sessionId> --filters all
```

#### MCP tool

```json
{
  "tool": "set_exception_breakpoints",
  "arguments": {
    "sessionId": "<sessionId>",
    "filters": ["all"]
  }
}
```

### Break only on uncaught exceptions

```json
{
  "tool": "set_exception_breakpoints",
  "arguments": {
    "sessionId": "<sessionId>",
    "filters": ["uncaught"]
  }
}
```

### Inspecting exception details

When stopped at an exception, evaluate the exception object:

```bash
agentic-debugger evaluate --session <sessionId> --expression "str(e)"
agentic-debugger evaluate --session <sessionId> --expression "e.__traceback__"
```

## Adapter Configuration Reference

The debugpy adapter uses DAP type `python`. Key configuration fields:

### Launch configuration

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"python"` | Adapter type (set automatically) |
| `request` | `"launch"` | Launch mode |
| `program` | `string` | Path to the Python script |
| `pythonPath` | `string` | Path to the Python interpreter |
| `cwd` | `string` | Working directory |
| `args` | `string[]` | Arguments for the script |

### Attach configuration

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"python"` | Adapter type (set automatically) |
| `request` | `"attach"` | Attach mode |
| `connect.host` | `string` | Host where debugpy is listening (default: `"localhost"`) |
| `connect.port` | `number` | Port where debugpy is listening (default: `5678`) |

### Python binary resolution

The adapter resolves the Python interpreter using this precedence:

1. `AGENTIC_PYTHON_PATH` environment variable
2. `python3` on PATH (Unix)
3. `python` on PATH (Windows)

## Remote Debugging

### Debugging on a remote server

1. On the remote machine, start your script with debugpy listening on all interfaces:
   ```bash
   python3 -m debugpy --listen 0.0.0.0:5678 --wait-for-client app.py
   ```

2. From your local machine, attach:
   ```bash
   agentic-debugger attach --language python --host remote-server.example.com --port 5678
   ```

### SSH tunnel approach

For security, tunnel the debug port over SSH instead of exposing it:

```bash
ssh -L 5678:localhost:5678 user@remote-server.example.com
```

Then attach to `localhost:5678` locally:

```bash
agentic-debugger attach --language python --host localhost --port 5678
```

### Docker containers

Add debugpy to your container and expose the debug port:

```dockerfile
RUN pip install debugpy
EXPOSE 5678
CMD ["python3", "-m", "debugpy", "--listen", "0.0.0.0:5678", "app.py"]
```

```bash
docker run -p 5678:5678 myapp
agentic-debugger attach --language python --port 5678
```

## Common Pitfalls and Solutions

### `ModuleNotFoundError` when debugging

**Symptom:** The debugger launches but the script fails with `ModuleNotFoundError`.

**Cause:** The debugger is using the wrong Python interpreter — typically the system Python instead of your virtual environment.

**Fix:** Set `AGENTIC_PYTHON_PATH` to the venv interpreter, or activate the venv before launching:

```bash
export AGENTIC_PYTHON_PATH=.venv/bin/python
agentic-debugger launch app.py
```

### `sys.path` issues

**Symptom:** Imports work when running normally but fail under the debugger.

**Fix:** Ensure `cwd` is set to the project root. debugpy adds `cwd` to `sys.path`. You can also verify:

```bash
agentic-debugger evaluate --session <sessionId> --expression "import sys; sys.path"
```

### `__pycache__` and bytecode stale data

**Symptom:** Breakpoints hit on wrong lines, or changes to source code are not reflected.

**Cause:** Python caches compiled bytecode in `__pycache__/` directories. Stale `.pyc` files can cause line number mismatches.

**Fix:** Delete the cache and restart:

```bash
find . -type d -name __pycache__ -exec rm -rf {} +
agentic-debugger launch app.py
```

On Windows:

```cmd
for /d /r . %d in (__pycache__) do @if exist "%d" rd /s /q "%d"
```

### Django reloader conflicts

**Symptom:** Debug session starts but breakpoints are never hit, or the session disconnects immediately.

**Cause:** Django's auto-reloader spawns a child process. The debugger attaches to the parent, which exits while the child handles requests.

**Fix:** Always use `--noreload`:

```bash
agentic-debugger launch manage.py -- runserver --noreload
```

### Flask reloader conflicts

**Symptom:** Same as Django — session disconnects or breakpoints are missed.

**Fix:** Use `--no-reload` with `flask run`, or set `use_reloader=False` in `app.run()`.

### Breakpoints not hit in decorators

**Symptom:** Breakpoints on decorated functions don't trigger.

**Cause:** The decorator may wrap the function, changing its code object.

**Fix:** Set the breakpoint inside the function body, not on the `@decorator` line. For `@staticmethod` or `@classmethod`, set the breakpoint on the first line of the method body.

### `ConnectionRefusedError` on attach

**Symptom:** `agentic-debugger attach` fails with connection refused.

**Causes and fixes:**

1. **debugpy not started yet** — Ensure `debugpy.listen()` runs before you attach.
2. **Wrong port** — Verify the port matches (default: `5678`).
3. **Firewall blocking** — Check firewall rules, especially for remote debugging.
4. **Host mismatch** — If debugpy listens on `127.0.0.1`, you cannot attach from another machine. Use `0.0.0.0`.

### Debugging multi-threaded Python

**Symptom:** Breakpoints in threads are missed.

**Fix:** debugpy supports multi-threaded debugging. Ensure threads are started after `debugpy.listen()`. List threads:

```bash
agentic-debugger threads --session <sessionId>
```

Each Python thread appears as a separate DAP thread. Set breakpoints normally; they apply across all threads.

### Debugging multiprocessing

**Symptom:** Child processes spawned via `multiprocessing` are not debugged.

**Fix:** debugpy supports subprocess debugging. The adapter automatically attaches to child processes when using `multiprocessing.Process()`. For `multiprocessing.Pool()`, breakpoints in the worker function are hit in the child process threads.

> **Note:** On Windows, `multiprocessing` uses `spawn` by default. Ensure the child process entry point is guarded by `if __name__ == '__main__':`.

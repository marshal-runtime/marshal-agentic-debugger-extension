# C# / .NET Debugging Guide

Debugging C# and .NET applications with `agentic-debugger` using the **netcoredbg** adapter. This guide covers installation, DLL vs executable debugging, async/await patterns, and common pitfalls.

## Prerequisites

| Requirement | Minimum Version | Notes |
|-------------|-----------------|-------|
| .NET SDK | 6.0+ | Required for building and running .NET apps |
| netcoredbg | 2.2+ | Open-source DAP server for .NET Core |

## Installing netcoredbg

netcoredbg is Samsung's open-source debugger for .NET Core. It implements the Debug Adapter Protocol and communicates with the .NET runtime's debugging APIs.

### Package managers

**macOS (Homebrew):**
```bash
brew install netcoredbg
```

**Linux (apt — Ubuntu/Debian):**
```bash
# Download from GitHub releases
curl -L https://github.com/Samsung/netcoredbg/releases/latest/download/netcoredbg-linux-amd64.tar.gz -o netcoredbg.tar.gz
tar xzf netcoredbg.tar.gz
sudo mv netcoredbg /usr/local/bin/
```

**Windows (scoop):**
```powershell
scoop install netcoredbg
```

**Windows (manual):**

Download the latest release from [GitHub](https://github.com/Samsung/netcoredbg/releases) and extract `netcoredbg.exe` to a directory on your PATH.

### Build from source

```bash
git clone https://github.com/Samsung/netcoredbg.git
cd netcoredbg
mkdir build && cd build
cmake .. -DCMAKE_INSTALL_PREFIX=/usr/local
cmake --build . --config Release
sudo cmake --install .
```

### Verify installation

```bash
netcoredbg --version
```

### Platform-specific locations

The adapter checks these well-known paths when resolving the binary:

| Platform | Default locations |
|----------|-------------------|
| Windows | `%LOCALAPPDATA%\netcoredbg\netcoredbg.exe` |
| macOS | `/usr/local/bin/netcoredbg` |
| Linux | `/usr/local/bin/netcoredbg`, `/usr/bin/netcoredbg` |

### Overriding the binary path

Set the `AGENTIC_NETCOREDBG_PATH` environment variable to use a specific netcoredbg binary:

**Linux / macOS:**
```bash
export AGENTIC_NETCOREDBG_PATH=/opt/netcoredbg/netcoredbg
```

**Windows (cmd):**
```cmd
set AGENTIC_NETCOREDBG_PATH=C:\tools\netcoredbg\netcoredbg.exe
```

**Windows (PowerShell):**
```powershell
$env:AGENTIC_NETCOREDBG_PATH = "C:\tools\netcoredbg\netcoredbg.exe"
```

## DLL vs Executable

.NET applications can be launched as either self-contained executables or framework-dependent DLLs. The debugger handles both, but the `program` path differs.

### Framework-dependent DLL

Most .NET projects produce a DLL that requires the `dotnet` runtime:

```bash
dotnet build
agentic-debugger launch bin/Debug/net8.0/MyApp.dll
```

The adapter invokes `dotnet exec MyApp.dll` under the hood.

### Self-contained executable

If published as a self-contained app:

```bash
dotnet publish -c Debug -r linux-x64 --self-contained
agentic-debugger launch bin/Debug/net8.0/linux-x64/publish/MyApp
```

### How to tell which you have

| Output | Type | Debug command |
|--------|------|---------------|
| `bin/Debug/net8.0/MyApp.dll` | Framework-dependent | `agentic-debugger launch MyApp.dll` |
| `bin/Debug/net8.0/MyApp` (no extension) | Self-contained (Unix) | `agentic-debugger launch MyApp` |
| `bin/Debug/net8.0/MyApp.exe` | Self-contained (Windows) | `agentic-debugger launch MyApp.exe` |

> **Important:** Always build in `Debug` configuration. The `Release` configuration enables optimizations that interfere with debugging (see [Common Pitfalls](#optimized-code-debugging)).

## Launching a Debug Session

### CLI

Debug a .NET DLL:

```bash
agentic-debugger launch bin/Debug/net8.0/MyApp.dll
```

Pass arguments to the application:

```bash
agentic-debugger launch bin/Debug/net8.0/MyApp.dll -- --config appsettings.json
```

Stop on the first line:

```bash
agentic-debugger launch bin/Debug/net8.0/MyApp.dll --stop-on-entry
```

### MCP tool

```json
{
  "tool": "launch_debug",
  "arguments": {
    "program": "bin/Debug/net8.0/MyApp.dll",
    "language": "csharp",
    "args": ["--config", "appsettings.json"],
    "stopOnEntry": true
  }
}
```

### Specifying the working directory

```json
{
  "tool": "launch_debug",
  "arguments": {
    "program": "bin/Debug/net8.0/MyApp.dll",
    "language": "csharp",
    "cwd": "/path/to/project"
  }
}
```

## Attaching to a Running Process

### CLI

Attach by process ID:

```bash
agentic-debugger attach --language csharp --pid 12345
```

### MCP tool

```json
{
  "tool": "attach_debug",
  "arguments": {
    "language": "csharp",
    "pid": 12345
  }
}
```

### Finding the process ID

On Linux/macOS:
```bash
ps aux | grep dotnet
```

On Windows:
```cmd
tasklist /fi "imagename eq dotnet.exe"
```

Or use `dotnet` tools:
```bash
dotnet-trace list-processes
```

## Setting Breakpoints

### Line breakpoints

#### CLI

```bash
agentic-debugger breakpoint set --file src/Services/UserService.cs --line 42 --session <sessionId>
```

#### MCP tool

```json
{
  "tool": "set_breakpoint",
  "arguments": {
    "sessionId": "<sessionId>",
    "file": "src/Services/UserService.cs",
    "line": 42
  }
}
```

### Conditional breakpoints

Break only when a condition is true:

```json
{
  "tool": "set_breakpoint",
  "arguments": {
    "sessionId": "<sessionId>",
    "file": "src/Services/UserService.cs",
    "line": 42,
    "condition": "user.Id == 5"
  }
}
```

### Function breakpoints

Break when a method is entered:

```json
{
  "tool": "set_function_breakpoint",
  "arguments": {
    "sessionId": "<sessionId>",
    "name": "UserService.GetUser"
  }
}
```

### Logpoints

Log a message without stopping:

```json
{
  "tool": "set_breakpoint",
  "arguments": {
    "sessionId": "<sessionId>",
    "file": "src/Services/UserService.cs",
    "line": 42,
    "logMessage": "GetUser called with id={user.Id}"
  }
}
```

## Async/Await Debugging

C# uses `Task`-based asynchronous programming. Debugging async code requires understanding how the runtime schedules continuations.

### Stepping through async methods

When stopped at an `await` expression, **step over** resumes until the awaited task completes and the continuation runs:

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

**Step into** enters the async method being awaited:

```json
{
  "tool": "step_into",
  "arguments": {
    "sessionId": "<sessionId>"
  }
}
```

### Inspecting task state

Evaluate the state of a `Task` variable:

```bash
agentic-debugger evaluate --session <sessionId> --expression "myTask.Status"
agentic-debugger evaluate --session <sessionId> --expression "myTask.IsCompleted"
```

### Diagnosing deadlocks

A common async deadlock occurs when synchronously waiting on an async method (e.g., `.Result` or `.Wait()` on a `Task`):

```csharp
// DEADLOCK: blocks the thread that the continuation needs
var result = GetDataAsync().Result;
```

**Diagnosis steps:**

1. Pause all threads:
   ```bash
   agentic-debugger pause --session <sessionId>
   ```

2. List all threads:
   ```bash
   agentic-debugger threads --session <sessionId>
   ```

3. Inspect the call stack of each thread:
   ```bash
   agentic-debugger callstack --session <sessionId> --thread <threadId>
   ```

4. Look for frames showing `Task.Wait()`, `Task.Result`, or `ManualResetEventSlim.Wait`. These indicate synchronous blocking on an async path.

**Fix:** Replace `.Result` / `.Wait()` with `await`:
```csharp
var result = await GetDataAsync();
```

### Async exception handling

Exceptions in async methods are captured inside the `Task` and re-thrown when awaited. To catch them at throw time, enable exception breakpoints:

```json
{
  "tool": "set_exception_breakpoints",
  "arguments": {
    "sessionId": "<sessionId>",
    "filters": ["all"]
  }
}
```

When an exception is caught, inspect it:

```bash
agentic-debugger evaluate --session <sessionId> --expression "$exception.Message"
agentic-debugger evaluate --session <sessionId> --expression "$exception.StackTrace"
```

> **Tip:** `$exception` is a special debugger variable that references the current exception in .NET.

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
agentic-debugger evaluate --session <sessionId> --expression "users.Count"
```

#### MCP tool

```json
{
  "tool": "evaluate",
  "arguments": {
    "sessionId": "<sessionId>",
    "expression": "users.Where(u => u.Active).ToList()",
    "context": "repl"
  }
}
```

### Watch expressions

```bash
agentic-debugger watch --session <sessionId> --action add --expression "request.Path"
agentic-debugger watch --session <sessionId> --action evaluate
```

## ASP.NET Core Debugging

### Launch an ASP.NET Core application

Build and debug:

```bash
dotnet build
agentic-debugger launch bin/Debug/net8.0/MyWebApp.dll
```

### MCP tool

```json
{
  "tool": "launch_debug",
  "arguments": {
    "program": "bin/Debug/net8.0/MyWebApp.dll",
    "language": "csharp",
    "cwd": "/path/to/webproject"
  }
}
```

### Setting breakpoints in controllers

```json
{
  "tool": "set_breakpoint",
  "arguments": {
    "sessionId": "<sessionId>",
    "file": "Controllers/UsersController.cs",
    "line": 28
  }
}
```

Send a request to the endpoint to trigger the breakpoint:

```bash
curl http://localhost:5000/api/users
```

### Debugging middleware

Set breakpoints in middleware classes the same way. Middleware executes in pipeline order, so breakpoints trigger on every request that passes through.

## Adapter Configuration Reference

The netcoredbg adapter uses DAP type `coreclr`. It communicates via stdio with the `--interpreter=vscode` flag.

### Launch configuration

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"coreclr"` | Adapter type (set automatically) |
| `request` | `"launch"` | Launch mode |
| `program` | `string` | Path to the DLL or executable |
| `cwd` | `string` | Working directory |
| `args` | `string[]` | Arguments for the application |

### Attach configuration

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"coreclr"` | Adapter type (set automatically) |
| `request` | `"attach"` | Attach mode |
| `processId` | `number` | Process ID to attach to |

### Additional DAP options

These options can be passed through the adapter configuration:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `justMyCode` | `boolean` | `true` | Skip framework and library code |
| `stopAtEntry` | `boolean` | `false` | Break on the first line of user code |
| `enableStepFiltering` | `boolean` | `true` | Skip property accessors and operators when stepping |

## Multi-Project Solutions

### Debugging a specific project

In a solution with multiple projects, build and specify the target project's output:

```bash
dotnet build src/MyApp/MyApp.csproj
agentic-debugger launch src/MyApp/bin/Debug/net8.0/MyApp.dll
```

### Setting breakpoints across projects

Breakpoints can be set in any source file within the solution. The debugger resolves them as long as the PDB files are available:

```bash
agentic-debugger breakpoint set --file src/MyLibrary/Calculator.cs --line 15 --session <sessionId>
```

### Class library debugging

To debug a class library, you need an executable host. Create a console app that references the library, then debug the console app:

```bash
dotnet build tests/MyApp.Tests/MyApp.Tests.csproj
agentic-debugger launch tests/MyApp.Tests/bin/Debug/net8.0/MyApp.Tests.dll
```

## Common Pitfalls and Solutions

### Missing PDB files

**Symptom:** Breakpoints show as unverified or never hit.

**Cause:** PDB (Program Database) files contain the debug symbols that map compiled IL to source lines. Without them, the debugger cannot set breakpoints.

**Fixes:**

1. Build in `Debug` configuration: `dotnet build -c Debug`
2. Verify PDB files exist alongside the DLL: `ls bin/Debug/net8.0/*.pdb`
3. For `Release` builds, enable portable PDBs in the `.csproj`:
   ```xml
   <PropertyGroup>
     <DebugType>portable</DebugType>
     <DebugSymbols>true</DebugSymbols>
   </PropertyGroup>
   ```

### Optimized code debugging

**Symptom:** Variables show as "optimized away", stepping skips lines, or breakpoints move to unexpected locations.

**Cause:** The `Release` configuration enables JIT optimizations that inline methods, reorder instructions, and eliminate variables.

**Fix:** Always debug with the `Debug` configuration:

```bash
dotnet build -c Debug
```

If you must debug a `Release` build, disable optimization in the `.csproj`:

```xml
<PropertyGroup Condition="'$(Configuration)' == 'Release'">
  <Optimize>false</Optimize>
  <DebugType>portable</DebugType>
</PropertyGroup>
```

### `justMyCode` hiding relevant frames

**Symptom:** The call stack shows `[External Code]` frames, hiding framework calls you need to inspect.

**Fix:** Disable `justMyCode` to see all frames including .NET framework and NuGet package code. This is useful when debugging framework interactions.

### Breakpoints in `async` state machine

**Symptom:** Breakpoints in async methods land on the state machine's `MoveNext()` method instead of the original source line.

**Cause:** The C# compiler transforms async methods into state machines. The debugger maps back to source, but stale PDBs can break this mapping.

**Fix:** Clean and rebuild:

```bash
dotnet clean
dotnet build -c Debug
```

### Process exits immediately

**Symptom:** The debug session starts and immediately ends.

**Causes and fixes:**

1. **Console app completes instantly** — Add a wait or use `--stop-on-entry`:
   ```bash
   agentic-debugger launch bin/Debug/net8.0/MyApp.dll --stop-on-entry
   ```

2. **Unhandled exception on startup** — Enable exception breakpoints to catch it:
   ```json
   {
     "tool": "set_exception_breakpoints",
     "arguments": {
       "sessionId": "<sessionId>",
       "filters": ["all"]
     }
   }
   ```

3. **Wrong DLL path** — Verify the path points to the application DLL, not a class library DLL.

### Wrong .NET runtime version

**Symptom:** `The framework 'Microsoft.NETCore.App', version 'X.Y.Z' was not found`.

**Fix:** Install the required .NET SDK version, or update the `TargetFramework` in the `.csproj`:

```bash
dotnet --list-sdks
dotnet --list-runtimes
```

### Debugging unit tests

To debug a specific test, use the test project's DLL with a test runner filter:

```bash
dotnet build tests/MyApp.Tests
agentic-debugger launch tests/MyApp.Tests/bin/Debug/net8.0/MyApp.Tests.dll -- --filter "FullyQualifiedName~MyTestMethod"
```

Set breakpoints in the test method before running.

### Source files not found

**Symptom:** Debugger reports "source not available" even though the PDB is present.

**Cause:** PDB files store absolute paths to source files. If the project was built on a different machine or in a CI pipeline, the paths won't match.

**Fixes:**

1. Rebuild locally: `dotnet build -c Debug`
2. For CI-built artifacts, enable deterministic builds and source link:
   ```xml
   <PropertyGroup>
     <Deterministic>true</Deterministic>
     <EmbedAllSources>true</EmbedAllSources>
   </PropertyGroup>
   ```

### Multi-targeting issues

**Symptom:** Application runs under the wrong framework version.

**Fix:** Specify the target framework explicitly:

```bash
dotnet build -c Debug -f net8.0
agentic-debugger launch bin/Debug/net8.0/MyApp.dll
```

For projects that target multiple frameworks (e.g., `net6.0;net8.0`), ensure you debug the correct output directory.

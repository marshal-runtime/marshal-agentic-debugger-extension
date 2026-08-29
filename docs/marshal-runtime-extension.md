# Marshal Runtime Extension Setup

## Contract

`runtime-extension.json` uses Marshal schema version 1, identity `@marshal/agentic-debugger-extension`, module format `commonjs-bundle-v1`, and entrypoint `dist/runtime-extension.cjs`. The entrypoint exports `activate(context)` and has no private Marshal imports.

Activation contributes:

- one capability provider with the 31 existing debugger operations plus runtime-native session, event, source, adapter, and UI-selection operations;
- one `RuntimeExtensionUiApplication` with render ID `marshal.agentic-debugger.v1`;
- disposal that clears scope registries, listeners, native adapter sessions, and UI bridge state.

The source-level contract shims in `src/runtime/contracts.ts` mirror the public `@marshal/runtime`, `@marshal/runtime/extensions`, and `@marshal/runtime/ui` shapes. They avoid a build-time dependency on Marshal's packed or private application packages.

### Injectable debugger service

The extension publishes the injectable service
`@marshal/agentic-debugger:debugger` (canonical `TypeSymbols.debugger`). A
Runtime TypeScript block obtains it through `AppServices.getDebugger()` and
invokes one of the extension's existing capabilities:

```ts
const debuggerService = AppServices.getDebugger();
const result = await debuggerService.invoke({
  capability: 'debug.session.list',
  input: {},
});
```

The service contract exports `IDebugger`, `DebuggerInvokeInput`, and
`DebuggerInvokeOutput`. Its declaration is published at
`contracts/IDebugger.d.ts` for ordinary package type consumers, while the
service manifest's `provides.services[].declaration` contains the same
definitions as inline TypeScript declaration text. `DebuggerInvokeOutput` is the
generic bridge result envelope: `result.output.value` is capability-specific.
Use the selected capability's descriptor and output schema for the individual
operation result shape; the `debug.session.list` example above returns the
existing session-list result.

## Host adapter boundary

The CommonJS activation bundle cannot assume ambient `fs`, `net`, `child_process`, or private Electron modules. Before activation, the host registers a narrow adapter:

```ts
import {
  NativeDebuggerHostAdapter,
  registerRuntimeDebuggerHostAdapter,
} from '@marshal/agentic-debugger-extension/runtime';

const restore = registerRuntimeDebuggerHostAdapter(
  new NativeDebuggerHostAdapter({ maxSessions: 10 }),
);
```

The adapter implements `invoke`, optional source reads, scoped subscriptions, scope disposal, and
global disposal. Extension teardown disposes only scopes used by that activation; the host retains
ownership of the injected adapter so hot reload or replacement activation cannot permanently
invalidate a shared adapter. A Marshal host can replace it with a worker/RPC adapter without
changing capabilities or UI.

## Execution blocks and scope

Marshal's portable execution block is a capability invocation identified by `InvocationContext.executionId`. Every bridge invocation records:

- `chatId`;
- Marshal `sessionId`;
- current `executionBlockId`;
- debugger session ID;
- stable `scopeKey`.

The stable key is derived from workspace, chat, and Marshal session identity. Marshal's
authoritative workspace is read from `InvocationContext.metadata.marshalWorkspaceName` (portable
hosts may supply an equivalent explicit workspace field). The bridge fails closed when no workspace
identity is available. The key deliberately excludes the individual execution ID so later blocks in
the same chat can control the same debugger session. Each debugger session still records every
execution block that touched it. Session lookup, event delivery, source reads, UI state, and disposal
all require the owning scope key.

Completed sessions stop receiving host events. `disposeScope()` removes their bridge state and native resources so a later chat or session cannot inherit breakpoints, watches, variables, console history, or DAP references.

## Runtime UI

The activation registers a debugger application and opens it on the `panel` surface by default. Hosts may choose `tab` when creating the extension. A successful debugger invocation with a session:

1. opens the application with a stable per-session idempotency key;
2. updates state with the latest execution block;
3. focuses the existing application instance.

This keeps one debugger surface per debugger session across panel navigation while supporting concurrent sessions. The host render adapter mounts `DebuggerPanel` from the `./ui` export and supplies `createDebuggerPanelBridgeAdapter()` or an equivalent RPC-backed `DebuggerBridgeAdapter`.

The UI uses `@monaco-editor/react` and `monaco-editor`. It includes source navigation, active-line and breakpoint glyphs, agent/human breakpoint origins, conditions, running/paused/completed controls, stack frames, locals, watches, safe evaluation console, and bounded debugger output history.

Runtime search and invocation retain the full strict capability output schemas. The application
descriptor deliberately uses compact UI-only projections: the bridge envelope and each result's
top-level fields remain strict, while nested snapshots, events, and collections are represented by
shallow typed boundaries. This keeps the packed open payload below Marshal's 65,536-byte and
depth-12 limits without changing invocation validation or UI action/tool semantics.

Hosts that support custom runtime renderers resolve `marshal.agentic-debugger.v1` to
`mountDebuggerRuntimeUi()` from the `./ui` package export. The mount adapter accepts the
registered application state plus a typed `DebuggerBridgeAdapter`, mounts the real Monaco panel,
and returns an unmount function. Marshal's current generic application-contract renderer does not
load extension module exports automatically, so a Marshal integration must register this render ID
with that adapter; without it, Marshal intentionally shows its generic application contract
inspector while open/update/focus lifecycle operations continue to work.

## Security and evaluation

- Every debugger capability declares exactly `marshal.tool.invoke:<capability>`; UI actions declare
  the same capability-scoped requirement, while UI tool references rely on their target descriptor.
- Runtime evaluation always uses the existing safe expression policy. Assignment, dynamic import, `require`, `eval`, process access, and other dangerous patterns are rejected.
- CLI evaluation keeps its existing compatibility behavior, including explicit safe mode.
- Variable values pass through the existing name-based redaction policy.
- Native process attach passes through the existing process guard. A production Marshal host should additionally broker attach permission and use an OS ownership-aware policy.
- Source reads are limited to files already associated with the owning debugger session through stack frames, loaded sources, or breakpoints.
- The extension never accepts chat/session ownership from model input; ownership comes from `InvocationContext`.

Evaluation safety is a policy check, not a language sandbox. Unsafe evaluation should be exposed as a separate approval-gated host capability if a deployment needs it.

## Adapter behavior

The original adapter implementations remain in `src/adapters/`:

- js-debug for JavaScript and TypeScript;
- debugpy for Python;
- netcoredbg for .NET Core and modern .NET;
- clr-debug for Windows .NET Framework attach;
- vsdbg as explicit opt-in.

`NativeDebuggerHostAdapter` owns a separate adapter instance and DAP client per debugger session. A production host can move this adapter behind a worker process while preserving the same `DebuggerHostAdapter` contract.

## Troubleshooting

| Symptom | Resolution |
| --- | --- |
| `WORKER_UNAVAILABLE` | Register a `DebuggerHostAdapter` before activation. |
| Manifest test cannot find the entrypoint | Run `npm run build`. |
| js-debug not found | Run `npm run provision:adapters`, install VS Code, or set `AGENTIC_JSDEBUG_PATH`. |
| debugpy not found | Run `python -m pip install debugpy` and optionally set `AGENTIC_PYTHON_PATH`. |
| netcoredbg/clr-debug/vsdbg not found | Install the adapter and set the corresponding `AGENTIC_*_PATH`. |
| `SCOPE_MISMATCH` | Use the same Marshal chat/session/workspace that created the debugger session. |
| Expression rejected | Use a side-effect-free expression; unsafe evaluation is intentionally not routed through the UI bridge. |
| Panel does not render Monaco | Ensure the host renderer supplies React 18/19, React DOM, `@monaco-editor/react`, and `monaco-editor`. |
| Marshal shows the application contract inspector | Register render ID `marshal.agentic-debugger.v1` with `mountDebuggerRuntimeUi()` from the `./ui` export. |

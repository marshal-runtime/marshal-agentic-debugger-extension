'use strict';

// src/runtime/output-schemas.ts
function schema(value) {
  return Object.freeze(value);
}
function objectSchema(properties, required = []) {
  return schema({
    type: "object",
    additionalProperties: false,
    properties,
    required
  });
}
function arraySchema(items) {
  return schema({ type: "array", items });
}
function oneOfSchema(...schemas) {
  return schema({ oneOf: schemas });
}
var opaqueValueSchema = schema({});
var stringSchema = schema({ type: "string" });
var nonEmptyStringSchema = schema({ type: "string", minLength: 1 });
var integerSchema = schema({ type: "integer" });
var nonNegativeIntegerSchema = schema({ type: "integer", minimum: 0 });
var booleanSchema = schema({ type: "boolean" });
var stringOrIntegerSchema = oneOfSchema(stringSchema, integerSchema);
var checksumSchema = objectSchema(
  {
    algorithm: schema({ enum: ["MD5", "SHA1", "SHA256", "timestamp"] }),
    checksum: stringSchema
  },
  ["algorithm", "checksum"]
);
var dapSourceSchema = objectSchema({
  name: stringSchema,
  path: stringSchema,
  sourceReference: integerSchema,
  presentationHint: schema({ enum: ["normal", "emphasize", "deemphasize"] }),
  origin: stringSchema,
  sources: arraySchema(schema({ $ref: "#/$defs/dapSource" })),
  adapterData: opaqueValueSchema,
  checksums: arraySchema(checksumSchema)
});
var dapBreakpointSchema = objectSchema(
  {
    id: integerSchema,
    verified: booleanSchema,
    message: stringSchema,
    source: dapSourceSchema,
    line: integerSchema,
    column: integerSchema,
    endLine: integerSchema,
    endColumn: integerSchema,
    instructionReference: stringSchema,
    offset: integerSchema,
    reason: schema({ enum: ["pending", "failed"] })
  },
  ["verified"]
);
var debuggerVariableSchema = objectSchema(
  {
    name: stringSchema,
    value: stringSchema,
    type: stringSchema,
    variablesReference: integerSchema,
    redacted: booleanSchema,
    children: arraySchema(schema({ $ref: "#/$defs/debuggerVariable" }))
  },
  ["name", "value"]
);
var exceptionDetailsSchema = objectSchema({
  message: stringSchema,
  typeName: stringSchema,
  fullTypeName: stringSchema,
  evaluateName: stringSchema,
  stackTrace: stringSchema,
  innerException: arraySchema(schema({ $ref: "#/$defs/exceptionDetails" }))
});
var outputDefinitions = Object.freeze({
  dapSource: dapSourceSchema,
  debuggerVariable: debuggerVariableSchema,
  exceptionDetails: exceptionDetailsSchema
});
var debuggerSourceFileSchema = objectSchema(
  {
    path: stringSchema,
    name: stringSchema,
    language: stringSchema,
    content: stringSchema
  },
  ["path", "language"]
);
var debuggerSourceLocationSchema = objectSchema(
  {
    file: stringSchema,
    line: integerSchema,
    column: integerSchema
  },
  ["file", "line"]
);
var debuggerBreakpointSchema = objectSchema(
  {
    id: stringSchema,
    file: stringSchema,
    line: integerSchema,
    column: integerSchema,
    enabled: booleanSchema,
    verified: booleanSchema,
    condition: stringSchema,
    hitCondition: stringSchema,
    logMessage: stringSchema,
    origin: schema({ enum: ["agent", "human"] })
  },
  ["id", "file", "line", "enabled", "verified", "origin"]
);
var debuggerStackFrameSchema = objectSchema(
  {
    id: integerSchema,
    name: stringSchema,
    source: stringSchema,
    line: integerSchema,
    column: integerSchema
  },
  ["id", "name"]
);
var debuggerWatchValueSchema = objectSchema(
  {
    id: stringSchema,
    expression: stringSchema,
    value: stringSchema,
    type: stringSchema,
    error: stringSchema,
    origin: schema({ enum: ["agent", "human"] })
  },
  ["id", "expression", "origin"]
);
var debuggerConsoleEntrySchema = objectSchema(
  {
    id: stringSchema,
    expression: stringSchema,
    result: stringSchema,
    type: stringSchema,
    error: stringSchema,
    origin: schema({ enum: ["agent", "human"] }),
    timestamp: stringSchema
  },
  ["id", "expression", "origin", "timestamp"]
);
var debuggerOutputEventSchema = objectSchema(
  {
    id: stringSchema,
    category: schema({ enum: ["debugger", "stdout", "stderr", "telemetry"] }),
    message: stringSchema,
    timestamp: stringSchema
  },
  ["id", "category", "message", "timestamp"]
);
var debuggerSnapshotSchema = objectSchema(
  {
    state: schema({ enum: ["paused", "running", "completed"] }),
    statusMessage: stringSchema,
    sources: arraySchema(debuggerSourceFileSchema),
    activeSourcePath: stringSchema,
    currentLocation: debuggerSourceLocationSchema,
    currentThreadId: integerSchema,
    selectedFrameId: integerSchema,
    breakpoints: arraySchema(debuggerBreakpointSchema),
    callStack: arraySchema(debuggerStackFrameSchema),
    locals: arraySchema(debuggerVariableSchema),
    watches: arraySchema(debuggerWatchValueSchema),
    console: arraySchema(debuggerConsoleEntrySchema),
    events: arraySchema(debuggerOutputEventSchema)
  },
  ["state", "sources", "breakpoints", "callStack", "locals", "watches", "console", "events"]
);
var debuggerScopeSchema = objectSchema(
  {
    chatId: nonEmptyStringSchema,
    sessionId: nonEmptyStringSchema,
    workspaceName: nonEmptyStringSchema,
    executionBlockId: nonEmptyStringSchema,
    scopeKey: nonEmptyStringSchema
  },
  ["chatId", "sessionId", "workspaceName", "executionBlockId", "scopeKey"]
);
var executionBlockSchema = objectSchema(
  {
    id: nonEmptyStringSchema,
    capability: nonEmptyStringSchema,
    debuggerSessionId: nonEmptyStringSchema,
    scope: debuggerScopeSchema,
    status: schema({ const: "completed" }),
    createdAt: stringSchema,
    completedAt: stringSchema
  },
  ["id", "capability", "scope", "status", "createdAt", "completedAt"]
);
var debuggerUiOpenResultSchema = oneOfSchema(
  objectSchema({ action: schema({ const: "unavailable" }) }, ["action"]),
  objectSchema(
    {
      action: schema({ const: "opened-and-focused" }),
      instanceId: nonEmptyStringSchema
    },
    ["action", "instanceId"]
  )
);
var boundSessionSchema = objectSchema(
  {
    debuggerSessionId: nonEmptyStringSchema,
    scope: debuggerScopeSchema,
    createdAt: stringSchema,
    executionBlockIds: arraySchema(nonEmptyStringSchema),
    completed: booleanSchema,
    latestSnapshot: debuggerSnapshotSchema
  },
  ["debuggerSessionId", "scope", "createdAt", "executionBlockIds", "completed"]
);
var debuggerHostEventSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    type: nonEmptyStringSchema,
    occurredAt: stringSchema,
    body: opaqueValueSchema,
    snapshot: debuggerSnapshotSchema
  },
  ["sessionId", "type", "occurredAt"]
);
var dapStackFrameSchema = objectSchema(
  {
    id: integerSchema,
    name: stringSchema,
    source: oneOfSchema(stringSchema, dapSourceSchema),
    line: integerSchema,
    column: integerSchema,
    endLine: integerSchema,
    endColumn: integerSchema,
    canRestart: booleanSchema,
    instructionPointerReference: stringSchema,
    moduleId: stringOrIntegerSchema,
    presentationHint: schema({ enum: ["normal", "label", "subtle"] })
  },
  ["id", "name", "line", "column"]
);
var dapThreadSchema = objectSchema(
  {
    id: integerSchema,
    name: stringSchema
  },
  ["id", "name"]
);
var dapScopeSchema = objectSchema(
  {
    name: stringSchema,
    presentationHint: stringSchema,
    variablesReference: integerSchema,
    namedVariables: integerSchema,
    indexedVariables: integerSchema,
    expensive: booleanSchema,
    source: dapSourceSchema,
    line: integerSchema,
    column: integerSchema,
    endLine: integerSchema,
    endColumn: integerSchema
  },
  ["name", "variablesReference", "expensive"]
);
var dapModuleSchema = objectSchema(
  {
    id: stringOrIntegerSchema,
    name: stringSchema,
    path: stringSchema,
    isOptimized: booleanSchema,
    isUserCode: booleanSchema,
    version: stringSchema,
    symbolStatus: stringSchema,
    symbolFilePath: stringSchema,
    dateTimeStamp: stringSchema,
    addressRange: stringSchema
  },
  ["id", "name"]
);
var adapterSchema = objectSchema(
  {
    type: schema({ enum: ["js-debug", "debugpy", "netcoredbg", "clr-debug", "vsdbg"] }),
    languages: arraySchema(schema({ enum: ["javascript", "typescript", "python", "csharp"] })),
    attachOnly: booleanSchema,
    optIn: booleanSchema
  },
  ["type", "languages"]
);
var sessionSnapshotValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    snapshot: debuggerSnapshotSchema
  },
  ["sessionId", "snapshot"]
);
var sessionListValueSchema = objectSchema(
  {
    sessions: arraySchema(boundSessionSchema),
    count: nonNegativeIntegerSchema
  },
  ["sessions", "count"]
);
var sessionGetValueSchema = oneOfSchema(
  objectSchema(
    {
      session: boundSessionSchema,
      snapshot: debuggerSnapshotSchema
    },
    ["session", "snapshot"]
  ),
  sessionSnapshotValueSchema
);
var sessionEventsValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    events: arraySchema(debuggerHostEventSchema),
    next: nonNegativeIntegerSchema,
    truncated: booleanSchema
  },
  ["sessionId", "events", "next", "truncated"]
);
var sessionRestartValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    restarted: schema({ const: true }),
    snapshot: debuggerSnapshotSchema
  },
  ["sessionId", "restarted", "snapshot"]
);
function sessionCloseValueSchema(property) {
  return objectSchema(
    {
      sessionId: nonEmptyStringSchema,
      [property]: schema({ const: true }),
      snapshot: debuggerSnapshotSchema
    },
    ["sessionId", property, "snapshot"]
  );
}
var breakpointValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    breakpoint: debuggerBreakpointSchema,
    snapshot: debuggerSnapshotSchema
  },
  ["sessionId", "breakpoint", "snapshot"]
);
var breakpointRemoveValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    removed: nonEmptyStringSchema,
    snapshot: debuggerSnapshotSchema
  },
  ["sessionId", "removed", "snapshot"]
);
var breakpointListValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    breakpoints: arraySchema(debuggerBreakpointSchema)
  },
  ["sessionId", "breakpoints"]
);
var dapBreakpointResponseSchema = objectSchema({
  breakpoints: arraySchema(dapBreakpointSchema)
});
var breakpointResponseValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    response: dapBreakpointResponseSchema
  },
  ["sessionId", "response"]
);
var exceptionBreakpointValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    filters: arraySchema(stringSchema)
  },
  ["sessionId", "filters"]
);
function executionControlValueSchema(nativeAction, capabilityAction) {
  return objectSchema(
    {
      sessionId: nonEmptyStringSchema,
      threadId: integerSchema,
      action: capabilityAction ? schema({ enum: [capabilityAction, nativeAction] }) : schema({ const: nativeAction }),
      snapshot: debuggerSnapshotSchema
    },
    capabilityAction ? ["sessionId", "action", "snapshot"] : ["sessionId", "threadId", "action", "snapshot"]
  );
}
var restartFrameValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    frameId: integerSchema
  },
  ["sessionId", "frameId"]
);
var setNextStatementValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    threadId: integerSchema,
    file: stringSchema,
    line: integerSchema
  },
  ["sessionId", "threadId", "file", "line"]
);
var evaluateValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    result: stringSchema,
    type: stringSchema,
    variablesReference: integerSchema,
    snapshot: debuggerSnapshotSchema
  },
  ["sessionId", "result", "variablesReference", "snapshot"]
);
var variablesValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    variablesReference: integerSchema,
    variables: arraySchema(debuggerVariableSchema)
  },
  ["sessionId", "variablesReference", "variables"]
);
var callStackValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    threadId: integerSchema,
    stackFrames: arraySchema(dapStackFrameSchema)
  },
  ["sessionId", "threadId", "stackFrames"]
);
var threadsValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    threads: arraySchema(dapThreadSchema)
  },
  ["sessionId", "threads"]
);
var scopesValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    frameId: integerSchema,
    scopes: arraySchema(dapScopeSchema)
  },
  ["sessionId", "frameId", "scopes"]
);
var watchValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    action: schema({ enum: ["add", "remove", "list", "evaluate"] }),
    watches: arraySchema(debuggerWatchValueSchema),
    snapshot: debuggerSnapshotSchema
  },
  ["sessionId", "action", "watches", "snapshot"]
);
var loadedSourcesValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    sources: arraySchema(dapSourceSchema),
    snapshot: debuggerSnapshotSchema
  },
  ["sessionId", "sources", "snapshot"]
);
var modulesValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    modules: objectSchema({
      modules: arraySchema(dapModuleSchema),
      totalModules: nonNegativeIntegerSchema
    })
  },
  ["sessionId", "modules"]
);
var exceptionInfoValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    threadId: integerSchema,
    exception: objectSchema({
      exceptionId: stringSchema,
      description: stringSchema,
      breakMode: schema({ enum: ["never", "always", "unhandled", "userUnhandled"] }),
      details: exceptionDetailsSchema
    })
  },
  ["sessionId", "threadId", "exception"]
);
var adapterListValueSchema = objectSchema(
  {
    adapters: arraySchema(adapterSchema)
  },
  ["adapters"]
);
var selectExecutionBlockValueSchema = objectSchema(
  {
    selected: schema({ const: true }),
    session: boundSessionSchema,
    executionBlockId: nonEmptyStringSchema
  },
  ["selected", "session", "executionBlockId"]
);
function bridgeOutputSchema(value) {
  return schema({
    type: "object",
    additionalProperties: false,
    properties: {
      value,
      scope: debuggerScopeSchema,
      executionBlock: executionBlockSchema,
      ui: debuggerUiOpenResultSchema
    },
    required: ["value", "scope", "executionBlock"],
    $defs: outputDefinitions
  });
}
var DEBUGGER_CAPABILITY_OUTPUT_SCHEMAS = Object.freeze({
  "debug.session.launch": bridgeOutputSchema(sessionSnapshotValueSchema),
  "debug.session.attach": bridgeOutputSchema(sessionSnapshotValueSchema),
  "debug.session.disconnect": bridgeOutputSchema(sessionCloseValueSchema("disconnected")),
  "debug.session.terminate": bridgeOutputSchema(sessionCloseValueSchema("terminated")),
  "debug.session.list": bridgeOutputSchema(sessionListValueSchema),
  "debug.session.restart": bridgeOutputSchema(sessionRestartValueSchema),
  "debug.breakpoint.set": bridgeOutputSchema(breakpointValueSchema),
  "debug.breakpoint.remove": bridgeOutputSchema(breakpointRemoveValueSchema),
  "debug.breakpoint.setFunction": bridgeOutputSchema(breakpointResponseValueSchema),
  "debug.breakpoint.setException": bridgeOutputSchema(exceptionBreakpointValueSchema),
  "debug.breakpoint.setData": bridgeOutputSchema(breakpointResponseValueSchema),
  "debug.breakpoint.list": bridgeOutputSchema(breakpointListValueSchema),
  "debug.breakpoint.enable": bridgeOutputSchema(breakpointValueSchema),
  "debug.breakpoint.disable": bridgeOutputSchema(breakpointValueSchema),
  "debug.execution.continue": bridgeOutputSchema(
    executionControlValueSchema("continue", "debug.execution.continue")
  ),
  "debug.execution.stepOver": bridgeOutputSchema(
    executionControlValueSchema("next", "debug.execution.stepOver")
  ),
  "debug.execution.stepInto": bridgeOutputSchema(
    executionControlValueSchema("stepIn", "debug.execution.stepInto")
  ),
  "debug.execution.stepOut": bridgeOutputSchema(
    executionControlValueSchema("stepOut", "debug.execution.stepOut")
  ),
  "debug.execution.pause": bridgeOutputSchema(
    executionControlValueSchema("pause", "debug.execution.pause")
  ),
  "debug.execution.setNextStatement": bridgeOutputSchema(setNextStatementValueSchema),
  "debug.execution.restartFrame": bridgeOutputSchema(restartFrameValueSchema),
  "debug.execution.reverseContinue": bridgeOutputSchema(
    executionControlValueSchema("reverseContinue")
  ),
  "debug.inspect.evaluate": bridgeOutputSchema(evaluateValueSchema),
  "debug.inspect.variables": bridgeOutputSchema(variablesValueSchema),
  "debug.inspect.callStack": bridgeOutputSchema(callStackValueSchema),
  "debug.inspect.threads": bridgeOutputSchema(threadsValueSchema),
  "debug.inspect.scopes": bridgeOutputSchema(scopesValueSchema),
  "debug.watch.manage": bridgeOutputSchema(watchValueSchema),
  "debug.inspect.loadedSources": bridgeOutputSchema(loadedSourcesValueSchema),
  "debug.inspect.modules": bridgeOutputSchema(modulesValueSchema),
  "debug.inspect.exceptionInfo": bridgeOutputSchema(exceptionInfoValueSchema),
  "debug.session.get": bridgeOutputSchema(sessionGetValueSchema),
  "debug.session.events": bridgeOutputSchema(sessionEventsValueSchema),
  "debug.adapter.list": bridgeOutputSchema(adapterListValueSchema),
  "debug.source.read": bridgeOutputSchema(debuggerSourceFileSchema),
  "debug.ui.selectExecutionBlock": bridgeOutputSchema(selectExecutionBlockValueSchema)
});
function debuggerCapabilityOutputSchema(name) {
  const outputSchema = DEBUGGER_CAPABILITY_OUTPUT_SCHEMAS[name];
  if (!outputSchema) {
    throw new Error(`Missing strict output schema for debugger capability: ${name}`);
  }
  return outputSchema;
}

// src/runtime/capabilities.ts
var DEBUGGER_PROVIDER_ID = "@marshal/agentic-debugger-extension";
var DEBUGGER_APPLICATION_ID = "debugger";
var DEBUGGER_RENDER_ID = "marshal.agentic-debugger.v1";
var RUNTIME_PROTOCOL_VERSION = "1.0.0";
var DEBUGGER_CAPABILITY_VERSION = "1.0.0";
var DEBUGGER_SERVICE_ID = "@marshal/agentic-debugger:debugger";
var DEBUGGER_SERVICE_VERSION = "1.0.0";
var DEBUGGER_COMMAND_CAPABILITY_MAP = Object.freeze({
  launch_debug: "debug.session.launch",
  attach_debug: "debug.session.attach",
  disconnect: "debug.session.disconnect",
  terminate: "debug.session.terminate",
  list_sessions: "debug.session.list",
  restart_session: "debug.session.restart",
  set_breakpoint: "debug.breakpoint.set",
  remove_breakpoint: "debug.breakpoint.remove",
  set_function_breakpoint: "debug.breakpoint.setFunction",
  set_exception_breakpoints: "debug.breakpoint.setException",
  set_data_breakpoint: "debug.breakpoint.setData",
  list_breakpoints: "debug.breakpoint.list",
  enable_breakpoint: "debug.breakpoint.enable",
  disable_breakpoint: "debug.breakpoint.disable",
  continue_execution: "debug.execution.continue",
  step_over: "debug.execution.stepOver",
  step_into: "debug.execution.stepInto",
  step_out: "debug.execution.stepOut",
  pause_execution: "debug.execution.pause",
  set_next_statement: "debug.execution.setNextStatement",
  restart_frame: "debug.execution.restartFrame",
  reverse_continue: "debug.execution.reverseContinue",
  evaluate_expression: "debug.inspect.evaluate",
  get_variables: "debug.inspect.variables",
  get_call_stack: "debug.inspect.callStack",
  get_threads: "debug.inspect.threads",
  get_scopes: "debug.inspect.scopes",
  manage_watch: "debug.watch.manage",
  get_loaded_sources: "debug.inspect.loadedSources",
  get_modules: "debug.inspect.modules",
  get_exception_info: "debug.inspect.exceptionInfo"
});
var RUNTIME_DEBUGGER_CAPABILITIES = Object.freeze([
  "debug.session.get",
  "debug.session.events",
  "debug.adapter.list",
  "debug.source.read",
  "debug.ui.selectExecutionBlock"
]);
var stringProperty = Object.freeze({ type: "string", minLength: 1, maxLength: 16384 });
var sessionIdProperty = Object.freeze({ type: "string", minLength: 1, maxLength: 256 });
var integerProperty = Object.freeze({ type: "integer" });
var positiveIntegerProperty = Object.freeze({ type: "integer", minimum: 1 });
var booleanProperty = Object.freeze({ type: "boolean" });
function objectSchema2(properties, required = []) {
  return Object.freeze({
    type: "object",
    additionalProperties: false,
    required,
    properties
  });
}
var sessionInput = objectSchema2({ sessionId: sessionIdProperty }, ["sessionId"]);
var threadInput = objectSchema2({ sessionId: sessionIdProperty, threadId: integerProperty }, [
  "sessionId"
]);
var frameInput = objectSchema2({ sessionId: sessionIdProperty, frameId: integerProperty }, [
  "sessionId",
  "frameId"
]);
var inputs = Object.freeze({
  "debug.session.launch": objectSchema2(
    {
      program: stringProperty,
      language: { enum: ["typescript", "javascript", "python", "csharp"] },
      adapter: { enum: ["js-debug", "debugpy", "netcoredbg", "clr-debug", "vsdbg"] },
      args: { type: "array", items: stringProperty, maxItems: 256 },
      cwd: stringProperty,
      env: { type: "object", additionalProperties: { type: "string" } },
      stopOnEntry: booleanProperty
    },
    ["program"]
  ),
  "debug.session.attach": objectSchema2(
    {
      pid: positiveIntegerProperty,
      host: stringProperty,
      port: positiveIntegerProperty,
      language: { enum: ["typescript", "javascript", "python", "csharp"] },
      adapter: { enum: ["js-debug", "debugpy", "netcoredbg", "clr-debug", "vsdbg"] },
      type: { enum: ["node", "chrome", "msedge"] }
    },
    ["language"]
  ),
  "debug.session.disconnect": objectSchema2(
    { sessionId: sessionIdProperty, terminateDebuggee: booleanProperty },
    ["sessionId"]
  ),
  "debug.session.terminate": sessionInput,
  "debug.session.list": objectSchema2({}),
  "debug.session.restart": sessionInput,
  "debug.breakpoint.set": objectSchema2(
    {
      sessionId: sessionIdProperty,
      file: stringProperty,
      line: positiveIntegerProperty,
      condition: stringProperty,
      hitCondition: stringProperty,
      logMessage: stringProperty,
      origin: { enum: ["agent", "human"] }
    },
    ["sessionId", "file", "line"]
  ),
  "debug.breakpoint.remove": objectSchema2(
    {
      sessionId: sessionIdProperty,
      breakpointId: sessionIdProperty,
      file: stringProperty,
      line: positiveIntegerProperty
    },
    ["sessionId"]
  ),
  "debug.breakpoint.setFunction": objectSchema2(
    {
      sessionId: sessionIdProperty,
      name: stringProperty,
      condition: stringProperty,
      hitCondition: stringProperty
    },
    ["sessionId", "name"]
  ),
  "debug.breakpoint.setException": objectSchema2(
    {
      sessionId: sessionIdProperty,
      filters: { type: "array", items: stringProperty, maxItems: 64 }
    },
    ["sessionId", "filters"]
  ),
  "debug.breakpoint.setData": objectSchema2(
    {
      sessionId: sessionIdProperty,
      dataId: stringProperty,
      accessType: { enum: ["read", "write", "readWrite"] }
    },
    ["sessionId", "dataId"]
  ),
  "debug.breakpoint.list": sessionInput,
  "debug.breakpoint.enable": objectSchema2(
    {
      sessionId: sessionIdProperty,
      breakpointId: sessionIdProperty,
      file: stringProperty,
      line: positiveIntegerProperty
    },
    ["sessionId"]
  ),
  "debug.breakpoint.disable": objectSchema2(
    {
      sessionId: sessionIdProperty,
      breakpointId: sessionIdProperty,
      file: stringProperty,
      line: positiveIntegerProperty
    },
    ["sessionId"]
  ),
  "debug.execution.continue": threadInput,
  "debug.execution.stepOver": threadInput,
  "debug.execution.stepInto": threadInput,
  "debug.execution.stepOut": threadInput,
  "debug.execution.pause": threadInput,
  "debug.execution.setNextStatement": objectSchema2(
    {
      sessionId: sessionIdProperty,
      file: stringProperty,
      line: positiveIntegerProperty,
      threadId: integerProperty
    },
    ["sessionId", "file", "line"]
  ),
  "debug.execution.restartFrame": frameInput,
  "debug.execution.reverseContinue": threadInput,
  "debug.inspect.evaluate": objectSchema2(
    {
      sessionId: sessionIdProperty,
      expression: stringProperty,
      frameId: integerProperty,
      context: { enum: ["watch", "repl", "hover"] },
      origin: { enum: ["agent", "human"] }
    },
    ["sessionId", "expression"]
  ),
  "debug.inspect.variables": objectSchema2(
    {
      sessionId: sessionIdProperty,
      variablesReference: integerProperty,
      depth: positiveIntegerProperty,
      maxProperties: positiveIntegerProperty
    },
    ["sessionId", "variablesReference"]
  ),
  "debug.inspect.callStack": objectSchema2(
    {
      sessionId: sessionIdProperty,
      threadId: integerProperty,
      startFrame: { type: "integer", minimum: 0 },
      levels: positiveIntegerProperty
    },
    ["sessionId"]
  ),
  "debug.inspect.threads": sessionInput,
  "debug.inspect.scopes": frameInput,
  "debug.watch.manage": objectSchema2(
    {
      sessionId: sessionIdProperty,
      action: { enum: ["add", "remove", "list", "evaluate"] },
      expression: stringProperty,
      frameId: integerProperty,
      origin: { enum: ["agent", "human"] },
      watchId: sessionIdProperty
    },
    ["sessionId", "action"]
  ),
  "debug.inspect.loadedSources": sessionInput,
  "debug.inspect.modules": objectSchema2(
    {
      sessionId: sessionIdProperty,
      startModule: { type: "integer", minimum: 0 },
      moduleCount: positiveIntegerProperty
    },
    ["sessionId"]
  ),
  "debug.inspect.exceptionInfo": objectSchema2(
    { sessionId: sessionIdProperty, threadId: integerProperty },
    ["sessionId", "threadId"]
  ),
  "debug.session.get": sessionInput,
  "debug.session.events": objectSchema2(
    {
      sessionId: sessionIdProperty,
      after: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 256 }
    },
    ["sessionId"]
  ),
  "debug.adapter.list": objectSchema2({}),
  "debug.source.read": objectSchema2({ sessionId: sessionIdProperty, path: stringProperty }, [
    "sessionId",
    "path"
  ]),
  "debug.ui.selectExecutionBlock": objectSchema2(
    { sessionId: sessionIdProperty, executionBlockId: sessionIdProperty },
    ["sessionId", "executionBlockId"]
  )
});
var MARSHAL_TOOL_INVOCATION_PERMISSION_PREFIX = "marshal.tool.invoke:";
function permissionFor(name) {
  let risk = "low";
  if (name === "debug.session.launch") {
    risk = "high";
  } else if (name === "debug.session.attach" || name === "debug.session.terminate") {
    risk = "critical";
  } else if (name === "debug.session.disconnect" || name === "debug.session.restart" || name.startsWith("debug.execution.")) {
    risk = "high";
  } else if (name.startsWith("debug.breakpoint.") || name === "debug.inspect.evaluate" || name === "debug.watch.manage") {
    risk = "medium";
  }
  return [
    {
      permission: `${MARSHAL_TOOL_INVOCATION_PERMISSION_PREFIX}${name}`,
      risk
    }
  ];
}
var descriptions = Object.freeze({
  "debug.session.launch": "Launch a program under a native debug adapter.",
  "debug.session.attach": "Attach a native debug adapter to an authorized process or endpoint.",
  "debug.session.disconnect": "Disconnect a debugger session.",
  "debug.session.terminate": "Terminate a debugger session and its debuggee.",
  "debug.session.list": "List debugger sessions owned by the current Marshal scope.",
  "debug.session.restart": "Restart an existing debugger session.",
  "debug.breakpoint.set": "Set a line breakpoint.",
  "debug.breakpoint.remove": "Remove a line breakpoint.",
  "debug.breakpoint.setFunction": "Set a function breakpoint.",
  "debug.breakpoint.setException": "Set exception breakpoint filters.",
  "debug.breakpoint.setData": "Set a data breakpoint.",
  "debug.breakpoint.list": "List breakpoints for one debugger session.",
  "debug.breakpoint.enable": "Enable a breakpoint.",
  "debug.breakpoint.disable": "Disable a breakpoint.",
  "debug.execution.continue": "Continue paused execution.",
  "debug.execution.stepOver": "Step over the current statement.",
  "debug.execution.stepInto": "Step into the current call.",
  "debug.execution.stepOut": "Step out of the current frame.",
  "debug.execution.pause": "Pause running execution.",
  "debug.execution.setNextStatement": "Move the execution point.",
  "debug.execution.restartFrame": "Restart a stack frame.",
  "debug.execution.reverseContinue": "Continue execution in reverse.",
  "debug.inspect.evaluate": "Safely evaluate an expression in the selected frame.",
  "debug.inspect.variables": "Read variables for a DAP variables reference.",
  "debug.inspect.callStack": "Read the call stack for the stopped thread.",
  "debug.inspect.threads": "List debugger threads.",
  "debug.inspect.scopes": "List variable scopes for a frame.",
  "debug.watch.manage": "Add, remove, list, or evaluate watch expressions.",
  "debug.inspect.loadedSources": "List source files known to the adapter.",
  "debug.inspect.modules": "List modules known to the adapter.",
  "debug.inspect.exceptionInfo": "Read exception details for a stopped thread.",
  "debug.session.get": "Read the authoritative debugger UI snapshot.",
  "debug.session.events": "Read bounded debugger event history.",
  "debug.adapter.list": "List available native debugger adapters.",
  "debug.source.read": "Read a source file already associated with the debugger session.",
  "debug.ui.selectExecutionBlock": "Open or focus the debugger UI for an execution block."
});
var allCapabilityNames = [
  ...Object.values(DEBUGGER_COMMAND_CAPABILITY_MAP),
  ...RUNTIME_DEBUGGER_CAPABILITIES
];
var DEBUGGER_CAPABILITY_DESCRIPTORS = Object.freeze(
  allCapabilityNames.map(
    (name) => Object.freeze({
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      name,
      version: DEBUGGER_CAPABILITY_VERSION,
      title: name,
      description: descriptions[name] ?? name,
      tags: Object.freeze(["debugger", "dap", "agentic-debugger"]),
      inputSchema: inputs[name] ?? objectSchema2({}),
      outputSchema: debuggerCapabilityOutputSchema(name),
      permissions: permissionFor(name),
      annotations: Object.freeze({
        executionBlock: true,
        scopeSource: "invocation-context"
      })
    })
  )
);
Object.freeze(
  DEBUGGER_CAPABILITY_DESCRIPTORS.map((descriptor) => descriptor.name)
);

// src/security/eval-safety.ts
var MUTATION_PATTERNS = [
  /(?<!=|!)=(?!=)/,
  // assignment (but not == or != or ===)
  /\+\+/,
  // increment
  /--/,
  // decrement
  /\+=|-=|\*=|\/=|%=/,
  // compound assignment
  /\bdelete\b/,
  // delete operator
  /\bnew\b/
  // object construction
];
var DANGEROUS_PATTERNS = [
  /\beval\s*\(/,
  // eval() calls
  /\bFunction\s*\(/,
  // Function constructor
  /\brequire\s*\(/,
  // require() calls
  /\bimport\s*\(/,
  // dynamic import
  /\bprocess\s*\./,
  // process access
  /\bchild_process\b/,
  // child process module
  /\bexec\s*\(/
  // exec calls
];
function resolveSafetyMode(options) {
  if (options.mode !== void 0) {
    return options.mode;
  }
  return options.interfaceContext === "cli" ? "unrestricted" : "safe";
}
function isSafeExpression(expression, options = {}) {
  const mode = resolveSafetyMode(options);
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(expression)) {
      if (mode === "safe") {
        return {
          safe: false,
          warning: `Expression contains a potentially dangerous operation: ${pattern.source}`
        };
      }
      return {
        safe: true,
        warning: `Expression may perform dangerous operations \u2014 use caution`
      };
    }
  }
  for (const pattern of MUTATION_PATTERNS) {
    if (pattern.test(expression)) {
      if (mode === "safe") {
        return {
          safe: false,
          warning: `Expression may modify program state (detected: ${pattern.source})`
        };
      }
      return {
        safe: true,
        warning: `Expression may modify program state`
      };
    }
  }
  return { safe: true };
}

// src/runtime/scope.ts
function requireText(value, label) {
  if (!value?.trim()) {
    throw new Error(`${label} is required in the Marshal invocation context.`);
  }
  return value;
}
function fnv1a(value, seed) {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function stableDebuggerScopeKey(workspaceName, chatId, sessionId) {
  const value = `${workspaceName}\0${chatId}\0${sessionId}`;
  return `debugger-${fnv1a(value, 2166136261)}${fnv1a(value, 2654435769)}`;
}
function deriveDebuggerScope(context) {
  const scope = context.scope;
  const sessionId = requireText(scope?.sessionId, "scope.sessionId");
  const chatId = scope?.chatId ?? scope?.threadId ?? sessionId;
  const metadataWorkspace = context.metadata?.["marshalWorkspaceName"];
  const workspaceName = requireText(
    typeof metadataWorkspace === "string" ? metadataWorkspace : scope?.workspaceName ?? scope?.workspaceId ?? scope?.projectId,
    "metadata.marshalWorkspaceName"
  );
  const executionBlockId = requireText(context.executionId, "executionId");
  return Object.freeze({
    chatId,
    sessionId,
    workspaceName,
    executionBlockId,
    scopeKey: stableDebuggerScopeKey(workspaceName, chatId, sessionId)
  });
}

// src/runtime/bridge.ts
var MAX_EVENTS_PER_SESSION = 256;
var COMPLETION_CAPABILITIES = /* @__PURE__ */ new Set(["debug.session.disconnect", "debug.session.terminate"]);
var UNBOUND_CAPABILITIES = /* @__PURE__ */ new Set([
  "debug.session.launch",
  "debug.session.attach",
  "debug.session.list",
  "debug.adapter.list"
]);
var COMPLETED_SESSION_CAPABILITIES = /* @__PURE__ */ new Set([
  "debug.session.get",
  "debug.session.events",
  "debug.source.read",
  "debug.ui.selectExecutionBlock"
]);
function record(value, label = "input") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}
function text(recordValue, key) {
  const value = recordValue[key];
  return typeof value === "string" && value.trim() ? value : void 0;
}
function errorCode(error) {
  if (error && typeof error === "object") {
    const code = error["code"];
    if (typeof code === "string") return code;
  }
  return "DEBUGGER_OPERATION_FAILED";
}
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function assertSafeExpression(expression) {
  const safety = isSafeExpression(expression, {
    mode: "safe",
    interfaceContext: "mcp"
  });
  if (!safety.safe) {
    throw Object.assign(new Error(safety.warning ?? "Expression is not safe to evaluate."), {
      code: "EXPRESSION_NOT_SAFE"
    });
  }
}
function extractDebuggerSessionId(output) {
  if (!output || typeof output !== "object") return void 0;
  const value = output;
  const direct = value["sessionId"];
  if (typeof direct === "string") return direct;
  const session = value["session"];
  if (session && typeof session === "object") {
    const nested = session["sessionId"];
    if (typeof nested === "string") return nested;
  }
  return void 0;
}
function extractSnapshot(output) {
  if (!output || typeof output !== "object") return void 0;
  const value = output;
  const snapshot = value["snapshot"];
  if (!snapshot || typeof snapshot !== "object") return void 0;
  return snapshot;
}
function freezeBlock(block) {
  return Object.freeze({
    id: block.id,
    capability: block.capability,
    ...block.debuggerSessionId ? { debuggerSessionId: block.debuggerSessionId } : {},
    scope: block.scope,
    status: block.status,
    createdAt: block.createdAt,
    ...block.completedAt ? { completedAt: block.completedAt } : {},
    ...block.error ? { error: Object.freeze({ ...block.error }) } : {}
  });
}
function freezeSession(session) {
  return Object.freeze({
    debuggerSessionId: session.debuggerSessionId,
    scope: session.scope,
    createdAt: session.createdAt,
    executionBlockIds: Object.freeze([...session.executionBlockIds]),
    completed: session.completed,
    ...session.latestSnapshot ? { latestSnapshot: session.latestSnapshot } : {}
  });
}
var DebuggerRuntimeBridge = class {
  constructor(options) {
    this.options = options;
    this.now = options.now ?? (() => (/* @__PURE__ */ new Date()).toISOString());
  }
  scopes = /* @__PURE__ */ new Map();
  descriptors = new Map(
    DEBUGGER_CAPABILITY_DESCRIPTORS.map((descriptor) => [descriptor.name, descriptor])
  );
  now;
  disposed = false;
  receiptSequence = 0;
  createProvider() {
    return Object.freeze({
      id: DEBUGGER_PROVIDER_ID,
      version: "1.0.0",
      list: (_context) => DEBUGGER_CAPABILITY_DESCRIPTORS,
      get: (name, _context) => this.descriptors.get(name),
      invoke: (name, input, context) => this.invoke(name, input, context)
    });
  }
  async invoke(capability, input, context) {
    this.assertActive();
    if (!this.descriptors.has(capability)) {
      throw Object.assign(new Error(`Unknown debugger capability: ${capability}`), {
        code: "CAPABILITY_NOT_SUPPORTED"
      });
    }
    if (context.signal?.aborted) {
      throw Object.assign(new Error("Debugger execution was cancelled before dispatch."), {
        code: "CANCELLED"
      });
    }
    const scope = deriveDebuggerScope(context);
    const bucket = this.bucket(scope.scopeKey);
    const values = record(input);
    const block = {
      id: scope.executionBlockId,
      capability,
      scope,
      status: "running",
      createdAt: this.now()
    };
    bucket.blocks.set(block.id, block);
    this.emit(bucket, {
      type: "execution-block-created",
      scope,
      executionBlock: freezeBlock(block)
    });
    let debuggerSessionId = text(values, "sessionId");
    let boundSession;
    try {
      if (!UNBOUND_CAPABILITIES.has(capability)) {
        if (!debuggerSessionId) {
          throw Object.assign(new Error("sessionId is required for this debugger capability."), {
            code: "SESSION_NOT_FOUND"
          });
        }
        boundSession = this.requireSession(bucket, debuggerSessionId, scope);
        if (boundSession.completed && !COMPLETED_SESSION_CAPABILITIES.has(capability)) {
          throw Object.assign(
            new Error(`Debugger session is already completed: ${debuggerSessionId}`),
            { code: "INVALID_STATE" }
          );
        }
        boundSession.executionBlockIds.push(block.id);
        block.debuggerSessionId = debuggerSessionId;
      }
      if (capability === "debug.inspect.evaluate") {
        assertSafeExpression(text(values, "expression") ?? "");
      }
      if (capability === "debug.watch.manage") {
        const action2 = text(values, "action");
        const expression = text(values, "expression");
        if ((action2 === "add" || action2 === "evaluate") && expression) {
          assertSafeExpression(expression);
        }
      }
      const output = await this.dispatch(capability, values, scope, bucket, boundSession, context);
      if (capability === "debug.session.launch" || capability === "debug.session.attach") {
        debuggerSessionId = extractDebuggerSessionId(output);
        if (!debuggerSessionId) {
          throw Object.assign(
            new Error(`${capability} did not return a debugger session identifier.`),
            { code: "WORKER_PROTOCOL_ERROR" }
          );
        }
        block.debuggerSessionId = debuggerSessionId;
        boundSession = this.bindSession(bucket, scope, debuggerSessionId, output);
      }
      if (boundSession) {
        const snapshot = extractSnapshot(output);
        if (snapshot) boundSession.latestSnapshot = snapshot;
      }
      let ui;
      if (debuggerSessionId && this.options.ui && context.metadata?.["marshalRuntimeUi"] !== true) {
        ui = await this.options.ui.openOrFocus(scope, debuggerSessionId, context);
      }
      if (boundSession && COMPLETION_CAPABILITIES.has(capability)) {
        boundSession.completed = true;
        boundSession.unsubscribe?.();
        boundSession.unsubscribe = void 0;
        this.emit(bucket, {
          type: "session-completed",
          scope,
          debuggerSessionId: boundSession.debuggerSessionId
        });
      }
      block.status = "completed";
      block.completedAt = this.now();
      this.emit(bucket, {
        type: "execution-block-completed",
        scope,
        debuggerSessionId,
        executionBlock: freezeBlock(block)
      });
      return Object.freeze({
        output: Object.freeze({
          value: output,
          scope,
          executionBlock: freezeBlock(block),
          ...ui ? { ui } : {}
        }),
        provenance: Object.freeze([
          Object.freeze({
            source: DEBUGGER_PROVIDER_ID,
            uri: `runtime://debugger/executions/${encodeURIComponent(block.id)}`,
            retrievedAt: block.completedAt,
            trust: "authoritative"
          })
        ]),
        metadata: Object.freeze({
          scopeKey: scope.scopeKey,
          executionBlockId: block.id,
          ...debuggerSessionId ? { debuggerSessionId } : {}
        }),
        receipt: Object.freeze({
          id: `debugger-receipt-${++this.receiptSequence}`,
          providerId: DEBUGGER_PROVIDER_ID,
          capability,
          executionBlockId: block.id,
          scopeKey: scope.scopeKey,
          completedAt: block.completedAt
        })
      });
    } catch (error) {
      block.status = context.signal?.aborted ? "cancelled" : "failed";
      block.completedAt = this.now();
      block.error = {
        code: errorCode(error),
        message: errorMessage(error)
      };
      this.emit(bucket, {
        type: "execution-block-failed",
        scope,
        debuggerSessionId,
        executionBlock: freezeBlock(block)
      });
      throw error;
    }
  }
  listSessions(scopeKey) {
    const bucket = this.scopes.get(scopeKey);
    if (!bucket) return [];
    return Object.freeze([...bucket.sessions.values()].map(freezeSession));
  }
  getSession(scopeKey, debuggerSessionId) {
    const session = this.scopes.get(scopeKey)?.sessions.get(debuggerSessionId);
    return session ? freezeSession(session) : void 0;
  }
  subscribeScope(scopeKey, listener) {
    const bucket = this.bucket(scopeKey);
    bucket.listeners.add(listener);
    return () => bucket.listeners.delete(listener);
  }
  subscribeSession(scopeKey, debuggerSessionId, listener) {
    return this.subscribeScope(scopeKey, (event) => {
      if (event.debuggerSessionId === debuggerSessionId && event.event?.snapshot) {
        listener(event.event.snapshot);
      }
    });
  }
  async readSource(scope, debuggerSessionId, path) {
    this.assertActive();
    const bucket = this.scopes.get(scope.scopeKey);
    if (!bucket) {
      throw Object.assign(new Error("Debugger scope is not active."), {
        code: "SCOPE_MISMATCH"
      });
    }
    this.requireSession(bucket, debuggerSessionId, scope);
    if (!this.options.host.readSource) {
      throw Object.assign(new Error("The debugger host does not expose source reads."), {
        code: "CAPABILITY_NOT_SUPPORTED"
      });
    }
    return this.options.host.readSource(scope, debuggerSessionId, path);
  }
  async disposeScope(scopeKey) {
    const bucket = this.scopes.get(scopeKey);
    if (!bucket) return;
    for (const session of bucket.sessions.values()) session.unsubscribe?.();
    bucket.sessions.clear();
    bucket.blocks.clear();
    bucket.listeners.clear();
    this.scopes.delete(scopeKey);
    await this.options.host.disposeScope?.(scopeKey);
  }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const scopeKey of [...this.scopes.keys()]) await this.disposeScope(scopeKey);
    if (this.options.disposeHost) await this.options.host.dispose?.();
  }
  async dispatch(capability, input, scope, bucket, session, context) {
    if (capability === "debug.session.list") {
      return {
        sessions: [...bucket.sessions.values()].map(freezeSession),
        count: bucket.sessions.size
      };
    }
    if (capability === "debug.session.get" && session) {
      if (session.latestSnapshot) {
        return { session: freezeSession(session), snapshot: session.latestSnapshot };
      }
    }
    if (capability === "debug.session.events" && session) {
      const after = typeof input["after"] === "number" ? input["after"] : 0;
      const limit = typeof input["limit"] === "number" ? Math.min(input["limit"], 256) : 256;
      const events = session.events.slice(after, after + limit);
      return {
        sessionId: session.debuggerSessionId,
        events,
        next: after + events.length,
        truncated: after + events.length < session.events.length
      };
    }
    if (capability === "debug.source.read" && session) {
      const path = text(input, "path");
      if (!path) throw new TypeError("path is required.");
      return this.readSource(scope, session.debuggerSessionId, path);
    }
    if (capability === "debug.ui.selectExecutionBlock" && session) {
      return {
        selected: true,
        session: freezeSession(session),
        executionBlockId: text(input, "executionBlockId") ?? scope.executionBlockId
      };
    }
    return this.options.host.invoke({
      capability,
      input,
      scope,
      signal: context.signal
    });
  }
  bindSession(bucket, scope, debuggerSessionId, output) {
    if (bucket.sessions.has(debuggerSessionId)) {
      throw Object.assign(new Error(`Debugger session already exists: ${debuggerSessionId}`), {
        code: "INVALID_STATE"
      });
    }
    const session = {
      debuggerSessionId,
      scope,
      createdAt: this.now(),
      executionBlockIds: [scope.executionBlockId],
      completed: false,
      events: [],
      latestSnapshot: extractSnapshot(output)
    };
    if (this.options.host.subscribe) {
      session.unsubscribe = this.options.host.subscribe(
        scope,
        debuggerSessionId,
        (event) => this.onHostEvent(bucket, session, event)
      );
    }
    bucket.sessions.set(debuggerSessionId, session);
    return session;
  }
  onHostEvent(bucket, session, event) {
    if (event.sessionId !== session.debuggerSessionId) return;
    if (event.snapshot) session.latestSnapshot = event.snapshot;
    session.events.push(event);
    if (session.events.length > MAX_EVENTS_PER_SESSION) session.events.shift();
    if (event.type === "terminated" || event.type === "exited" || event.type === "completed") {
      session.completed = true;
      session.unsubscribe?.();
      session.unsubscribe = void 0;
    }
    this.emit(bucket, {
      type: "debugger-event",
      scope: session.scope,
      debuggerSessionId: session.debuggerSessionId,
      event
    });
  }
  requireSession(bucket, debuggerSessionId, scope) {
    const session = bucket.sessions.get(debuggerSessionId);
    if (!session) {
      throw Object.assign(
        new Error(`Debugger session is not owned by this Marshal scope: ${debuggerSessionId}`),
        { code: "SCOPE_MISMATCH" }
      );
    }
    if (session.scope.scopeKey !== scope.scopeKey) {
      throw Object.assign(new Error("Debugger session scope mismatch."), {
        code: "SCOPE_MISMATCH"
      });
    }
    return session;
  }
  bucket(scopeKey) {
    let bucket = this.scopes.get(scopeKey);
    if (!bucket) {
      bucket = {
        sessions: /* @__PURE__ */ new Map(),
        blocks: /* @__PURE__ */ new Map(),
        listeners: /* @__PURE__ */ new Set()
      };
      this.scopes.set(scopeKey, bucket);
    }
    return bucket;
  }
  emit(bucket, event) {
    for (const listener of bucket.listeners) listener(event);
  }
  assertActive() {
    if (this.disposed) {
      throw Object.assign(new Error("Debugger runtime bridge has been disposed."), {
        code: "INVALID_STATE"
      });
    }
  }
};

// src/runtime/debugger-service.ts
var DEBUGGER_SERVICE_SYMBOL = Symbol.for(
  DEBUGGER_SERVICE_ID
);
function createDebuggerServiceProvider(bridge) {
  return Object.freeze({
    invoke: async (input, context) => {
      if (!input || typeof input.capability !== "string" || !input.input) {
        throw new TypeError("Debugger service invoke input must contain capability and input.");
      }
      if (!context) {
        throw new TypeError("Debugger service invoke requires an InvocationContext.");
      }
      return bridge.invoke(input.capability, input.input, context);
    }
  });
}
function createDebuggerServiceContribution(bridge) {
  return Object.freeze({
    token: DEBUGGER_SERVICE_SYMBOL,
    binding: Object.freeze({
      useValue: createDebuggerServiceProvider(bridge)
    })
  });
}

// src/runtime/ui-coordinator.ts
function readInstanceId(value, depth = 0) {
  if (depth > 4) return void 0;
  if (!value || typeof value !== "object") return void 0;
  const output = value;
  const direct = output["instanceId"];
  if (typeof direct === "string") return direct;
  const instance = output["instance"];
  if (instance && typeof instance === "object") {
    const instanceId = instance["instanceId"];
    if (typeof instanceId === "string") return instanceId;
  }
  const instances = output["instances"];
  if (Array.isArray(instances)) {
    for (const candidate of instances) {
      const instanceId = readInstanceId(candidate, depth + 1);
      if (instanceId) return instanceId;
    }
  }
  for (const key of ["output", "result", "value"]) {
    const instanceId = readInstanceId(output[key], depth + 1);
    if (instanceId) return instanceId;
  }
  return void 0;
}
var MarshalDebuggerUiCoordinator = class {
  constructor(activationContext, options = {}) {
    this.activationContext = activationContext;
    this.surface = options.surface ?? "panel";
  }
  surface;
  async openOrFocus(scope, debuggerSessionId, invocationContext) {
    const instanceKey = `debugger:${scope.scopeKey}:${debuggerSessionId}`;
    const state = Object.freeze({
      chatId: scope.chatId,
      runtimeSessionId: scope.sessionId,
      debuggerSessionId,
      executionBlockId: scope.executionBlockId,
      scopeKey: scope.scopeKey,
      workspaceName: scope.workspaceName
    });
    const listed = await this.activationContext.execute(
      {
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
        targetType: "operation",
        target: "ui.application.list",
        input: {
          extensionId: DEBUGGER_PROVIDER_ID,
          applicationId: DEBUGGER_APPLICATION_ID,
          surface: this.surface
        },
        requestId: `${scope.executionBlockId}:list`
      },
      invocationContext
    );
    let instanceId = listed.status === "success" ? readInstanceId(listed.result?.output) : void 0;
    if (!instanceId) {
      const open = await this.activationContext.execute(
        {
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          targetType: "operation",
          target: "ui.application.open",
          input: {
            extensionId: DEBUGGER_PROVIDER_ID,
            applicationId: DEBUGGER_APPLICATION_ID,
            surface: this.surface,
            state,
            idempotencyKey: instanceKey
          },
          requestId: `${scope.executionBlockId}:open`
        },
        invocationContext
      );
      if (open.status !== "success") return { action: "unavailable" };
      instanceId = readInstanceId(open.result?.output);
    }
    if (!instanceId) return { action: "unavailable" };
    const update = await this.activationContext.execute(
      {
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
        targetType: "operation",
        target: "ui.application.update",
        input: {
          extensionId: DEBUGGER_PROVIDER_ID,
          applicationId: DEBUGGER_APPLICATION_ID,
          instanceId,
          state,
          idempotencyKey: `${instanceKey}:update:${scope.executionBlockId}`
        },
        requestId: `${scope.executionBlockId}:update`
      },
      invocationContext
    );
    if (update.status !== "success") return { action: "unavailable" };
    const focus = await this.activationContext.execute(
      {
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
        targetType: "operation",
        target: "ui.application.focus",
        input: {
          extensionId: DEBUGGER_PROVIDER_ID,
          applicationId: DEBUGGER_APPLICATION_ID,
          instanceId,
          idempotencyKey: `${instanceKey}:focus:${scope.executionBlockId}`
        },
        requestId: `${scope.executionBlockId}:focus`
      },
      invocationContext
    );
    if (focus.status !== "success") return { action: "unavailable" };
    return { action: "opened-and-focused", instanceId };
  }
};

// src/runtime/ui-output-schemas.ts
var shallowObjectSchema = Object.freeze({ type: "object" });
var shallowArraySchema = Object.freeze({ type: "array" });
var uiOutputSchemas = /* @__PURE__ */ new Map();
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function requireSchema(value, label) {
  if (!isRecord(value)) {
    throw new Error(`Cannot project ${label}: expected a JSON schema object.`);
  }
  return value;
}
function schemaProperties(schema2, label) {
  const properties = schema2["properties"];
  if (!isRecord(properties)) {
    throw new Error(`Cannot project ${label}: expected object schema properties.`);
  }
  return properties;
}
function schemaRequired(schema2, label) {
  const required = schema2["required"];
  if (!Array.isArray(required) || !required.every((key) => typeof key === "string")) {
    throw new Error(`Cannot project ${label}: expected a string required-property list.`);
  }
  return Object.freeze([...required]);
}
function projectProperty(value, label) {
  const schema2 = requireSchema(value, label);
  const alternatives = schema2["oneOf"];
  if (Array.isArray(alternatives)) {
    const types = alternatives.map((alternative, index) => {
      const type = requireSchema(alternative, `${label}.oneOf[${index}]`)["type"];
      if (typeof type !== "string") {
        throw new Error(`Cannot project ${label}: expected typed oneOf alternatives.`);
      }
      return type;
    });
    return Object.freeze({ type: Object.freeze(types) });
  }
  if (schema2["type"] === "object" || typeof schema2["$ref"] === "string") {
    return shallowObjectSchema;
  }
  if (schema2["type"] === "array") {
    return shallowArraySchema;
  }
  return schema2;
}
function projectObjectSchema(schema2, label) {
  if (schema2["type"] !== "object" || schema2["additionalProperties"] !== false) {
    throw new Error(`Cannot project ${label}: expected a strict object schema.`);
  }
  const properties = Object.fromEntries(
    Object.entries(schemaProperties(schema2, label)).map(([key, value]) => [
      key,
      projectProperty(value, `${label}.${key}`)
    ])
  );
  return Object.freeze({
    type: "object",
    additionalProperties: false,
    properties: Object.freeze(properties),
    required: schemaRequired(schema2, label)
  });
}
function projectValueSchema(value, capability) {
  const schema2 = requireSchema(value, `${capability} value`);
  const alternatives = schema2["oneOf"];
  if (!Array.isArray(alternatives)) {
    return projectObjectSchema(schema2, `${capability} value`);
  }
  if (alternatives.length === 0) {
    throw new Error(`Cannot project ${capability} value: oneOf must not be empty.`);
  }
  const projections = alternatives.map(
    (alternative, index) => projectObjectSchema(
      requireSchema(alternative, `${capability} value.oneOf[${index}]`),
      `${capability} value.oneOf[${index}]`
    )
  );
  const [firstProjection, ...remainingProjections] = projections;
  if (!firstProjection) {
    throw new Error(`Cannot project ${capability} value: oneOf must not be empty.`);
  }
  const mergedProperties = {};
  for (const projection of projections) {
    Object.assign(mergedProperties, projection.properties);
  }
  const properties = Object.freeze(mergedProperties);
  const required = Object.freeze(
    remainingProjections.reduce(
      (common, projection) => common.filter((property) => projection.required.includes(property)),
      [...firstProjection.required]
    )
  );
  return Object.freeze({
    type: "object",
    additionalProperties: false,
    properties,
    required
  });
}
function debuggerUiOutputSchema(capability) {
  const cached = uiOutputSchemas.get(capability);
  if (cached) return cached;
  const fullSchema = debuggerCapabilityOutputSchema(capability);
  if (fullSchema["type"] !== "object" || fullSchema["additionalProperties"] !== false) {
    throw new Error(`Cannot project ${capability}: expected a strict bridge output schema.`);
  }
  const properties = schemaProperties(fullSchema, capability);
  const projectedProperties = Object.freeze(
    Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [
        key,
        key === "value" ? projectValueSchema(value, capability) : projectProperty(value, `${capability}.${key}`)
      ])
    )
  );
  const projected = Object.freeze({
    type: "object",
    additionalProperties: false,
    properties: projectedProperties,
    required: schemaRequired(fullSchema, capability)
  });
  uiOutputSchemas.set(capability, projected);
  return projected;
}

// src/runtime/ui-application.ts
var emptyObjectSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {}
});
var sessionActionSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["sessionId"],
  properties: {
    sessionId: { type: "string", minLength: 1 },
    threadId: { type: "integer" }
  }
});
function action(id, capability, risk, inputSchema = sessionActionSchema) {
  return Object.freeze({
    id,
    version: "1.0.0",
    title: id,
    target: Object.freeze({ kind: "capability", capability }),
    inputSchema,
    outputSchema: debuggerUiOutputSchema(capability),
    allowedScopes: Object.freeze(["session"]),
    requiredPermissions: Object.freeze(
      permissionFor(capability).map(({ permission }) => permission)
    ),
    risk,
    idempotency: risk === "read" ? "supported" : "required"
  });
}
function createDebuggerUiApplication() {
  return Object.freeze({
    id: DEBUGGER_APPLICATION_ID,
    title: "Debugger",
    description: "Native debugger sessions, source, breakpoints, execution controls, stack, variables, watches, console, and event history.",
    renderId: DEBUGGER_RENDER_ID,
    resource: Object.freeze({
      uri: "runtime://debugger/ui/application/v1",
      mimeType: "text/html",
      name: "Agentic Debugger",
      text: '<main id="marshal-agentic-debugger-root" data-render-id="marshal.agentic-debugger.v1" aria-label="Debugger panel"></main>'
    }),
    application: Object.freeze({
      version: "1.0.0",
      presentationModes: Object.freeze(["inline", "fullscreen"]),
      actions: Object.freeze([
        action("continue", "debug.execution.continue", "external-effect"),
        action("pause", "debug.execution.pause", "external-effect"),
        action("step-over", "debug.execution.stepOver", "external-effect"),
        action("step-into", "debug.execution.stepInto", "external-effect"),
        action("step-out", "debug.execution.stepOut", "external-effect"),
        action("set-breakpoint", "debug.breakpoint.set", "write"),
        action("remove-breakpoint", "debug.breakpoint.remove", "write"),
        action("evaluate", "debug.inspect.evaluate", "read"),
        action("refresh", "debug.session.get", "read"),
        action(
          "select-execution-block",
          "debug.ui.selectExecutionBlock",
          "read",
          Object.freeze({
            type: "object",
            additionalProperties: false,
            required: ["sessionId", "executionBlockId"],
            properties: {
              sessionId: { type: "string", minLength: 1 },
              executionBlockId: { type: "string", minLength: 1 }
            }
          })
        )
      ]),
      tools: Object.freeze([
        {
          id: "session",
          name: "debug.session.get",
          inputSchema: sessionActionSchema,
          outputSchema: debuggerUiOutputSchema("debug.session.get")
        },
        {
          id: "events",
          name: "debug.session.events",
          inputSchema: sessionActionSchema,
          outputSchema: debuggerUiOutputSchema("debug.session.events")
        },
        {
          id: "adapters",
          name: "debug.adapter.list",
          inputSchema: emptyObjectSchema,
          outputSchema: debuggerUiOutputSchema("debug.adapter.list")
        }
      ]),
      localState: Object.freeze({ scope: "session", schemaVersion: "1" }),
      authoritativeState: Object.freeze({
        capability: "debug.session.get",
        resourceId: "runtime://debugger/state",
        version: "1"
      })
    }),
    tags: Object.freeze(["debugger", "monaco", "dap"]),
    metadata: Object.freeze({
      moduleExport: "./ui",
      rendererExport: "mountDebuggerRuntimeUi",
      panelSurface: "panel",
      tabSurface: "tab",
      supportsMultipleSessions: true
    })
  });
}

// src/runtime/activation.ts
var DEBUGGER_HOST_ADAPTER_SERVICE = /* @__PURE__ */ Symbol.for(
  "marshal.agentic-debugger.host-adapter"
);
var DEBUGGER_HOST_ADAPTER_SYMBOL = DEBUGGER_HOST_ADAPTER_SERVICE;
var UnavailableDebuggerHostAdapter = class {
  async invoke() {
    throw Object.assign(
      new Error(
        "No debugger host adapter is available. Bind DEBUGGER_HOST_ADAPTER_SERVICE or pass options.host."
      ),
      { code: "WORKER_UNAVAILABLE" }
    );
  }
};
var unavailableHostAdapter = new UnavailableDebuggerHostAdapter();
function globalHostAdapter() {
  const registry = globalThis;
  const value = registry[DEBUGGER_HOST_ADAPTER_SERVICE];
  if (!value || typeof value !== "object") return void 0;
  const candidate = value;
  return typeof candidate.invoke === "function" ? candidate : void 0;
}
function resolveHostAdapter(services) {
  return services?.tryGet(DEBUGGER_HOST_ADAPTER_SERVICE) ?? globalHostAdapter() ?? unavailableHostAdapter;
}
function callTimeHostAdapter(services) {
  const adapter = {
    invoke: (invocation) => resolveHostAdapter(services).invoke(invocation),
    readSource: (scope, debuggerSessionId, path) => {
      const host = resolveHostAdapter(services);
      if (!host.readSource) {
        throw Object.assign(new Error("The debugger host does not expose source reads."), {
          code: "CAPABILITY_NOT_SUPPORTED"
        });
      }
      return host.readSource(scope, debuggerSessionId, path);
    },
    subscribe: (scope, debuggerSessionId, listener) => resolveHostAdapter(services).subscribe?.(scope, debuggerSessionId, listener) ?? (() => {
    }),
    disposeScope: (scopeKey) => resolveHostAdapter(services).disposeScope?.(scopeKey)
  };
  return Object.freeze(adapter);
}
function registerRuntimeDebuggerHostAdapter(adapter) {
  const registry = globalThis;
  const previous = registry[DEBUGGER_HOST_ADAPTER_SERVICE];
  registry[DEBUGGER_HOST_ADAPTER_SERVICE] = adapter;
  return () => {
    if (previous === void 0) {
      delete registry[DEBUGGER_HOST_ADAPTER_SERVICE];
    } else {
      registry[DEBUGGER_HOST_ADAPTER_SERVICE] = previous;
    }
  };
}
function createAgenticDebuggerRuntimeExtension(options = {}) {
  return Object.freeze({
    async activate(context) {
      if (context.signal?.aborted) {
        throw Object.assign(new Error("Debugger extension activation was cancelled."), {
          code: "CANCELLED"
        });
      }
      if (context.manifest.identity !== DEBUGGER_PROVIDER_ID) {
        throw new Error(`Unexpected debugger extension identity: ${context.manifest.identity}`);
      }
      const host = options.host ?? callTimeHostAdapter(context.services);
      const ui = new MarshalDebuggerUiCoordinator(context, {
        surface: options.surface
      });
      const bridge = new DebuggerRuntimeBridge({ host, ui });
      return Object.freeze({
        capabilityProviders: Object.freeze([bridge.createProvider()]),
        serviceContributions: Object.freeze([createDebuggerServiceContribution(bridge)]),
        uiApplications: Object.freeze([createDebuggerUiApplication()]),
        dispose: () => bridge.dispose()
      });
    }
  });
}

// src/runtime/entry.ts
var extension = createAgenticDebuggerRuntimeExtension();
var activate = extension.activate.bind(extension);

exports.DEBUGGER_HOST_ADAPTER_SERVICE = DEBUGGER_HOST_ADAPTER_SERVICE;
exports.DEBUGGER_HOST_ADAPTER_SYMBOL = DEBUGGER_HOST_ADAPTER_SYMBOL;
exports.DEBUGGER_SERVICE_ID = DEBUGGER_SERVICE_ID;
exports.DEBUGGER_SERVICE_SYMBOL = DEBUGGER_SERVICE_SYMBOL;
exports.DEBUGGER_SERVICE_VERSION = DEBUGGER_SERVICE_VERSION;
exports.activate = activate;
exports.createAgenticDebuggerRuntimeExtension = createAgenticDebuggerRuntimeExtension;
exports.registerRuntimeDebuggerHostAdapter = registerRuntimeDebuggerHostAdapter;
//# sourceMappingURL=runtime-extension.cjs.map
//# sourceMappingURL=runtime-extension.cjs.map
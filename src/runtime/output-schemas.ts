type JsonSchema = Readonly<Record<string, unknown>>;

function schema<T extends Record<string, unknown>>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function objectSchema(
  properties: Readonly<Record<string, JsonSchema>>,
  required: readonly string[] = [],
): JsonSchema {
  return schema({
    type: 'object',
    additionalProperties: false,
    properties,
    required,
  });
}

function arraySchema(items: JsonSchema): JsonSchema {
  return schema({ type: 'array', items });
}

function oneOfSchema(...schemas: readonly JsonSchema[]): JsonSchema {
  return schema({ oneOf: schemas });
}

const opaqueValueSchema = schema({});
const stringSchema = schema({ type: 'string' });
const nonEmptyStringSchema = schema({ type: 'string', minLength: 1 });
const integerSchema = schema({ type: 'integer' });
const nonNegativeIntegerSchema = schema({ type: 'integer', minimum: 0 });
const booleanSchema = schema({ type: 'boolean' });
const stringOrIntegerSchema = oneOfSchema(stringSchema, integerSchema);

const checksumSchema = objectSchema(
  {
    algorithm: schema({ enum: ['MD5', 'SHA1', 'SHA256', 'timestamp'] }),
    checksum: stringSchema,
  },
  ['algorithm', 'checksum'],
);

const dapSourceSchema = objectSchema({
  name: stringSchema,
  path: stringSchema,
  sourceReference: integerSchema,
  presentationHint: schema({ enum: ['normal', 'emphasize', 'deemphasize'] }),
  origin: stringSchema,
  sources: arraySchema(schema({ $ref: '#/$defs/dapSource' })),
  adapterData: opaqueValueSchema,
  checksums: arraySchema(checksumSchema),
});

const dapBreakpointSchema = objectSchema(
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
    reason: schema({ enum: ['pending', 'failed'] }),
  },
  ['verified'],
);

const debuggerVariableSchema = objectSchema(
  {
    name: stringSchema,
    value: stringSchema,
    type: stringSchema,
    variablesReference: integerSchema,
    redacted: booleanSchema,
    children: arraySchema(schema({ $ref: '#/$defs/debuggerVariable' })),
  },
  ['name', 'value'],
);

const exceptionDetailsSchema = objectSchema({
  message: stringSchema,
  typeName: stringSchema,
  fullTypeName: stringSchema,
  evaluateName: stringSchema,
  stackTrace: stringSchema,
  innerException: arraySchema(schema({ $ref: '#/$defs/exceptionDetails' })),
});

const outputDefinitions = Object.freeze({
  dapSource: dapSourceSchema,
  debuggerVariable: debuggerVariableSchema,
  exceptionDetails: exceptionDetailsSchema,
});

const debuggerSourceFileSchema = objectSchema(
  {
    path: stringSchema,
    name: stringSchema,
    language: stringSchema,
    content: stringSchema,
  },
  ['path', 'language'],
);

const debuggerSourceLocationSchema = objectSchema(
  {
    file: stringSchema,
    line: integerSchema,
    column: integerSchema,
  },
  ['file', 'line'],
);

const debuggerBreakpointSchema = objectSchema(
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
    origin: schema({ enum: ['agent', 'human'] }),
  },
  ['id', 'file', 'line', 'enabled', 'verified', 'origin'],
);

const debuggerStackFrameSchema = objectSchema(
  {
    id: integerSchema,
    name: stringSchema,
    source: stringSchema,
    line: integerSchema,
    column: integerSchema,
  },
  ['id', 'name'],
);

const debuggerWatchValueSchema = objectSchema(
  {
    id: stringSchema,
    expression: stringSchema,
    value: stringSchema,
    type: stringSchema,
    error: stringSchema,
    origin: schema({ enum: ['agent', 'human'] }),
  },
  ['id', 'expression', 'origin'],
);

const debuggerConsoleEntrySchema = objectSchema(
  {
    id: stringSchema,
    expression: stringSchema,
    result: stringSchema,
    type: stringSchema,
    error: stringSchema,
    origin: schema({ enum: ['agent', 'human'] }),
    timestamp: stringSchema,
  },
  ['id', 'expression', 'origin', 'timestamp'],
);

const debuggerOutputEventSchema = objectSchema(
  {
    id: stringSchema,
    category: schema({ enum: ['debugger', 'stdout', 'stderr', 'telemetry'] }),
    message: stringSchema,
    timestamp: stringSchema,
  },
  ['id', 'category', 'message', 'timestamp'],
);

const debuggerSnapshotSchema = objectSchema(
  {
    state: schema({ enum: ['paused', 'running', 'completed'] }),
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
    events: arraySchema(debuggerOutputEventSchema),
  },
  ['state', 'sources', 'breakpoints', 'callStack', 'locals', 'watches', 'console', 'events'],
);

const debuggerScopeSchema = objectSchema(
  {
    chatId: nonEmptyStringSchema,
    sessionId: nonEmptyStringSchema,
    workspaceName: nonEmptyStringSchema,
    executionBlockId: nonEmptyStringSchema,
    scopeKey: nonEmptyStringSchema,
  },
  ['chatId', 'sessionId', 'workspaceName', 'executionBlockId', 'scopeKey'],
);

const executionBlockSchema = objectSchema(
  {
    id: nonEmptyStringSchema,
    capability: nonEmptyStringSchema,
    debuggerSessionId: nonEmptyStringSchema,
    scope: debuggerScopeSchema,
    status: schema({ const: 'completed' }),
    createdAt: stringSchema,
    completedAt: stringSchema,
  },
  ['id', 'capability', 'scope', 'status', 'createdAt', 'completedAt'],
);

const debuggerUiOpenResultSchema = oneOfSchema(
  objectSchema({ action: schema({ const: 'unavailable' }) }, ['action']),
  objectSchema(
    {
      action: schema({ const: 'opened-and-focused' }),
      instanceId: nonEmptyStringSchema,
    },
    ['action', 'instanceId'],
  ),
);

const boundSessionSchema = objectSchema(
  {
    debuggerSessionId: nonEmptyStringSchema,
    scope: debuggerScopeSchema,
    createdAt: stringSchema,
    executionBlockIds: arraySchema(nonEmptyStringSchema),
    completed: booleanSchema,
    latestSnapshot: debuggerSnapshotSchema,
  },
  ['debuggerSessionId', 'scope', 'createdAt', 'executionBlockIds', 'completed'],
);

const debuggerHostEventSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    type: nonEmptyStringSchema,
    occurredAt: stringSchema,
    body: opaqueValueSchema,
    snapshot: debuggerSnapshotSchema,
  },
  ['sessionId', 'type', 'occurredAt'],
);

const dapStackFrameSchema = objectSchema(
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
    presentationHint: schema({ enum: ['normal', 'label', 'subtle'] }),
  },
  ['id', 'name', 'line', 'column'],
);

const dapThreadSchema = objectSchema(
  {
    id: integerSchema,
    name: stringSchema,
  },
  ['id', 'name'],
);

const dapScopeSchema = objectSchema(
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
    endColumn: integerSchema,
  },
  ['name', 'variablesReference', 'expensive'],
);

const dapModuleSchema = objectSchema(
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
    addressRange: stringSchema,
  },
  ['id', 'name'],
);

const adapterSchema = objectSchema(
  {
    type: schema({ enum: ['js-debug', 'debugpy', 'netcoredbg', 'clr-debug', 'vsdbg'] }),
    languages: arraySchema(schema({ enum: ['javascript', 'typescript', 'python', 'csharp'] })),
    attachOnly: booleanSchema,
    optIn: booleanSchema,
  },
  ['type', 'languages'],
);

const sessionSnapshotValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    snapshot: debuggerSnapshotSchema,
  },
  ['sessionId', 'snapshot'],
);

const sessionListValueSchema = objectSchema(
  {
    sessions: arraySchema(boundSessionSchema),
    count: nonNegativeIntegerSchema,
  },
  ['sessions', 'count'],
);

const sessionGetValueSchema = oneOfSchema(
  objectSchema(
    {
      session: boundSessionSchema,
      snapshot: debuggerSnapshotSchema,
    },
    ['session', 'snapshot'],
  ),
  sessionSnapshotValueSchema,
);

const sessionEventsValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    events: arraySchema(debuggerHostEventSchema),
    next: nonNegativeIntegerSchema,
    truncated: booleanSchema,
  },
  ['sessionId', 'events', 'next', 'truncated'],
);

const sessionRestartValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    restarted: schema({ const: true }),
    snapshot: debuggerSnapshotSchema,
  },
  ['sessionId', 'restarted', 'snapshot'],
);

function sessionCloseValueSchema(property: 'disconnected' | 'terminated'): JsonSchema {
  return objectSchema(
    {
      sessionId: nonEmptyStringSchema,
      [property]: schema({ const: true }),
      snapshot: debuggerSnapshotSchema,
    },
    ['sessionId', property, 'snapshot'],
  );
}

const breakpointValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    breakpoint: debuggerBreakpointSchema,
    snapshot: debuggerSnapshotSchema,
  },
  ['sessionId', 'breakpoint', 'snapshot'],
);

const breakpointRemoveValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    removed: nonEmptyStringSchema,
    snapshot: debuggerSnapshotSchema,
  },
  ['sessionId', 'removed', 'snapshot'],
);

const breakpointListValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    breakpoints: arraySchema(debuggerBreakpointSchema),
  },
  ['sessionId', 'breakpoints'],
);

const dapBreakpointResponseSchema = objectSchema({
  breakpoints: arraySchema(dapBreakpointSchema),
});

const breakpointResponseValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    response: dapBreakpointResponseSchema,
  },
  ['sessionId', 'response'],
);

const exceptionBreakpointValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    filters: arraySchema(stringSchema),
  },
  ['sessionId', 'filters'],
);

function executionControlValueSchema(nativeAction: string, capabilityAction?: string): JsonSchema {
  return objectSchema(
    {
      sessionId: nonEmptyStringSchema,
      threadId: integerSchema,
      action: capabilityAction
        ? schema({ enum: [capabilityAction, nativeAction] })
        : schema({ const: nativeAction }),
      snapshot: debuggerSnapshotSchema,
    },
    capabilityAction
      ? ['sessionId', 'action', 'snapshot']
      : ['sessionId', 'threadId', 'action', 'snapshot'],
  );
}

const restartFrameValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    frameId: integerSchema,
  },
  ['sessionId', 'frameId'],
);

const setNextStatementValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    threadId: integerSchema,
    file: stringSchema,
    line: integerSchema,
  },
  ['sessionId', 'threadId', 'file', 'line'],
);

const evaluateValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    result: stringSchema,
    type: stringSchema,
    variablesReference: integerSchema,
    snapshot: debuggerSnapshotSchema,
  },
  ['sessionId', 'result', 'variablesReference', 'snapshot'],
);

const variablesValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    variablesReference: integerSchema,
    variables: arraySchema(debuggerVariableSchema),
  },
  ['sessionId', 'variablesReference', 'variables'],
);

const callStackValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    threadId: integerSchema,
    stackFrames: arraySchema(dapStackFrameSchema),
  },
  ['sessionId', 'threadId', 'stackFrames'],
);

const threadsValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    threads: arraySchema(dapThreadSchema),
  },
  ['sessionId', 'threads'],
);

const scopesValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    frameId: integerSchema,
    scopes: arraySchema(dapScopeSchema),
  },
  ['sessionId', 'frameId', 'scopes'],
);

const watchValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    action: schema({ enum: ['add', 'remove', 'list', 'evaluate'] }),
    watches: arraySchema(debuggerWatchValueSchema),
    snapshot: debuggerSnapshotSchema,
  },
  ['sessionId', 'action', 'watches', 'snapshot'],
);

const loadedSourcesValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    sources: arraySchema(dapSourceSchema),
    snapshot: debuggerSnapshotSchema,
  },
  ['sessionId', 'sources', 'snapshot'],
);

const modulesValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    modules: objectSchema({
      modules: arraySchema(dapModuleSchema),
      totalModules: nonNegativeIntegerSchema,
    }),
  },
  ['sessionId', 'modules'],
);

const exceptionInfoValueSchema = objectSchema(
  {
    sessionId: nonEmptyStringSchema,
    threadId: integerSchema,
    exception: objectSchema({
      exceptionId: stringSchema,
      description: stringSchema,
      breakMode: schema({ enum: ['never', 'always', 'unhandled', 'userUnhandled'] }),
      details: exceptionDetailsSchema,
    }),
  },
  ['sessionId', 'threadId', 'exception'],
);

const adapterListValueSchema = objectSchema(
  {
    adapters: arraySchema(adapterSchema),
  },
  ['adapters'],
);

const selectExecutionBlockValueSchema = objectSchema(
  {
    selected: schema({ const: true }),
    session: boundSessionSchema,
    executionBlockId: nonEmptyStringSchema,
  },
  ['selected', 'session', 'executionBlockId'],
);

function bridgeOutputSchema(value: JsonSchema): JsonSchema {
  return schema({
    type: 'object',
    additionalProperties: false,
    properties: {
      value,
      scope: debuggerScopeSchema,
      executionBlock: executionBlockSchema,
      ui: debuggerUiOpenResultSchema,
    },
    required: ['value', 'scope', 'executionBlock'],
    $defs: outputDefinitions,
  });
}

export const DEBUGGER_CAPABILITY_OUTPUT_SCHEMAS: Readonly<Record<string, JsonSchema>> =
  Object.freeze({
    'debug.session.launch': bridgeOutputSchema(sessionSnapshotValueSchema),
    'debug.session.attach': bridgeOutputSchema(sessionSnapshotValueSchema),
    'debug.session.disconnect': bridgeOutputSchema(sessionCloseValueSchema('disconnected')),
    'debug.session.terminate': bridgeOutputSchema(sessionCloseValueSchema('terminated')),
    'debug.session.list': bridgeOutputSchema(sessionListValueSchema),
    'debug.session.restart': bridgeOutputSchema(sessionRestartValueSchema),
    'debug.breakpoint.set': bridgeOutputSchema(breakpointValueSchema),
    'debug.breakpoint.remove': bridgeOutputSchema(breakpointRemoveValueSchema),
    'debug.breakpoint.setFunction': bridgeOutputSchema(breakpointResponseValueSchema),
    'debug.breakpoint.setException': bridgeOutputSchema(exceptionBreakpointValueSchema),
    'debug.breakpoint.setData': bridgeOutputSchema(breakpointResponseValueSchema),
    'debug.breakpoint.list': bridgeOutputSchema(breakpointListValueSchema),
    'debug.breakpoint.enable': bridgeOutputSchema(breakpointValueSchema),
    'debug.breakpoint.disable': bridgeOutputSchema(breakpointValueSchema),
    'debug.execution.continue': bridgeOutputSchema(
      executionControlValueSchema('continue', 'debug.execution.continue'),
    ),
    'debug.execution.stepOver': bridgeOutputSchema(
      executionControlValueSchema('next', 'debug.execution.stepOver'),
    ),
    'debug.execution.stepInto': bridgeOutputSchema(
      executionControlValueSchema('stepIn', 'debug.execution.stepInto'),
    ),
    'debug.execution.stepOut': bridgeOutputSchema(
      executionControlValueSchema('stepOut', 'debug.execution.stepOut'),
    ),
    'debug.execution.pause': bridgeOutputSchema(
      executionControlValueSchema('pause', 'debug.execution.pause'),
    ),
    'debug.execution.setNextStatement': bridgeOutputSchema(setNextStatementValueSchema),
    'debug.execution.restartFrame': bridgeOutputSchema(restartFrameValueSchema),
    'debug.execution.reverseContinue': bridgeOutputSchema(
      executionControlValueSchema('reverseContinue'),
    ),
    'debug.inspect.evaluate': bridgeOutputSchema(evaluateValueSchema),
    'debug.inspect.variables': bridgeOutputSchema(variablesValueSchema),
    'debug.inspect.callStack': bridgeOutputSchema(callStackValueSchema),
    'debug.inspect.threads': bridgeOutputSchema(threadsValueSchema),
    'debug.inspect.scopes': bridgeOutputSchema(scopesValueSchema),
    'debug.watch.manage': bridgeOutputSchema(watchValueSchema),
    'debug.inspect.loadedSources': bridgeOutputSchema(loadedSourcesValueSchema),
    'debug.inspect.modules': bridgeOutputSchema(modulesValueSchema),
    'debug.inspect.exceptionInfo': bridgeOutputSchema(exceptionInfoValueSchema),
    'debug.session.get': bridgeOutputSchema(sessionGetValueSchema),
    'debug.session.events': bridgeOutputSchema(sessionEventsValueSchema),
    'debug.adapter.list': bridgeOutputSchema(adapterListValueSchema),
    'debug.source.read': bridgeOutputSchema(debuggerSourceFileSchema),
    'debug.ui.selectExecutionBlock': bridgeOutputSchema(selectExecutionBlockValueSchema),
  });

export function debuggerCapabilityOutputSchema(name: string): JsonSchema {
  const outputSchema = DEBUGGER_CAPABILITY_OUTPUT_SCHEMAS[name];
  if (!outputSchema) {
    throw new Error(`Missing strict output schema for debugger capability: ${name}`);
  }
  return outputSchema;
}

import type { CapabilityDescriptor } from './contracts.js';
import { debuggerCapabilityOutputSchema } from './output-schemas.js';

export const DEBUGGER_PROVIDER_ID = '@marshal/agentic-debugger-extension';
export const DEBUGGER_APPLICATION_ID = 'debugger';
export const DEBUGGER_RENDER_ID = 'marshal.agentic-debugger.v1';
export const RUNTIME_PROTOCOL_VERSION = '1.0.0';
export const DEBUGGER_CAPABILITY_VERSION = '1.0.0';
export const DEBUGGER_SERVICE_ID = '@marshal/agentic-debugger:debugger';
export const DEBUGGER_SERVICE_VERSION = '1.0.0';

export const DEBUGGER_COMMAND_CAPABILITY_MAP = Object.freeze({
  launch_debug: 'debug.session.launch',
  attach_debug: 'debug.session.attach',
  disconnect: 'debug.session.disconnect',
  terminate: 'debug.session.terminate',
  list_sessions: 'debug.session.list',
  restart_session: 'debug.session.restart',
  set_breakpoint: 'debug.breakpoint.set',
  remove_breakpoint: 'debug.breakpoint.remove',
  set_function_breakpoint: 'debug.breakpoint.setFunction',
  set_exception_breakpoints: 'debug.breakpoint.setException',
  set_data_breakpoint: 'debug.breakpoint.setData',
  list_breakpoints: 'debug.breakpoint.list',
  enable_breakpoint: 'debug.breakpoint.enable',
  disable_breakpoint: 'debug.breakpoint.disable',
  continue_execution: 'debug.execution.continue',
  step_over: 'debug.execution.stepOver',
  step_into: 'debug.execution.stepInto',
  step_out: 'debug.execution.stepOut',
  pause_execution: 'debug.execution.pause',
  set_next_statement: 'debug.execution.setNextStatement',
  restart_frame: 'debug.execution.restartFrame',
  reverse_continue: 'debug.execution.reverseContinue',
  evaluate_expression: 'debug.inspect.evaluate',
  get_variables: 'debug.inspect.variables',
  get_call_stack: 'debug.inspect.callStack',
  get_threads: 'debug.inspect.threads',
  get_scopes: 'debug.inspect.scopes',
  manage_watch: 'debug.watch.manage',
  get_loaded_sources: 'debug.inspect.loadedSources',
  get_modules: 'debug.inspect.modules',
  get_exception_info: 'debug.inspect.exceptionInfo',
} as const);

export type LegacyDebuggerCommand = keyof typeof DEBUGGER_COMMAND_CAPABILITY_MAP;
export type DebuggerCapabilityName =
  (typeof DEBUGGER_COMMAND_CAPABILITY_MAP)[LegacyDebuggerCommand];

export const RUNTIME_DEBUGGER_CAPABILITIES = Object.freeze([
  'debug.session.get',
  'debug.session.events',
  'debug.adapter.list',
  'debug.source.read',
  'debug.ui.selectExecutionBlock',
] as const);

const stringProperty = Object.freeze({ type: 'string', minLength: 1, maxLength: 16_384 });
const sessionIdProperty = Object.freeze({ type: 'string', minLength: 1, maxLength: 256 });
const integerProperty = Object.freeze({ type: 'integer' });
const positiveIntegerProperty = Object.freeze({ type: 'integer', minimum: 1 });
const booleanProperty = Object.freeze({ type: 'boolean' });

function objectSchema(
  properties: Readonly<Record<string, unknown>>,
  required: readonly string[] = [],
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    type: 'object',
    additionalProperties: false,
    required,
    properties,
  });
}

const sessionInput = objectSchema({ sessionId: sessionIdProperty }, ['sessionId']);
const threadInput = objectSchema({ sessionId: sessionIdProperty, threadId: integerProperty }, [
  'sessionId',
]);
const frameInput = objectSchema({ sessionId: sessionIdProperty, frameId: integerProperty }, [
  'sessionId',
  'frameId',
]);
const inputs: Readonly<Record<string, Readonly<Record<string, unknown>>>> = Object.freeze({
  'debug.session.launch': objectSchema(
    {
      program: stringProperty,
      language: { enum: ['typescript', 'javascript', 'python', 'csharp'] },
      adapter: { enum: ['js-debug', 'debugpy', 'netcoredbg', 'clr-debug', 'vsdbg'] },
      args: { type: 'array', items: stringProperty, maxItems: 256 },
      cwd: stringProperty,
      env: { type: 'object', additionalProperties: { type: 'string' } },
      stopOnEntry: booleanProperty,
    },
    ['program'],
  ),
  'debug.session.attach': objectSchema(
    {
      pid: positiveIntegerProperty,
      host: stringProperty,
      port: positiveIntegerProperty,
      language: { enum: ['typescript', 'javascript', 'python', 'csharp'] },
      adapter: { enum: ['js-debug', 'debugpy', 'netcoredbg', 'clr-debug', 'vsdbg'] },
      type: { enum: ['node', 'chrome', 'msedge'] },
    },
    ['language'],
  ),
  'debug.session.disconnect': objectSchema(
    { sessionId: sessionIdProperty, terminateDebuggee: booleanProperty },
    ['sessionId'],
  ),
  'debug.session.terminate': sessionInput,
  'debug.session.list': objectSchema({}),
  'debug.session.restart': sessionInput,
  'debug.breakpoint.set': objectSchema(
    {
      sessionId: sessionIdProperty,
      file: stringProperty,
      line: positiveIntegerProperty,
      condition: stringProperty,
      hitCondition: stringProperty,
      logMessage: stringProperty,
      origin: { enum: ['agent', 'human'] },
    },
    ['sessionId', 'file', 'line'],
  ),
  'debug.breakpoint.remove': objectSchema(
    {
      sessionId: sessionIdProperty,
      breakpointId: sessionIdProperty,
      file: stringProperty,
      line: positiveIntegerProperty,
    },
    ['sessionId'],
  ),
  'debug.breakpoint.setFunction': objectSchema(
    {
      sessionId: sessionIdProperty,
      name: stringProperty,
      condition: stringProperty,
      hitCondition: stringProperty,
    },
    ['sessionId', 'name'],
  ),
  'debug.breakpoint.setException': objectSchema(
    {
      sessionId: sessionIdProperty,
      filters: { type: 'array', items: stringProperty, maxItems: 64 },
    },
    ['sessionId', 'filters'],
  ),
  'debug.breakpoint.setData': objectSchema(
    {
      sessionId: sessionIdProperty,
      dataId: stringProperty,
      accessType: { enum: ['read', 'write', 'readWrite'] },
    },
    ['sessionId', 'dataId'],
  ),
  'debug.breakpoint.list': sessionInput,
  'debug.breakpoint.enable': objectSchema(
    {
      sessionId: sessionIdProperty,
      breakpointId: sessionIdProperty,
      file: stringProperty,
      line: positiveIntegerProperty,
    },
    ['sessionId'],
  ),
  'debug.breakpoint.disable': objectSchema(
    {
      sessionId: sessionIdProperty,
      breakpointId: sessionIdProperty,
      file: stringProperty,
      line: positiveIntegerProperty,
    },
    ['sessionId'],
  ),
  'debug.execution.continue': threadInput,
  'debug.execution.stepOver': threadInput,
  'debug.execution.stepInto': threadInput,
  'debug.execution.stepOut': threadInput,
  'debug.execution.pause': threadInput,
  'debug.execution.setNextStatement': objectSchema(
    {
      sessionId: sessionIdProperty,
      file: stringProperty,
      line: positiveIntegerProperty,
      threadId: integerProperty,
    },
    ['sessionId', 'file', 'line'],
  ),
  'debug.execution.restartFrame': frameInput,
  'debug.execution.reverseContinue': threadInput,
  'debug.inspect.evaluate': objectSchema(
    {
      sessionId: sessionIdProperty,
      expression: stringProperty,
      frameId: integerProperty,
      context: { enum: ['watch', 'repl', 'hover'] },
      origin: { enum: ['agent', 'human'] },
    },
    ['sessionId', 'expression'],
  ),
  'debug.inspect.variables': objectSchema(
    {
      sessionId: sessionIdProperty,
      variablesReference: integerProperty,
      depth: positiveIntegerProperty,
      maxProperties: positiveIntegerProperty,
    },
    ['sessionId', 'variablesReference'],
  ),
  'debug.inspect.callStack': objectSchema(
    {
      sessionId: sessionIdProperty,
      threadId: integerProperty,
      startFrame: { type: 'integer', minimum: 0 },
      levels: positiveIntegerProperty,
    },
    ['sessionId'],
  ),
  'debug.inspect.threads': sessionInput,
  'debug.inspect.scopes': frameInput,
  'debug.watch.manage': objectSchema(
    {
      sessionId: sessionIdProperty,
      action: { enum: ['add', 'remove', 'list', 'evaluate'] },
      expression: stringProperty,
      frameId: integerProperty,
      origin: { enum: ['agent', 'human'] },
      watchId: sessionIdProperty,
    },
    ['sessionId', 'action'],
  ),
  'debug.inspect.loadedSources': sessionInput,
  'debug.inspect.modules': objectSchema(
    {
      sessionId: sessionIdProperty,
      startModule: { type: 'integer', minimum: 0 },
      moduleCount: positiveIntegerProperty,
    },
    ['sessionId'],
  ),
  'debug.inspect.exceptionInfo': objectSchema(
    { sessionId: sessionIdProperty, threadId: integerProperty },
    ['sessionId', 'threadId'],
  ),
  'debug.session.get': sessionInput,
  'debug.session.events': objectSchema(
    {
      sessionId: sessionIdProperty,
      after: { type: 'integer', minimum: 0 },
      limit: { type: 'integer', minimum: 1, maximum: 256 },
    },
    ['sessionId'],
  ),
  'debug.adapter.list': objectSchema({}),
  'debug.source.read': objectSchema({ sessionId: sessionIdProperty, path: stringProperty }, [
    'sessionId',
    'path',
  ]),
  'debug.ui.selectExecutionBlock': objectSchema(
    { sessionId: sessionIdProperty, executionBlockId: sessionIdProperty },
    ['sessionId', 'executionBlockId'],
  ),
});

export const MARSHAL_TOOL_INVOCATION_PERMISSION_PREFIX = 'marshal.tool.invoke:';

export function permissionFor(name: string): NonNullable<CapabilityDescriptor['permissions']> {
  let risk: 'low' | 'medium' | 'high' | 'critical' = 'low';
  if (name === 'debug.session.launch') {
    risk = 'high';
  } else if (name === 'debug.session.attach' || name === 'debug.session.terminate') {
    risk = 'critical';
  } else if (
    name === 'debug.session.disconnect' ||
    name === 'debug.session.restart' ||
    name.startsWith('debug.execution.')
  ) {
    risk = 'high';
  } else if (
    name.startsWith('debug.breakpoint.') ||
    name === 'debug.inspect.evaluate' ||
    name === 'debug.watch.manage'
  ) {
    risk = 'medium';
  }

  return [
    {
      permission: `${MARSHAL_TOOL_INVOCATION_PERMISSION_PREFIX}${name}`,
      risk,
    },
  ];
}

const descriptions: Readonly<Record<string, string>> = Object.freeze({
  'debug.session.launch': 'Launch a program under a native debug adapter.',
  'debug.session.attach': 'Attach a native debug adapter to an authorized process or endpoint.',
  'debug.session.disconnect': 'Disconnect a debugger session.',
  'debug.session.terminate': 'Terminate a debugger session and its debuggee.',
  'debug.session.list': 'List debugger sessions owned by the current Marshal scope.',
  'debug.session.restart': 'Restart an existing debugger session.',
  'debug.breakpoint.set': 'Set a line breakpoint.',
  'debug.breakpoint.remove': 'Remove a line breakpoint.',
  'debug.breakpoint.setFunction': 'Set a function breakpoint.',
  'debug.breakpoint.setException': 'Set exception breakpoint filters.',
  'debug.breakpoint.setData': 'Set a data breakpoint.',
  'debug.breakpoint.list': 'List breakpoints for one debugger session.',
  'debug.breakpoint.enable': 'Enable a breakpoint.',
  'debug.breakpoint.disable': 'Disable a breakpoint.',
  'debug.execution.continue': 'Continue paused execution.',
  'debug.execution.stepOver': 'Step over the current statement.',
  'debug.execution.stepInto': 'Step into the current call.',
  'debug.execution.stepOut': 'Step out of the current frame.',
  'debug.execution.pause': 'Pause running execution.',
  'debug.execution.setNextStatement': 'Move the execution point.',
  'debug.execution.restartFrame': 'Restart a stack frame.',
  'debug.execution.reverseContinue': 'Continue execution in reverse.',
  'debug.inspect.evaluate': 'Safely evaluate an expression in the selected frame.',
  'debug.inspect.variables': 'Read variables for a DAP variables reference.',
  'debug.inspect.callStack': 'Read the call stack for the stopped thread.',
  'debug.inspect.threads': 'List debugger threads.',
  'debug.inspect.scopes': 'List variable scopes for a frame.',
  'debug.watch.manage': 'Add, remove, list, or evaluate watch expressions.',
  'debug.inspect.loadedSources': 'List source files known to the adapter.',
  'debug.inspect.modules': 'List modules known to the adapter.',
  'debug.inspect.exceptionInfo': 'Read exception details for a stopped thread.',
  'debug.session.get': 'Read the authoritative debugger UI snapshot.',
  'debug.session.events': 'Read bounded debugger event history.',
  'debug.adapter.list': 'List available native debugger adapters.',
  'debug.source.read': 'Read a source file already associated with the debugger session.',
  'debug.ui.selectExecutionBlock': 'Open or focus the debugger UI for an execution block.',
});

const allCapabilityNames = [
  ...Object.values(DEBUGGER_COMMAND_CAPABILITY_MAP),
  ...RUNTIME_DEBUGGER_CAPABILITIES,
];

export const DEBUGGER_CAPABILITY_DESCRIPTORS: readonly CapabilityDescriptor[] = Object.freeze(
  allCapabilityNames.map((name) =>
    Object.freeze({
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      name,
      version: DEBUGGER_CAPABILITY_VERSION,
      title: name,
      description: descriptions[name] ?? name,
      tags: Object.freeze(['debugger', 'dap', 'agentic-debugger']),
      inputSchema: inputs[name] ?? objectSchema({}),
      outputSchema: debuggerCapabilityOutputSchema(name),
      permissions: permissionFor(name),
      annotations: Object.freeze({
        executionBlock: true,
        scopeSource: 'invocation-context',
      }),
    }),
  ),
);

export const DEBUGGER_CAPABILITY_NAMES = Object.freeze(
  DEBUGGER_CAPABILITY_DESCRIPTORS.map((descriptor) => descriptor.name),
);

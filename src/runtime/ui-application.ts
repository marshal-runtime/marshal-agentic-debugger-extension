import { DEBUGGER_APPLICATION_ID, DEBUGGER_RENDER_ID, permissionFor } from './capabilities.js';
import type { RuntimeExtensionUiApplication } from './contracts.js';
import { debuggerUiOutputSchema } from './ui-output-schemas.js';

const emptyObjectSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {},
});

const sessionActionSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['sessionId'],
  properties: {
    sessionId: { type: 'string', minLength: 1 },
    threadId: { type: 'integer' },
  },
});

function action(
  id: string,
  capability: string,
  risk: 'read' | 'write' | 'external-effect',
  inputSchema: Readonly<Record<string, unknown>> = sessionActionSchema,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    id,
    version: '1.0.0',
    title: id,
    target: Object.freeze({ kind: 'capability', capability }),
    inputSchema,
    outputSchema: debuggerUiOutputSchema(capability),
    allowedScopes: Object.freeze(['session']),
    requiredPermissions: Object.freeze(
      permissionFor(capability).map(({ permission }) => permission),
    ),
    risk,
    idempotency: risk === 'read' ? 'supported' : 'required',
  });
}

export function createDebuggerUiApplication(): RuntimeExtensionUiApplication {
  return Object.freeze({
    id: DEBUGGER_APPLICATION_ID,
    title: 'Debugger',
    description:
      'Native debugger sessions, source, breakpoints, execution controls, stack, variables, watches, console, and event history.',
    renderId: DEBUGGER_RENDER_ID,
    resource: Object.freeze({
      uri: 'runtime://debugger/ui/application/v1',
      mimeType: 'text/html',
      name: 'Agentic Debugger',
      text: '<main id="marshal-agentic-debugger-root" data-render-id="marshal.agentic-debugger.v1" aria-label="Debugger panel"></main>',
    }),
    application: Object.freeze({
      version: '1.0.0',
      presentationModes: Object.freeze(['inline', 'fullscreen'] as const),
      actions: Object.freeze([
        action('continue', 'debug.execution.continue', 'external-effect'),
        action('pause', 'debug.execution.pause', 'external-effect'),
        action('step-over', 'debug.execution.stepOver', 'external-effect'),
        action('step-into', 'debug.execution.stepInto', 'external-effect'),
        action('step-out', 'debug.execution.stepOut', 'external-effect'),
        action('set-breakpoint', 'debug.breakpoint.set', 'write'),
        action('remove-breakpoint', 'debug.breakpoint.remove', 'write'),
        action('evaluate', 'debug.inspect.evaluate', 'read'),
        action('refresh', 'debug.session.get', 'read'),
        action(
          'select-execution-block',
          'debug.ui.selectExecutionBlock',
          'read',
          Object.freeze({
            type: 'object',
            additionalProperties: false,
            required: ['sessionId', 'executionBlockId'],
            properties: {
              sessionId: { type: 'string', minLength: 1 },
              executionBlockId: { type: 'string', minLength: 1 },
            },
          }),
        ),
      ]),
      tools: Object.freeze([
        {
          id: 'session',
          name: 'debug.session.get',
          inputSchema: sessionActionSchema,
          outputSchema: debuggerUiOutputSchema('debug.session.get'),
        },
        {
          id: 'events',
          name: 'debug.session.events',
          inputSchema: sessionActionSchema,
          outputSchema: debuggerUiOutputSchema('debug.session.events'),
        },
        {
          id: 'adapters',
          name: 'debug.adapter.list',
          inputSchema: emptyObjectSchema,
          outputSchema: debuggerUiOutputSchema('debug.adapter.list'),
        },
      ]),
      localState: Object.freeze({ scope: 'session', schemaVersion: '1' }),
      authoritativeState: Object.freeze({
        capability: 'debug.session.get',
        resourceId: 'runtime://debugger/state',
        version: '1',
      }),
    }),
    tags: Object.freeze(['debugger', 'monaco', 'dap']),
    metadata: Object.freeze({
      moduleExport: './ui',
      rendererExport: 'mountDebuggerRuntimeUi',
      panelSurface: 'panel',
      tabSurface: 'tab',
      supportsMultipleSessions: true,
    }),
  });
}

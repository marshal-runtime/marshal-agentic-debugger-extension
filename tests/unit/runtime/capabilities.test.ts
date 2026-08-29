import { describe, expect, it } from 'vitest';

import {
  DEBUGGER_CAPABILITY_DESCRIPTORS,
  MARSHAL_TOOL_INVOCATION_PERMISSION_PREFIX,
} from '../../../src/runtime/capabilities.js';
import type { CapabilityDescriptor } from '../../../src/runtime/contracts.js';
import { createDebuggerUiApplication } from '../../../src/runtime/ui-application.js';

const MARSHAL_UI_MAX_BYTES = 64 * 1024;
const MARSHAL_UI_MAX_DEPTH = 12;
const EXECUTION_CONTROL_ACTIONS = [
  ['debug.execution.continue', 'continue'],
  ['debug.execution.stepOver', 'next'],
  ['debug.execution.stepInto', 'stepIn'],
  ['debug.execution.stepOut', 'stepOut'],
  ['debug.execution.pause', 'pause'],
] as const;

function descriptorFor(name: string): CapabilityDescriptor {
  const descriptor = DEBUGGER_CAPABILITY_DESCRIPTORS.find((entry) => entry.name === name);
  expect(descriptor, `Missing debugger capability descriptor: ${name}`).toBeDefined();
  return descriptor!;
}

function maximumJsonDepth(value: unknown, depth = 0): number {
  if (value === null || typeof value !== 'object') return depth;
  const children: readonly unknown[] = Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>);
  return children.reduce(
    (maximum, child) => Math.max(maximum, maximumJsonDepth(child, depth + 1)),
    depth,
  );
}

describe('debugger capability permissions', () => {
  it('uses one capability-scoped Marshal invocation permission per descriptor', () => {
    for (const descriptor of DEBUGGER_CAPABILITY_DESCRIPTORS) {
      expect(descriptor.permissions).toEqual([
        {
          permission: `${MARSHAL_TOOL_INVOCATION_PERMISSION_PREFIX}${descriptor.name}`,
          risk: expect.stringMatching(/^(low|medium|high|critical)$/),
        },
      ]);
    }
  });

  it.each([
    ['debug.adapter.list', 'low'],
    ['debug.session.list', 'low'],
    ['debug.session.launch', 'high'],
    ['debug.session.attach', 'critical'],
    ['debug.session.disconnect', 'high'],
    ['debug.session.terminate', 'critical'],
    ['debug.session.restart', 'high'],
    ['debug.breakpoint.list', 'medium'],
    ['debug.breakpoint.set', 'medium'],
    ['debug.execution.stepOver', 'high'],
    ['debug.inspect.evaluate', 'medium'],
    ['debug.watch.manage', 'medium'],
    ['debug.inspect.variables', 'low'],
    ['debug.ui.selectExecutionBlock', 'low'],
  ] as const)('keeps %s classified as %s risk', (name, risk) => {
    expect(descriptorFor(name).permissions).toEqual([
      {
        permission: `${MARSHAL_TOOL_INVOCATION_PERMISSION_PREFIX}${name}`,
        risk,
      },
    ]);
  });

  it('declares matching supported permissions for UI actions and tools', () => {
    const application = createDebuggerUiApplication().application;
    const actions = application.actions as readonly {
      readonly id: string;
      readonly target: { readonly kind: string; readonly capability: string };
      readonly requiredPermissions: readonly string[];
    }[];
    const tools = application.tools as readonly {
      readonly id: string;
      readonly name: string;
    }[];

    for (const action of actions) {
      expect(action.target.kind).toBe('capability');
      expect(action.requiredPermissions, action.id).toEqual([
        `${MARSHAL_TOOL_INVOCATION_PERMISSION_PREFIX}${action.target.capability}`,
      ]);
      expect(descriptorFor(action.target.capability).permissions?.[0]?.permission).toBe(
        action.requiredPermissions[0],
      );
    }

    for (const tool of tools) {
      expect(descriptorFor(tool.name).permissions?.[0]?.permission, tool.id).toBe(
        `${MARSHAL_TOOL_INVOCATION_PERMISSION_PREFIX}${tool.name}`,
      );
    }
  });
});

describe('debugger UI output schemas', () => {
  it('uses compact UI projections without changing strict capability descriptors', () => {
    const application = createDebuggerUiApplication().application;
    const outputs = [
      ...application.actions.map((entry) => ({
        capability: (entry['target'] as { readonly capability: string }).capability,
        schema: entry['outputSchema'],
      })),
      ...application.tools.map((entry) => ({
        capability: entry['name'] as string,
        schema: entry['outputSchema'],
      })),
    ];

    for (const output of outputs) {
      const descriptorSchema = descriptorFor(output.capability).outputSchema;
      expect(descriptorSchema['$defs'], output.capability).toBeDefined();
      expect(output.schema, output.capability).not.toBe(descriptorSchema);
      expect(output.schema, output.capability).toMatchObject({
        type: 'object',
        additionalProperties: false,
        required: ['value', 'scope', 'executionBlock'],
      });
      expect(output.schema).not.toHaveProperty('$defs');
    }
  });

  it('fits the complete host-shaped open payload within Marshal byte and depth limits', () => {
    const descriptor = createDebuggerUiApplication();
    const openPayload = {
      sessionId: 'marshal-session-1',
      workspaceName: 'workspace-1',
      extensionId: '@marshal/agentic-debugger-extension',
      applicationId: descriptor.id,
      surface: 'inline-card',
      content: {
        kind: 'application',
        descriptor,
      },
      idempotencyKey: 'debugger-ui-open-1',
    };

    expect(Buffer.byteLength(JSON.stringify(openPayload), 'utf8')).toBeLessThanOrEqual(
      MARSHAL_UI_MAX_BYTES,
    );
    expect(maximumJsonDepth(openPayload)).toBeLessThanOrEqual(MARSHAL_UI_MAX_DEPTH);
  });
});

describe('debugger capability output schemas', () => {
  it.each(EXECUTION_CONTROL_ACTIONS)(
    'accepts acceptance and native-host output forms for %s',
    (capability, nativeAction) => {
      expect(descriptorFor(capability).outputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
        properties: {
          value: {
            type: 'object',
            additionalProperties: false,
            properties: {
              threadId: { type: 'integer' },
              action: { enum: [capability, nativeAction] },
            },
            required: ['sessionId', 'action', 'snapshot'],
          },
        },
      });
    },
  );

  it('accepts normalized paths and strict DAP sources for call-stack frames', () => {
    expect(descriptorFor('debug.inspect.callStack').outputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        value: {
          type: 'object',
          additionalProperties: false,
          properties: {
            stackFrames: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  source: {
                    oneOf: [
                      { type: 'string' },
                      {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                          name: { type: 'string' },
                          path: { type: 'string' },
                          sourceReference: { type: 'integer' },
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
    });
  });
});

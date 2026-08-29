import type { DebugProtocol } from '@vscode/debugprotocol';

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  setBreakpointSchema,
  removeBreakpointSchema,
  setFunctionBreakpointSchema,
  setExceptionBreakpointsSchema,
  setDataBreakpointSchema,
  listBreakpointsSchema,
} from '../schemas.js';
import { sessionManager, clientRegistry } from './session-tools.js';
import type { McpToolDefinition } from './session-tools.js';

/** Schema for the enable/disable breakpoint tool input. */
const toggleBreakpointSchema = z.object({
  sessionId: z.string().describe('Session identifier'),
  file: z.string().describe('Source file path'),
  line: z.number().int().positive().describe('Line number'),
});

/** Tracked breakpoint for a session. */
interface TrackedBreakpoint {
  readonly file: string;
  readonly line: number;
  readonly condition?: string;
  readonly hitCondition?: string;
  readonly logMessage?: string;
  readonly verified: boolean;
  readonly enabled: boolean;
}

/** Tracked function breakpoint for a session. */
interface TrackedFunctionBreakpoint {
  readonly name: string;
  readonly condition?: string;
  readonly hitCondition?: string;
  readonly verified: boolean;
  readonly enabled: boolean;
}

/** Per-session breakpoint state. */
interface SessionBreakpointState {
  /** Line breakpoints grouped by file path. */
  lineBreakpoints: Map<string, TrackedBreakpoint[]>;
  /** Function breakpoints. */
  functionBreakpoints: TrackedFunctionBreakpoint[];
  /** Active exception filters. */
  exceptionFilters: string[];
}

/** Registry of breakpoint state per session. */
const breakpointState = new Map<string, SessionBreakpointState>();

function getOrCreateState(sessionId: string): SessionBreakpointState {
  let state = breakpointState.get(sessionId);
  if (!state) {
    state = {
      lineBreakpoints: new Map(),
      functionBreakpoints: [],
      exceptionFilters: [],
    };
    breakpointState.set(sessionId, state);
  }
  return state;
}

function textResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

async function handleSetBreakpoint(params: unknown): Promise<CallToolResult> {
  try {
    const input = setBreakpointSchema.parse(params);

    sessionManager.getSession(input.sessionId);
    const client = clientRegistry.get(input.sessionId);
    if (!client) {
      return errorResult(`No DAP client found for session: ${input.sessionId}`);
    }

    const state = getOrCreateState(input.sessionId);
    const fileBreakpoints = state.lineBreakpoints.get(input.file) ?? [];

    const newBp: TrackedBreakpoint = {
      file: input.file,
      line: input.line,
      condition: input.condition,
      hitCondition: input.hitCondition,
      logMessage: input.logMessage,
      verified: false,
      enabled: true,
    };

    const existing = fileBreakpoints.filter((bp) => bp.line !== input.line);
    const updatedBreakpoints = [...existing, newBp];

    const enabledBreakpoints = updatedBreakpoints.filter((bp) => bp.enabled);
    const sourceBreakpoints: DebugProtocol.SourceBreakpoint[] = enabledBreakpoints.map((bp) => ({
      line: bp.line,
      condition: bp.condition,
      hitCondition: bp.hitCondition,
      logMessage: bp.logMessage,
    }));

    const response = await client.setBreakpoints({
      source: { path: input.file },
      breakpoints: sourceBreakpoints,
    });

    const body = response.body as { breakpoints?: DebugProtocol.Breakpoint[] } | undefined;
    const resultBreakpoints = body?.breakpoints ?? [];

    const verifiedBreakpoints = updatedBreakpoints.map((bp, i) => ({
      ...bp,
      verified: resultBreakpoints[i]?.verified ?? false,
      line: resultBreakpoints[i]?.line ?? bp.line,
    }));

    state.lineBreakpoints.set(input.file, verifiedBreakpoints);

    const addedBp = verifiedBreakpoints.find((bp) => bp.line === (resultBreakpoints.find((rb) => rb.line === input.line || rb.line === newBp.line)?.line ?? input.line));

    return textResult({
      sessionId: input.sessionId,
      file: input.file,
      line: addedBp?.line ?? input.line,
      verified: addedBp?.verified ?? false,
      condition: input.condition,
      hitCondition: input.hitCondition,
      logMessage: input.logMessage,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Failed to set breakpoint: ${message}`);
  }
}

async function handleRemoveBreakpoint(params: unknown): Promise<CallToolResult> {
  try {
    const input = removeBreakpointSchema.parse(params);

    sessionManager.getSession(input.sessionId);
    const client = clientRegistry.get(input.sessionId);
    if (!client) {
      return errorResult(`No DAP client found for session: ${input.sessionId}`);
    }

    const state = getOrCreateState(input.sessionId);
    const fileBreakpoints = state.lineBreakpoints.get(input.file) ?? [];
    const remaining = fileBreakpoints.filter((bp) => bp.line !== input.line);

    const sourceBreakpoints: DebugProtocol.SourceBreakpoint[] = remaining.map((bp) => ({
      line: bp.line,
      condition: bp.condition,
      hitCondition: bp.hitCondition,
      logMessage: bp.logMessage,
    }));

    await client.setBreakpoints({
      source: { path: input.file },
      breakpoints: sourceBreakpoints,
    });

    if (remaining.length === 0) {
      state.lineBreakpoints.delete(input.file);
    } else {
      state.lineBreakpoints.set(input.file, remaining);
    }

    return textResult({
      sessionId: input.sessionId,
      file: input.file,
      line: input.line,
      removed: true,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Failed to remove breakpoint: ${message}`);
  }
}

async function handleSetFunctionBreakpoint(params: unknown): Promise<CallToolResult> {
  try {
    const input = setFunctionBreakpointSchema.parse(params);

    sessionManager.getSession(input.sessionId);
    const client = clientRegistry.get(input.sessionId);
    if (!client) {
      return errorResult(`No DAP client found for session: ${input.sessionId}`);
    }

    const state = getOrCreateState(input.sessionId);

    const existing = state.functionBreakpoints.filter((bp) => bp.name !== input.name);
    const newFnBp: TrackedFunctionBreakpoint = {
      name: input.name,
      condition: input.condition,
      hitCondition: input.hitCondition,
      verified: false,
      enabled: true,
    };

    const allFnBps = [...existing, newFnBp];

    const dapBreakpoints: DebugProtocol.FunctionBreakpoint[] = allFnBps.map((bp) => ({
      name: bp.name,
      condition: bp.condition,
      hitCondition: bp.hitCondition,
    }));

    const response = await client.setFunctionBreakpoints({ breakpoints: dapBreakpoints });

    const body = response.body as { breakpoints?: DebugProtocol.Breakpoint[] } | undefined;
    const resultBreakpoints = body?.breakpoints ?? [];

    state.functionBreakpoints = allFnBps.map((bp, i) => ({
      ...bp,
      verified: resultBreakpoints[i]?.verified ?? false,
    }));

    const addedIndex = allFnBps.length - 1;
    return textResult({
      sessionId: input.sessionId,
      name: input.name,
      verified: resultBreakpoints[addedIndex]?.verified ?? false,
      condition: input.condition,
      hitCondition: input.hitCondition,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Failed to set function breakpoint: ${message}`);
  }
}

async function handleSetExceptionBreakpoints(params: unknown): Promise<CallToolResult> {
  try {
    const input = setExceptionBreakpointsSchema.parse(params);

    sessionManager.getSession(input.sessionId);
    const client = clientRegistry.get(input.sessionId);
    if (!client) {
      return errorResult(`No DAP client found for session: ${input.sessionId}`);
    }

    const state = getOrCreateState(input.sessionId);

    await client.setExceptionBreakpoints({ filters: input.filters });

    state.exceptionFilters = [...input.filters];

    return textResult({
      sessionId: input.sessionId,
      filters: input.filters,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Failed to set exception breakpoints: ${message}`);
  }
}

async function handleSetDataBreakpoint(params: unknown): Promise<CallToolResult> {
  try {
    const input = setDataBreakpointSchema.parse(params);

    const session = sessionManager.getSession(input.sessionId);
    const client = clientRegistry.get(input.sessionId);
    if (!client) {
      return errorResult(`No DAP client found for session: ${input.sessionId}`);
    }

    const capabilities = session.capabilities;
    if (!capabilities?.supportsDataBreakpoints) {
      return errorResult('Data breakpoints are not supported by this debug adapter');
    }

    const response = await client.sendRequest('setDataBreakpoints', {
      breakpoints: [
        {
          dataId: input.dataId,
          accessType: input.accessType,
        },
      ],
    });

    const body = response.body as { breakpoints?: DebugProtocol.Breakpoint[] } | undefined;
    const resultBreakpoints = body?.breakpoints ?? [];
    const bp = resultBreakpoints[0];

    return textResult({
      sessionId: input.sessionId,
      dataId: input.dataId,
      accessType: input.accessType,
      verified: bp?.verified ?? false,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Failed to set data breakpoint: ${message}`);
  }
}

async function handleListBreakpoints(params: unknown): Promise<CallToolResult> {
  try {
    const input = listBreakpointsSchema.parse(params);

    sessionManager.getSession(input.sessionId);

    const state = breakpointState.get(input.sessionId);

    const lineBreakpoints: Array<{ file: string; line: number; condition?: string; hitCondition?: string; logMessage?: string; verified: boolean }> = [];
    if (state) {
      for (const [file, bps] of state.lineBreakpoints) {
        for (const bp of bps) {
          lineBreakpoints.push({
            file,
            line: bp.line,
            condition: bp.condition,
            hitCondition: bp.hitCondition,
            logMessage: bp.logMessage,
            verified: bp.verified,
          });
        }
      }
    }

    return textResult({
      sessionId: input.sessionId,
      lineBreakpoints,
      functionBreakpoints: state?.functionBreakpoints ?? [],
      exceptionFilters: state?.exceptionFilters ?? [],
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Failed to list breakpoints: ${message}`);
  }
}

async function handleToggleBreakpoint(
  params: unknown,
  enabled: boolean,
): Promise<CallToolResult> {
  try {
    const input = toggleBreakpointSchema.parse(params);

    sessionManager.getSession(input.sessionId);
    const client = clientRegistry.get(input.sessionId);
    if (!client) {
      return errorResult(`No DAP client found for session: ${input.sessionId}`);
    }

    const state = getOrCreateState(input.sessionId);
    const fileBreakpoints = state.lineBreakpoints.get(input.file) ?? [];
    const targetIndex = fileBreakpoints.findIndex((bp) => bp.line === input.line);

    if (targetIndex === -1) {
      return errorResult(`No breakpoint found at ${input.file}:${input.line}`);
    }

    const updatedBreakpoints = fileBreakpoints.map((bp, i) =>
      i === targetIndex ? { ...bp, enabled } : bp,
    );
    state.lineBreakpoints.set(input.file, updatedBreakpoints);

    const enabledBps = updatedBreakpoints.filter((bp) => bp.enabled);
    const sourceBreakpoints: DebugProtocol.SourceBreakpoint[] = enabledBps.map((bp) => ({
      line: bp.line,
      condition: bp.condition,
      hitCondition: bp.hitCondition,
      logMessage: bp.logMessage,
    }));

    await client.setBreakpoints({
      source: { path: input.file },
      breakpoints: sourceBreakpoints,
    });

    return textResult({
      sessionId: input.sessionId,
      file: input.file,
      line: input.line,
      enabled,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const action = enabled ? 'enable' : 'disable';
    return errorResult(`Failed to ${action} breakpoint: ${message}`);
  }
}

async function handleEnableBreakpoint(params: unknown): Promise<CallToolResult> {
  return handleToggleBreakpoint(params, true);
}

async function handleDisableBreakpoint(params: unknown): Promise<CallToolResult> {
  return handleToggleBreakpoint(params, false);
}

/** All breakpoint tool definitions. */
export const BREAKPOINT_TOOLS: readonly McpToolDefinition[] = [
  {
    name: 'set_breakpoint',
    description: 'Set a line breakpoint with optional condition, hit count, or log message.',
    inputSchema: setBreakpointSchema,
    handler: handleSetBreakpoint,
  },
  {
    name: 'remove_breakpoint',
    description: 'Remove a breakpoint at a specific file and line.',
    inputSchema: removeBreakpointSchema,
    handler: handleRemoveBreakpoint,
  },
  {
    name: 'set_function_breakpoint',
    description: 'Set a breakpoint that triggers when a named function is called.',
    inputSchema: setFunctionBreakpointSchema,
    handler: handleSetFunctionBreakpoint,
  },
  {
    name: 'set_exception_breakpoints',
    description: 'Configure which exceptions cause the debugger to break.',
    inputSchema: setExceptionBreakpointsSchema,
    handler: handleSetExceptionBreakpoints,
  },
  {
    name: 'set_data_breakpoint',
    description: 'Set a data breakpoint (watchpoint) that triggers on memory access.',
    inputSchema: setDataBreakpointSchema,
    handler: handleSetDataBreakpoint,
  },
  {
    name: 'list_breakpoints',
    description: 'List all active breakpoints for a debug session.',
    inputSchema: listBreakpointsSchema,
    handler: handleListBreakpoints,
  },
  {
    name: 'enable_breakpoint',
    description: 'Enable a previously disabled breakpoint without removing it.',
    inputSchema: toggleBreakpointSchema,
    handler: handleEnableBreakpoint,
  },
  {
    name: 'disable_breakpoint',
    description: 'Disable a breakpoint without removing it. The breakpoint can be re-enabled later.',
    inputSchema: toggleBreakpointSchema,
    handler: handleDisableBreakpoint,
  },
];

/**
 * Register breakpoint management tools on the MCP server.
 *
 * Tools registered:
 * - `set_breakpoint` — Set a breakpoint at a file/line
 * - `remove_breakpoint` — Remove a breakpoint
 * - `set_function_breakpoint` — Set a function breakpoint
 * - `set_exception_breakpoints` — Configure exception breakpoints
 * - `set_data_breakpoint` — Set a data breakpoint (watchpoint)
 * - `list_breakpoints` — List all breakpoints in a session
 * - `enable_breakpoint` — Enable a disabled breakpoint
 * - `disable_breakpoint` — Disable a breakpoint without removing it
 *
 * @param server - The MCP server instance to register tools on.
 */
export function registerBreakpointTools(server: Server): void {
  const toolMap = new Map<string, McpToolDefinition>();
  for (const tool of BREAKPOINT_TOOLS) {
    toolMap.set(tool.name, tool);
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: BREAKPOINT_TOOLS.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: zodToJsonSchema(t.inputSchema) as Record<string, unknown>,
      })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = toolMap.get(name);
    if (!tool) {
      return errorResult(`Unknown tool: ${name}`);
    }
    return tool.handler(args);
  });
}

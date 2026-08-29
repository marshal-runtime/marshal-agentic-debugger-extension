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
  continueSchema,
  stepSchema,
  pauseSchema,
  setNextStatementSchema,
} from '../schemas.js';
import { sessionManager, clientRegistry } from './session-tools.js';
import type { McpToolDefinition } from './session-tools.js';

/** Schema for the restart_frame tool input. */
const restartFrameSchema = z.object({
  sessionId: z.string().describe('Session identifier'),
  frameId: z.number().int().describe('Stack frame ID to restart'),
});

/** Schema for the reverse_continue tool input. */
const reverseContinueSchema = z.object({
  sessionId: z.string().describe('Session identifier'),
  threadId: z.number().optional().describe('Thread to reverse-continue'),
});

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

/** Default thread ID used when caller does not specify one. */
const DEFAULT_THREAD_ID = 1;

async function handleContinueExecution(params: unknown): Promise<CallToolResult> {
  try {
    const input = continueSchema.parse(params);

    sessionManager.getSession(input.sessionId);
    const client = clientRegistry.get(input.sessionId);
    if (!client) {
      return errorResult(`No DAP client found for session: ${input.sessionId}`);
    }

    const threadId = input.threadId ?? DEFAULT_THREAD_ID;
    const response = await client.continue({ threadId });
    const body = response.body as DebugProtocol.ContinueResponse['body'] | undefined;

    return textResult({
      sessionId: input.sessionId,
      threadId,
      allThreadsContinued: body?.allThreadsContinued ?? true,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Failed to continue execution: ${message}`);
  }
}

async function handleStepOver(params: unknown): Promise<CallToolResult> {
  try {
    const input = stepSchema.parse(params);

    sessionManager.getSession(input.sessionId);
    const client = clientRegistry.get(input.sessionId);
    if (!client) {
      return errorResult(`No DAP client found for session: ${input.sessionId}`);
    }

    const threadId = input.threadId ?? DEFAULT_THREAD_ID;
    await client.next({ threadId });

    return textResult({
      sessionId: input.sessionId,
      threadId,
      action: 'step_over',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Failed to step over: ${message}`);
  }
}

async function handleStepInto(params: unknown): Promise<CallToolResult> {
  try {
    const input = stepSchema.parse(params);

    sessionManager.getSession(input.sessionId);
    const client = clientRegistry.get(input.sessionId);
    if (!client) {
      return errorResult(`No DAP client found for session: ${input.sessionId}`);
    }

    const threadId = input.threadId ?? DEFAULT_THREAD_ID;
    await client.stepIn({ threadId });

    return textResult({
      sessionId: input.sessionId,
      threadId,
      action: 'step_into',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Failed to step into: ${message}`);
  }
}

async function handleStepOut(params: unknown): Promise<CallToolResult> {
  try {
    const input = stepSchema.parse(params);

    sessionManager.getSession(input.sessionId);
    const client = clientRegistry.get(input.sessionId);
    if (!client) {
      return errorResult(`No DAP client found for session: ${input.sessionId}`);
    }

    const threadId = input.threadId ?? DEFAULT_THREAD_ID;
    await client.stepOut({ threadId });

    return textResult({
      sessionId: input.sessionId,
      threadId,
      action: 'step_out',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Failed to step out: ${message}`);
  }
}

async function handlePauseExecution(params: unknown): Promise<CallToolResult> {
  try {
    const input = pauseSchema.parse(params);

    sessionManager.getSession(input.sessionId);
    const client = clientRegistry.get(input.sessionId);
    if (!client) {
      return errorResult(`No DAP client found for session: ${input.sessionId}`);
    }

    const threadId = input.threadId ?? DEFAULT_THREAD_ID;
    await client.pause({ threadId });

    return textResult({
      sessionId: input.sessionId,
      threadId,
      paused: true,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Failed to pause execution: ${message}`);
  }
}

async function handleSetNextStatement(params: unknown): Promise<CallToolResult> {
  try {
    const input = setNextStatementSchema.parse(params);

    const session = sessionManager.getSession(input.sessionId);
    const client = clientRegistry.get(input.sessionId);
    if (!client) {
      return errorResult(`No DAP client found for session: ${input.sessionId}`);
    }

    const capabilities = session.capabilities;
    if (!capabilities?.supportsGotoTargetsRequest) {
      return errorResult('Set next statement is not supported by this debug adapter');
    }

    const threadId = input.threadId ?? DEFAULT_THREAD_ID;

    const targetsResponse = await client.gotoTargets({
      source: { path: input.file },
      line: input.line,
    });

    const targetsBody = targetsResponse.body as { targets?: DebugProtocol.GotoTarget[] } | undefined;
    const targets = targetsBody?.targets ?? [];
    const firstTarget = targets[0];

    if (!firstTarget) {
      return errorResult(`No goto targets available at ${input.file}:${input.line}`);
    }

    await client.goto({ threadId, targetId: firstTarget.id });

    return textResult({
      sessionId: input.sessionId,
      file: input.file,
      line: firstTarget.line,
      threadId,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Failed to set next statement: ${message}`);
  }
}

async function handleRestartFrame(params: unknown): Promise<CallToolResult> {
  try {
    const input = restartFrameSchema.parse(params);

    const session = sessionManager.getSession(input.sessionId);
    const client = clientRegistry.get(input.sessionId);
    if (!client) {
      return errorResult(`No DAP client found for session: ${input.sessionId}`);
    }

    const capabilities = session.capabilities;
    if (!capabilities?.supportsRestartFrame) {
      return errorResult('Restart frame is not supported by this debug adapter');
    }

    await client.sendRequest('restartFrame', { frameId: input.frameId });

    return textResult({
      sessionId: input.sessionId,
      frameId: input.frameId,
      action: 'restart_frame',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Failed to restart frame: ${message}`);
  }
}

async function handleReverseContinue(params: unknown): Promise<CallToolResult> {
  try {
    const input = reverseContinueSchema.parse(params);

    const session = sessionManager.getSession(input.sessionId);
    const client = clientRegistry.get(input.sessionId);
    if (!client) {
      return errorResult(`No DAP client found for session: ${input.sessionId}`);
    }

    const capabilities = session.capabilities;
    if (!capabilities?.supportsStepBack) {
      return errorResult('Reverse continue is not supported by this debug adapter');
    }

    const threadId = input.threadId ?? DEFAULT_THREAD_ID;
    await client.sendRequest('reverseContinue', { threadId });

    return textResult({
      sessionId: input.sessionId,
      threadId,
      action: 'reverse_continue',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Failed to reverse continue: ${message}`);
  }
}

/** All execution control tool definitions. */
export const EXECUTION_TOOLS: readonly McpToolDefinition[] = [
  {
    name: 'continue_execution',
    description: 'Continue execution of a paused debug session.',
    inputSchema: continueSchema,
    handler: handleContinueExecution,
  },
  {
    name: 'step_over',
    description: 'Step over the current statement (execute without entering functions).',
    inputSchema: stepSchema,
    handler: handleStepOver,
  },
  {
    name: 'step_into',
    description: 'Step into a function call at the current statement.',
    inputSchema: stepSchema,
    handler: handleStepInto,
  },
  {
    name: 'step_out',
    description: 'Step out of the current function back to the caller.',
    inputSchema: stepSchema,
    handler: handleStepOut,
  },
  {
    name: 'pause_execution',
    description: 'Pause execution of a running debug session.',
    inputSchema: pauseSchema,
    handler: handlePauseExecution,
  },
  {
    name: 'set_next_statement',
    description: 'Move the execution point to a specific location. Requires adapter support for goto targets.',
    inputSchema: setNextStatementSchema,
    handler: handleSetNextStatement,
  },
  {
    name: 'restart_frame',
    description: 'Restart execution from a specific stack frame. Requires adapter support for restart frame.',
    inputSchema: restartFrameSchema,
    handler: handleRestartFrame,
  },
  {
    name: 'reverse_continue',
    description: 'Continue execution in reverse (back to previous breakpoint). Requires adapter support for step back.',
    inputSchema: reverseContinueSchema,
    handler: handleReverseContinue,
  },
];

/**
 * Register execution control tools on the MCP server.
 *
 * Tools registered:
 * - `continue_execution` — Continue execution
 * - `step_over` — Step over the current statement
 * - `step_into` — Step into a function call
 * - `step_out` — Step out of the current function
 * - `pause_execution` — Pause execution
 * - `set_next_statement` — Move execution point to a specific location
 * - `restart_frame` — Restart from a specific stack frame
 * - `reverse_continue` — Continue execution in reverse
 *
 * @param server - The MCP server instance to register tools on.
 */
export function registerExecutionTools(server: Server): void {
  const toolMap = new Map<string, McpToolDefinition>();
  for (const tool of EXECUTION_TOOLS) {
    toolMap.set(tool.name, tool);
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: EXECUTION_TOOLS.map((t) => ({
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

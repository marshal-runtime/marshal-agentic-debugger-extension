import type { DebugProtocol } from '@vscode/debugprotocol';

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { isSafeExpression } from '../../security/eval-safety.js';
import { redactValue } from '../../security/redaction.js';
import {
  evaluateSchema,
  getVariablesSchema,
  getCallStackSchema,
  getThreadsSchema,
  getScopesSchema,
  manageWatchSchema,
} from '../schemas.js';
import { sessionManager, clientRegistry } from './session-tools.js';
import type { McpToolDefinition } from './session-tools.js';

/** Schema for the get_loaded_sources tool input. */
const getLoadedSourcesSchema = z.object({
  sessionId: z.string().describe('Session identifier'),
});

/** Schema for the get_modules tool input. */
const getModulesSchema = z.object({
  sessionId: z.string().describe('Session identifier'),
  startModule: z.number().int().nonnegative().optional().describe('Start index for pagination'),
  moduleCount: z.number().int().positive().optional().describe('Number of modules to return'),
});

/** Schema for the get_exception_info tool input. */
const getExceptionInfoSchema = z.object({
  sessionId: z.string().describe('Session identifier'),
  threadId: z.number().int().describe('Thread stopped on exception'),
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

/** Per-session watch expression list. */
const watchExpressions = new Map<string, string[]>();

function getWatchList(sessionId: string): string[] {
  let list = watchExpressions.get(sessionId);
  if (!list) {
    list = [];
    watchExpressions.set(sessionId, list);
  }
  return list;
}

/** Redacted variable shape returned from get_variables. */
interface RedactedVariable {
  readonly name: string;
  readonly value: string;
  readonly type?: string;
  readonly variablesReference: number;
  readonly redacted: boolean;
}

async function handleEvaluateExpression(params: unknown): Promise<CallToolResult> {
  try {
    const input = evaluateSchema.parse(params);

    sessionManager.getSession(input.sessionId);
    const client = clientRegistry.get(input.sessionId);
    if (!client) {
      return errorResult(`No DAP client found for session: ${input.sessionId}`);
    }

    const safetyResult = isSafeExpression(input.expression, {
      interfaceContext: 'mcp',
    });
    if (!safetyResult.safe) {
      return errorResult(`Expression rejected by eval safety: ${safetyResult.warning ?? 'unsafe expression'}`);
    }

    const response = await client.evaluate({
      expression: input.expression,
      frameId: input.frameId,
      context: input.context ?? 'repl',
    });

    const body = response.body as DebugProtocol.EvaluateResponse['body'] | undefined;

    return textResult({
      sessionId: input.sessionId,
      result: body?.result ?? '',
      type: body?.type,
      variablesReference: body?.variablesReference ?? 0,
      warning: safetyResult.warning,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Failed to evaluate expression: ${message}`);
  }
}

async function handleGetVariables(params: unknown): Promise<CallToolResult> {
  try {
    const input = getVariablesSchema.parse(params);

    sessionManager.getSession(input.sessionId);
    const client = clientRegistry.get(input.sessionId);
    if (!client) {
      return errorResult(`No DAP client found for session: ${input.sessionId}`);
    }

    const args: DebugProtocol.VariablesArguments = {
      variablesReference: input.variablesReference,
    };

    if (input.maxProperties !== undefined) {
      args.count = input.maxProperties;
    }

    const response = await client.variables(args);

    const body = response.body as { variables?: DebugProtocol.Variable[] } | undefined;
    const variables = body?.variables ?? [];

    const redactedVariables: RedactedVariable[] = variables.map((v) => {
      const redaction = redactValue(v.name, v.value);
      return {
        name: v.name,
        value: redaction.value,
        type: v.type,
        variablesReference: v.variablesReference,
        redacted: redaction.redacted,
      };
    });

    return textResult({
      sessionId: input.sessionId,
      variablesReference: input.variablesReference,
      variables: redactedVariables,
      count: redactedVariables.length,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Failed to get variables: ${message}`);
  }
}

async function handleGetCallStack(params: unknown): Promise<CallToolResult> {
  try {
    const input = getCallStackSchema.parse(params);

    sessionManager.getSession(input.sessionId);
    const client = clientRegistry.get(input.sessionId);
    if (!client) {
      return errorResult(`No DAP client found for session: ${input.sessionId}`);
    }

    const args: DebugProtocol.StackTraceArguments = {
      threadId: input.threadId,
    };

    if (input.startFrame !== undefined) {
      args.startFrame = input.startFrame;
    }
    if (input.levels !== undefined) {
      args.levels = input.levels;
    }

    const response = await client.stackTrace(args);

    const body = response.body as {
      stackFrames?: DebugProtocol.StackFrame[];
      totalFrames?: number;
    } | undefined;

    const stackFrames = body?.stackFrames ?? [];

    return textResult({
      sessionId: input.sessionId,
      threadId: input.threadId,
      stackFrames: stackFrames.map((frame) => ({
        id: frame.id,
        name: frame.name,
        source: frame.source?.path ?? frame.source?.name,
        line: frame.line,
        column: frame.column,
      })),
      totalFrames: body?.totalFrames ?? stackFrames.length,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Failed to get call stack: ${message}`);
  }
}

async function handleGetThreads(params: unknown): Promise<CallToolResult> {
  try {
    const input = getThreadsSchema.parse(params);

    sessionManager.getSession(input.sessionId);
    const client = clientRegistry.get(input.sessionId);
    if (!client) {
      return errorResult(`No DAP client found for session: ${input.sessionId}`);
    }

    const response = await client.threads();

    const body = response.body as { threads?: DebugProtocol.Thread[] } | undefined;
    const threads = body?.threads ?? [];

    return textResult({
      sessionId: input.sessionId,
      threads: threads.map((t) => ({
        id: t.id,
        name: t.name,
      })),
      count: threads.length,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Failed to get threads: ${message}`);
  }
}

async function handleGetScopes(params: unknown): Promise<CallToolResult> {
  try {
    const input = getScopesSchema.parse(params);

    sessionManager.getSession(input.sessionId);
    const client = clientRegistry.get(input.sessionId);
    if (!client) {
      return errorResult(`No DAP client found for session: ${input.sessionId}`);
    }

    const response = await client.scopes({ frameId: input.frameId });

    const body = response.body as { scopes?: DebugProtocol.Scope[] } | undefined;
    const scopes = body?.scopes ?? [];

    return textResult({
      sessionId: input.sessionId,
      frameId: input.frameId,
      scopes: scopes.map((s) => ({
        name: s.name,
        variablesReference: s.variablesReference,
        expensive: s.expensive,
        namedVariables: s.namedVariables,
        indexedVariables: s.indexedVariables,
      })),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Failed to get scopes: ${message}`);
  }
}

async function handleManageWatch(params: unknown): Promise<CallToolResult> {
  try {
    const input = manageWatchSchema.parse(params);

    sessionManager.getSession(input.sessionId);
    const client = clientRegistry.get(input.sessionId);
    if (!client) {
      return errorResult(`No DAP client found for session: ${input.sessionId}`);
    }

    const watchList = getWatchList(input.sessionId);

    switch (input.action) {
      case 'add': {
        if (!input.expression) {
          return errorResult('Expression is required for add action');
        }
        if (!watchList.includes(input.expression)) {
          watchList.push(input.expression);
        }
        return textResult({
          sessionId: input.sessionId,
          action: 'add',
          expression: input.expression,
          watchCount: watchList.length,
        });
      }

      case 'remove': {
        if (!input.expression) {
          return errorResult('Expression is required for remove action');
        }
        const index = watchList.indexOf(input.expression);
        if (index === -1) {
          return errorResult(`Watch expression not found: ${input.expression}`);
        }
        watchList.splice(index, 1);
        return textResult({
          sessionId: input.sessionId,
          action: 'remove',
          expression: input.expression,
          watchCount: watchList.length,
        });
      }

      case 'list': {
        return textResult({
          sessionId: input.sessionId,
          action: 'list',
          expressions: watchList,
          watchCount: watchList.length,
        });
      }

      case 'evaluate': {
        const results: Array<{
          expression: string;
          result?: string;
          type?: string;
          error?: string;
        }> = [];

        for (const expr of watchList) {
          const safetyResult = isSafeExpression(expr, {
            interfaceContext: 'mcp',
          });

          if (!safetyResult.safe) {
            results.push({
              expression: expr,
              error: `Eval safety rejected: ${safetyResult.warning ?? 'unsafe'}`,
            });
            continue;
          }

          try {
            const evalResponse = await client.evaluate({
              expression: expr,
              frameId: input.frameId,
              context: 'watch',
            });

            const evalBody = evalResponse.body as DebugProtocol.EvaluateResponse['body'] | undefined;
            results.push({
              expression: expr,
              result: evalBody?.result ?? '',
              type: evalBody?.type,
            });
          } catch (evalError: unknown) {
            const evalMessage = evalError instanceof Error ? evalError.message : String(evalError);
            results.push({
              expression: expr,
              error: evalMessage,
            });
          }
        }

        return textResult({
          sessionId: input.sessionId,
          action: 'evaluate',
          results,
        });
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Failed to manage watch: ${message}`);
  }
}

async function handleGetLoadedSources(params: unknown): Promise<CallToolResult> {
  try {
    const input = getLoadedSourcesSchema.parse(params);

    const session = sessionManager.getSession(input.sessionId);
    const client = clientRegistry.get(input.sessionId);
    if (!client) {
      return errorResult(`No DAP client found for session: ${input.sessionId}`);
    }

    const capabilities = session.capabilities;
    if (!capabilities?.supportsLoadedSourcesRequest) {
      return errorResult('Loaded sources request is not supported by this debug adapter');
    }

    const response = await client.sendRequest('loadedSources');
    const body = response.body as { sources?: DebugProtocol.Source[] } | undefined;
    const sources = body?.sources ?? [];

    return textResult({
      sessionId: input.sessionId,
      sources: sources.map((s) => ({
        name: s.name,
        path: s.path,
        sourceReference: s.sourceReference,
      })),
      count: sources.length,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Failed to get loaded sources: ${message}`);
  }
}

async function handleGetModules(params: unknown): Promise<CallToolResult> {
  try {
    const input = getModulesSchema.parse(params);

    const session = sessionManager.getSession(input.sessionId);
    const client = clientRegistry.get(input.sessionId);
    if (!client) {
      return errorResult(`No DAP client found for session: ${input.sessionId}`);
    }

    const capabilities = session.capabilities;
    if (!capabilities?.supportsModulesRequest) {
      return errorResult('Modules request is not supported by this debug adapter');
    }

    const args: { startModule?: number; moduleCount?: number } = {};
    if (input.startModule !== undefined) {
      args.startModule = input.startModule;
    }
    if (input.moduleCount !== undefined) {
      args.moduleCount = input.moduleCount;
    }

    const response = await client.sendRequest('modules', args);
    const body = response.body as {
      modules?: DebugProtocol.Module[];
      totalModules?: number;
    } | undefined;
    const modules = body?.modules ?? [];

    return textResult({
      sessionId: input.sessionId,
      modules: modules.map((m) => ({
        id: m.id,
        name: m.name,
        path: m.path,
        version: m.version,
        symbolStatus: m.symbolStatus,
      })),
      totalModules: body?.totalModules ?? modules.length,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Failed to get modules: ${message}`);
  }
}

async function handleGetExceptionInfo(params: unknown): Promise<CallToolResult> {
  try {
    const input = getExceptionInfoSchema.parse(params);

    const session = sessionManager.getSession(input.sessionId);
    const client = clientRegistry.get(input.sessionId);
    if (!client) {
      return errorResult(`No DAP client found for session: ${input.sessionId}`);
    }

    const capabilities = session.capabilities;
    if (!capabilities?.supportsExceptionInfoRequest) {
      return errorResult('Exception info request is not supported by this debug adapter');
    }

    const response = await client.sendRequest('exceptionInfo', {
      threadId: input.threadId,
    });

    const body = response.body as {
      exceptionId?: string;
      description?: string;
      breakMode?: DebugProtocol.ExceptionBreakMode;
      details?: DebugProtocol.ExceptionDetails;
    } | undefined;

    return textResult({
      sessionId: input.sessionId,
      threadId: input.threadId,
      exceptionId: body?.exceptionId ?? '',
      description: body?.description,
      breakMode: body?.breakMode,
      details: body?.details
        ? {
            message: body.details.message,
            typeName: body.details.typeName,
            stackTrace: body.details.stackTrace,
          }
        : undefined,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Failed to get exception info: ${message}`);
  }
}

/** All inspection tool definitions. */
export const INSPECTION_TOOLS: readonly McpToolDefinition[] = [
  {
    name: 'evaluate_expression',
    description: 'Evaluate an expression in the debug context. Applies eval safety checks (safe mode by default for MCP).',
    inputSchema: evaluateSchema,
    handler: handleEvaluateExpression,
  },
  {
    name: 'get_variables',
    description: 'Get variables for a given variables reference. Applies value redaction for sensitive data.',
    inputSchema: getVariablesSchema,
    handler: handleGetVariables,
  },
  {
    name: 'get_call_stack',
    description: 'Get the call stack for a thread. Supports pagination with startFrame/levels.',
    inputSchema: getCallStackSchema,
    handler: handleGetCallStack,
  },
  {
    name: 'get_threads',
    description: 'List all threads in the debuggee process.',
    inputSchema: getThreadsSchema,
    handler: handleGetThreads,
  },
  {
    name: 'get_scopes',
    description: 'Get variable scopes for a stack frame.',
    inputSchema: getScopesSchema,
    handler: handleGetScopes,
  },
  {
    name: 'manage_watch',
    description: 'Add, remove, list, or evaluate watch expressions for a debug session.',
    inputSchema: manageWatchSchema,
    handler: handleManageWatch,
  },
  {
    name: 'get_loaded_sources',
    description: 'Get all loaded source files in the debug session. Requires adapter support.',
    inputSchema: getLoadedSourcesSchema,
    handler: handleGetLoadedSources,
  },
  {
    name: 'get_modules',
    description: 'Get loaded modules in the debug session. Supports pagination. Requires adapter support.',
    inputSchema: getModulesSchema,
    handler: handleGetModules,
  },
  {
    name: 'get_exception_info',
    description: 'Get exception details when stopped on an exception. Requires adapter support.',
    inputSchema: getExceptionInfoSchema,
    handler: handleGetExceptionInfo,
  },
];

/**
 * Register state inspection tools on the MCP server.
 *
 * Tools registered:
 * - `evaluate_expression` — Evaluate an expression with eval safety
 * - `get_variables` — Get variables with redaction
 * - `get_call_stack` — Get call stack with pagination
 * - `get_threads` — List debuggee threads
 * - `get_scopes` — Get scopes for a stack frame
 * - `manage_watch` — Add/remove/list/evaluate watch expressions
 * - `get_loaded_sources` — Get all loaded source files
 * - `get_modules` — Get loaded modules with pagination
 * - `get_exception_info` — Get exception details when stopped on exception
 *
 * @param server - The MCP server instance to register tools on.
 */
export function registerInspectionTools(server: Server): void {
  const toolMap = new Map<string, McpToolDefinition>();
  for (const tool of INSPECTION_TOOLS) {
    toolMap.set(tool.name, tool);
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: INSPECTION_TOOLS.map((t) => ({
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

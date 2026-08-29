import { resolve } from 'node:path';

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { createAdapterManager } from '../../adapters/index.js';
import { detectLanguage } from '../../adapters/detector.js';
import { JsDebugNotFoundError } from '../../adapters/js-debug/index.js';
import { NetcoredbgNotFoundError, NetFrameworkIncompatibleError } from '../../adapters/netcoredbg/index.js';
import { DapClient } from '../../dap/client.js';
import { StdioTransport } from '../../dap/transport/stdio.js';
import { isProcessAllowed } from '../../security/process-guard.js';
import { SessionManager } from '../../session/index.js';
import { CapabilityNotSupportedError } from '../../session/session.js';
import type { LanguageId } from '../../types/adapter.js';
import {
  launchDebugSchema,
  attachDebugSchema,
  disconnectSchema,
  terminateSchema,
  listSessionsSchema,
} from '../schemas.js';

/** Schema for the restart_session tool input. */
const restartSessionSchema = z.object({
  sessionId: z.string().describe('Session identifier'),
});

/** Definition of an MCP tool with its handler. */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  handler: (params: unknown) => Promise<CallToolResult>;
}

const sessionManager = new SessionManager();
const adapterManager = createAdapterManager();

/** Registry mapping session IDs to their DapClient instances. */
const clientRegistry = new Map<string, DapClient>();

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

async function handleLaunchDebug(params: unknown): Promise<CallToolResult> {
  try {
    const input = launchDebugSchema.parse(params);
    const programPath = resolve(input.cwd ?? process.cwd(), input.program);

    let language: LanguageId;
    if (input.language) {
      language = input.language;
    } else {
      const detected = await detectLanguage(programPath);
      if (!detected) {
        return errorResult(`Unable to detect language for: ${programPath}`);
      }
      language = detected;
    }

    const adapter = adapterManager.getAdapterForLanguage(language);
    if (!adapter) {
      return errorResult(`No adapter found for language: ${language}`);
    }

    const transport = new StdioTransport({ command: 'node', args: [] });
    const client = new DapClient({ transport });

    const session = sessionManager.createSession({
      config: {
        program: programPath,
        language,
        args: input.args ? [...input.args] : undefined,
        cwd: input.cwd,
        stopOnEntry: input.stopOnEntry,
      },
      client,
    });

    clientRegistry.set(session.id, client);

    await session.initialize();
    await session.launch({
      program: programPath,
      args: input.args,
      cwd: input.cwd,
      stopOnEntry: input.stopOnEntry ?? false,
    });

    return textResult({
      sessionId: session.id,
      state: session.state,
      language,
    });
  } catch (error: unknown) {
    if (error instanceof JsDebugNotFoundError) {
      return errorResult(`Adapter not found: ${error.message}`);
    }
    if (error instanceof NetcoredbgNotFoundError) {
      return errorResult(`Adapter not found: ${error.message}`);
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Transport is not connected')) {
      return errorResult(
        `Failed to launch: Debug adapter transport could not connect. ` +
        `The adapter binary may not be installed or accessible. ` +
        `Set AGENTIC_JSDEBUG_PATH or AGENTIC_NETCOREDBG_PATH to the adapter binary path.`,
      );
    }
    return errorResult(`Failed to launch debug session: ${message}`);
  }
}

async function handleAttachDebug(params: unknown): Promise<CallToolResult> {
  try {
    const input = attachDebugSchema.parse(params);

    if (input.pid !== undefined) {
      const guardResult = isProcessAllowed(input.pid);
      if (!guardResult.allowed) {
        return errorResult(`Process attach denied: ${guardResult.reason}`);
      }
    }

    const adapter = adapterManager.getAdapterForLanguage(input.language);
    if (!adapter) {
      return errorResult(`No adapter found for language: ${input.language}`);
    }

    const transport = new StdioTransport({ command: 'node', args: [] });
    const client = new DapClient({ transport });

    const session = sessionManager.createSession({
      config: {
        program: '',
        language: input.language,
      },
      client,
    });

    clientRegistry.set(session.id, client);

    await session.initialize();

    const attachArgs: Record<string, unknown> = {};
    if (input.pid !== undefined) {
      attachArgs['processId'] = input.pid;
    }
    if (input.host !== undefined) {
      attachArgs['host'] = input.host;
    }
    if (input.port !== undefined) {
      attachArgs['port'] = input.port;
    }
    if (input.type !== undefined) {
      attachArgs['debugType'] = input.type;
    }

    await session.attach(attachArgs);

    return textResult({
      sessionId: session.id,
      state: session.state,
      language: input.language,
    });
  } catch (error: unknown) {
    if (error instanceof JsDebugNotFoundError) {
      return errorResult(`Adapter not found: ${error.message}`);
    }
    if (error instanceof NetcoredbgNotFoundError) {
      return errorResult(`Adapter not found: ${error.message}`);
    }
    if (error instanceof NetFrameworkIncompatibleError) {
      return errorResult(`Runtime incompatible: ${error.message}`);
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Transport is not connected')) {
      return errorResult(
        `Failed to attach: Debug adapter transport could not connect. ` +
        `Possible causes:\n` +
        `  - The debug adapter binary was not found (set AGENTIC_JSDEBUG_PATH or AGENTIC_NETCOREDBG_PATH)\n` +
        `  - The target port uses a different protocol (try specifying "type": "chrome" or "msedge" for CDP endpoints)\n` +
        `  - The target process is not running or debugging is not enabled`,
      );
    }
    return errorResult(`Failed to attach debug session: ${message}`);
  }
}

async function handleDisconnect(params: unknown): Promise<CallToolResult> {
  try {
    const input = disconnectSchema.parse(params);
    const session = sessionManager.getSession(input.sessionId);
    await session.disconnect();
    clientRegistry.delete(input.sessionId);
    return textResult({
      sessionId: input.sessionId,
      state: session.state,
      disconnected: true,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Failed to disconnect session: ${message}`);
  }
}

async function handleTerminate(params: unknown): Promise<CallToolResult> {
  try {
    const input = terminateSchema.parse(params);
    const session = sessionManager.getSession(input.sessionId);
    await session.terminate();
    clientRegistry.delete(input.sessionId);
    return textResult({
      sessionId: input.sessionId,
      state: session.state,
      terminated: true,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Failed to terminate session: ${message}`);
  }
}

async function handleListSessions(_params: unknown): Promise<CallToolResult> {
  try {
    const sessions = sessionManager.listSessions();
    return textResult({ sessions, count: sessions.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Failed to list sessions: ${message}`);
  }
}

async function handleRestartSession(params: unknown): Promise<CallToolResult> {
  try {
    const input = restartSessionSchema.parse(params);
    const session = sessionManager.getSession(input.sessionId);
    await session.restart();
    return textResult({
      sessionId: input.sessionId,
      state: session.state,
      restarted: true,
    });
  } catch (error: unknown) {
    if (error instanceof CapabilityNotSupportedError) {
      return errorResult(`Restart not supported: capability '${error.capability}' is not available`);
    }
    const message = error instanceof Error ? error.message : String(error);
    return errorResult(`Failed to restart session: ${message}`);
  }
}

/** All session tool definitions. */
export const SESSION_TOOLS: readonly McpToolDefinition[] = [
  {
    name: 'launch_debug',
    description: 'Launch a new debug session for a program. Auto-detects language if not specified.',
    inputSchema: launchDebugSchema,
    handler: handleLaunchDebug,
  },
  {
    name: 'attach_debug',
    description: 'Attach to a running process for debugging. Supports Node.js V8 inspector (default), Chrome DevTools Protocol (type: "chrome"), and Edge/WebView2 CDP (type: "msedge"). Integrates process-guard security checks.',
    inputSchema: attachDebugSchema,
    handler: handleAttachDebug,
  },
  {
    name: 'disconnect',
    description: 'Gracefully disconnect from a debug session.',
    inputSchema: disconnectSchema,
    handler: handleDisconnect,
  },
  {
    name: 'terminate',
    description: 'Forcefully terminate the debuggee process.',
    inputSchema: terminateSchema,
    handler: handleTerminate,
  },
  {
    name: 'list_sessions',
    description: 'List all active debug sessions with their current state.',
    inputSchema: listSessionsSchema,
    handler: handleListSessions,
  },
  {
    name: 'restart_session',
    description: 'Restart the debug session. Requires adapter support for supportsRestartRequest.',
    inputSchema: restartSessionSchema,
    handler: handleRestartSession,
  },
];

/** Exported SessionManager singleton for use by other tool groups. */
export { sessionManager };

/** Exported client registry for use by other tool groups (e.g., breakpoint-tools). */
export { clientRegistry };

/**
 * Register session management tools on the MCP server.
 *
 * Tools registered:
 * - `launch_debug` — Launch a new debug session
 * - `attach_debug` — Attach to a running process
 * - `disconnect` — Disconnect from a debug session
 * - `terminate` — Terminate a debug session
 * - `list_sessions` — List all active debug sessions
 * - `restart_session` — Restart a debug session
 *
 * @param server - The MCP server instance to register tools on.
 */
export function registerSessionTools(server: Server): void {
  const toolMap = new Map<string, McpToolDefinition>();
  for (const tool of SESSION_TOOLS) {
    toolMap.set(tool.name, tool);
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: SESSION_TOOLS.map((t) => ({
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

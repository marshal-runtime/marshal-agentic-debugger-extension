import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { GetPromptResult, PromptMessage } from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { SESSION_TOOLS } from './tools/session-tools.js';
import { BREAKPOINT_TOOLS } from './tools/breakpoint-tools.js';
import { EXECUTION_TOOLS } from './tools/execution-tools.js';
import { INSPECTION_TOOLS } from './tools/inspection-tools.js';
import type { McpToolDefinition } from './tools/session-tools.js';
import {
  SESSION_RESOURCES,
  SESSION_RESOURCE_TEMPLATES,
  SESSION_RESOURCE_HANDLERS,
  SESSION_TEMPLATE_HANDLERS,
} from './resources/session-resources.js';
import {
  DEBUG_RESOURCE_TEMPLATES,
  DEBUG_TEMPLATE_HANDLERS,
} from './resources/debug-resources.js';
import { wireNotifications } from './notifications.js';

/** Options for creating the MCP server. */
export interface McpServerOptions {
  readonly name?: string;
  readonly version?: string;
}

/** Options for starting the MCP server with SSE transport. */
export interface McpSseOptions extends McpServerOptions {
  readonly port?: number;
}

/** Aggregate all tool definitions from all modules. */
const ALL_TOOLS: readonly McpToolDefinition[] = [
  ...SESSION_TOOLS,
  ...BREAKPOINT_TOOLS,
  ...EXECUTION_TOOLS,
  ...INSPECTION_TOOLS,
];

/**
 * Create and configure the MCP server with all tools and resources registered.
 *
 * Registers a unified handler for tool listing, tool calling, resource listing,
 * resource template listing, and resource reading. Wires notifications for
 * existing sessions.
 *
 * @param options - Server configuration options.
 * @returns The configured MCP Server instance.
 */
export function createMcpServer(options?: McpServerOptions): Server {
  const server = new Server(
    {
      name: options?.name ?? 'agentic-debugger',
      version: options?.version ?? '0.1.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );

  registerTools(server);
  registerResources(server);
  registerPrompts(server);

  // Wire notifications — currently no active sessions at server creation time
  wireNotifications(server, []);

  return server;
}

/** Register unified tool handlers on the server. */
function registerTools(server: Server): void {
  const toolMap = new Map<string, McpToolDefinition>();
  for (const tool of ALL_TOOLS) {
    toolMap.set(tool.name, tool);
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: ALL_TOOLS.map((t) => ({
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
      return {
        content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }
    return tool.handler(args);
  });
}

/** Register unified resource handlers on the server. */
function registerResources(server: Server): void {
  const allResources = [...SESSION_RESOURCES];
  const allTemplates = [...SESSION_RESOURCE_TEMPLATES, ...DEBUG_RESOURCE_TEMPLATES];
  const allStaticHandlers = SESSION_RESOURCE_HANDLERS;
  const allTemplateHandlers = [...SESSION_TEMPLATE_HANDLERS, ...DEBUG_TEMPLATE_HANDLERS];

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: allResources.map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      })),
    };
  });

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
    return {
      resourceTemplates: allTemplates.map((t) => ({
        uriTemplate: t.uriTemplate,
        name: t.name,
        description: t.description,
        mimeType: t.mimeType,
      })),
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    // Check static resource handlers first
    const staticHandler = allStaticHandlers.get(uri);
    if (staticHandler) {
      const text = await staticHandler(uri);
      return {
        contents: [{ uri, mimeType: 'application/json', text }],
      };
    }

    // Check template resource handlers
    for (const templateHandler of allTemplateHandlers) {
      if (templateHandler.pattern.test(uri)) {
        const text = await templateHandler.handler(uri);
        return {
          contents: [{ uri, mimeType: 'application/json', text }],
        };
      }
    }

    throw new Error(`Unknown resource URI: ${uri}`);
  });
}

/** Helper to create a user-role text prompt message. */
function userMessage(text: string): PromptMessage {
  return { role: 'user', content: { type: 'text', text } };
}

/** Prompt template definition for internal registration. */
interface PromptTemplate {
  readonly name: string;
  readonly description: string;
  readonly arguments: ReadonlyArray<{
    readonly name: string;
    readonly description: string;
    readonly required: boolean;
  }>;
  readonly buildMessages: (args: Record<string, string | undefined>) => PromptMessage[];
}

/** All registered prompt templates. */
const PROMPT_TEMPLATES: readonly PromptTemplate[] = [
  {
    name: 'basic-debug-workflow',
    description: 'Step-by-step guide to debug a program',
    arguments: [
      { name: 'program', description: 'Path to the program to debug', required: true },
      { name: 'language', description: 'Programming language of the program', required: false },
    ],
    buildMessages(args) {
      const program = args['program'] ?? 'unknown';
      const lang = args['language'] ? ` (${args['language']})` : '';
      return [
        userMessage(`Launch the debugger for ${program}${lang}.`),
        userMessage('Set breakpoints at key entry points and suspicious locations.'),
        userMessage('Continue execution and observe where the program stops.'),
        userMessage('Inspect local variables and the call stack at each breakpoint.'),
        userMessage('Identify the root cause and apply a fix.'),
      ];
    },
  },
  {
    name: 'exception-diagnosis',
    description: 'Diagnose an exception or crash',
    arguments: [
      { name: 'program', description: 'Path to the program to debug', required: true },
      { name: 'exception_type', description: 'Type of exception to catch', required: false },
    ],
    buildMessages(args) {
      const program = args['program'] ?? 'unknown';
      const exType = args['exception_type'] ?? 'all exceptions';
      return [
        userMessage(`Launch ${program} with exception breakpoints enabled for ${exType}.`),
        userMessage('Trigger the scenario that causes the exception.'),
        userMessage('Inspect the exception info including message, type, and stack trace.'),
        userMessage('Examine local variables and object state at the throw site.'),
        userMessage('Suggest a fix based on the gathered evidence.'),
      ];
    },
  },
  {
    name: 'performance-investigation',
    description: 'Investigate performance issues',
    arguments: [
      { name: 'program', description: 'Path to the program to debug', required: true },
    ],
    buildMessages(args) {
      const program = args['program'] ?? 'unknown';
      return [
        userMessage(`Launch ${program} under the debugger.`),
        userMessage('Set strategic breakpoints at suspected hot paths and loop entries.'),
        userMessage('Measure execution time between breakpoints to identify slow sections.'),
        userMessage('Identify bottlenecks by examining iteration counts and data sizes.'),
      ];
    },
  },
];

/** Register prompt template handlers on the server. */
function registerPrompts(server: Server): void {
  const promptMap = new Map<string, PromptTemplate>();
  for (const prompt of PROMPT_TEMPLATES) {
    promptMap.set(prompt.name, prompt);
  }

  server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return {
      prompts: PROMPT_TEMPLATES.map((p) => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments.map((a) => ({
          name: a.name,
          description: a.description,
          required: a.required,
        })),
      })),
    };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const prompt = promptMap.get(name);
    if (!prompt) {
      throw new Error(`Unknown prompt: ${name}`);
    }
    const messages = prompt.buildMessages(args ?? {});
    return { description: prompt.description, messages } satisfies GetPromptResult;
  });
}

/**
 * Start the MCP server on stdio transport.
 *
 * Creates the server, connects it to stdin/stdout, and runs until
 * the transport is closed.
 */
export async function startMcpServer(options?: McpServerOptions): Promise<void> {
  const server = createMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * Start the MCP server on SSE transport over HTTP.
 *
 * Creates an HTTP server that serves SSE connections on GET /sse
 * and accepts JSON-RPC messages on POST /messages.
 *
 * @param options - Server and transport configuration options.
 */
export async function startMcpServerSSE(options?: McpSseOptions): Promise<void> {
  const port = options?.port ?? 3000;
  const server = createMcpServer(options);

  const transports = new Map<string, SSEServerTransport>();

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    if (req.method === 'GET' && url.pathname === '/sse') {
      const transport = new SSEServerTransport('/messages', res);
      transports.set(transport.sessionId, transport);

      transport.onclose = () => {
        transports.delete(transport.sessionId);
      };

      await server.connect(transport);
      await transport.start();
      return;
    }

    if (req.method === 'POST' && url.pathname === '/messages') {
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing sessionId query parameter' }));
        return;
      }

      const transport = transports.get(sessionId);
      if (!transport) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unknown session' }));
        return;
      }

      await transport.handlePostMessage(req, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  const httpServer = createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      void handleRequest(req, res);
    },
  );

  await new Promise<void>((resolve) => {
    httpServer.listen(port, () => {
      resolve();
    });
  });
}

// Re-export MCP layer types and utilities
export type { McpServerOptions as McpOptions };
export { McpNotificationType, wireNotifications, wireSessionNotifications } from './notifications.js';
export type {
  McpNotificationPayload,
  StoppedNotificationPayload,
  ContinuedNotificationPayload,
  TerminatedNotificationPayload,
  OutputNotificationPayload,
  BreakpointNotificationPayload,
  ThreadNotificationPayload,
} from './notifications.js';
export type { McpToolDefinition } from './tools/session-tools.js';

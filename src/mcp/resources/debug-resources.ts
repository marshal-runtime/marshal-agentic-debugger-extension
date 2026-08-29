import type { DebugProtocol } from '@vscode/debugprotocol';

import type { DapClient } from '../../dap/client.js';
import { redactValue } from '../../security/redaction.js';
import { sessionManager, clientRegistry } from '../tools/session-tools.js';
import type {
  McpResourceTemplateDefinition,
  TemplateResourceHandler,
} from './session-resources.js';

/** Extract the first capture group from a URI pattern, throwing on mismatch. */
function extractOne(uri: string, pattern: RegExp, label: string): string {
  const match = pattern.exec(uri);
  if (!match || match[1] === undefined) {
    throw new Error(`Invalid ${label} URI: ${uri}`);
  }
  return match[1];
}

/** Extract two capture groups from a URI pattern, throwing on mismatch. */
function extractTwo(uri: string, pattern: RegExp, label: string): [string, string] {
  const match = pattern.exec(uri);
  if (!match || match[1] === undefined || match[2] === undefined) {
    throw new Error(`Invalid ${label} URI: ${uri}`);
  }
  return [match[1], match[2]];
}

/** Get a DapClient for a session or throw. */
function getClient(sessionId: string): DapClient {
  sessionManager.getSession(sessionId);
  const client = clientRegistry.get(sessionId);
  if (!client) {
    throw new Error(`No DAP client found for session: ${sessionId}`);
  }
  return client;
}

async function readBreakpoints(uri: string): Promise<string> {
  const sessionId = extractOne(uri, /^debug:\/\/sessions\/([^/]+)\/breakpoints$/, 'breakpoints');
  sessionManager.getSession(sessionId);

  const { BREAKPOINT_TOOLS } = await import('../tools/breakpoint-tools.js');
  const listTool = BREAKPOINT_TOOLS.find((t) => t.name === 'list_breakpoints');
  if (!listTool) {
    throw new Error('list_breakpoints tool not found');
  }

  const result = await listTool.handler({ sessionId });
  const textContent = result.content.find((c) => c.type === 'text');
  return textContent && 'text' in textContent ? textContent.text : '{}';
}

async function readThreads(uri: string): Promise<string> {
  const sessionId = extractOne(uri, /^debug:\/\/sessions\/([^/]+)\/threads$/, 'threads');
  const client = getClient(sessionId);

  const response = await client.threads();
  const body = response.body as { threads?: DebugProtocol.Thread[] } | undefined;
  const threads = body?.threads ?? [];

  return JSON.stringify(
    {
      sessionId,
      threads: threads.map((t) => ({ id: t.id, name: t.name })),
      count: threads.length,
    },
    null,
    2,
  );
}

async function readCallStack(uri: string): Promise<string> {
  const [sessionId, threadIdStr] = extractTwo(
    uri,
    /^debug:\/\/sessions\/([^/]+)\/callstack\/(\d+)$/,
    'callstack',
  );
  const threadId = parseInt(threadIdStr, 10);
  const client = getClient(sessionId);

  const response = await client.stackTrace({ threadId });
  const body = response.body as {
    stackFrames?: DebugProtocol.StackFrame[];
    totalFrames?: number;
  } | undefined;
  const stackFrames = body?.stackFrames ?? [];

  return JSON.stringify(
    {
      sessionId,
      threadId,
      stackFrames: stackFrames.map((frame) => ({
        id: frame.id,
        name: frame.name,
        source: frame.source?.path ?? frame.source?.name,
        line: frame.line,
        column: frame.column,
      })),
      totalFrames: body?.totalFrames ?? stackFrames.length,
    },
    null,
    2,
  );
}

async function readVariables(uri: string): Promise<string> {
  const [sessionId, frameIdStr] = extractTwo(
    uri,
    /^debug:\/\/sessions\/([^/]+)\/variables\/(\d+)$/,
    'variables',
  );
  const frameId = parseInt(frameIdStr, 10);
  const client = getClient(sessionId);

  const scopesResponse = await client.scopes({ frameId });
  const scopesBody = scopesResponse.body as { scopes?: DebugProtocol.Scope[] } | undefined;
  const scopes = scopesBody?.scopes ?? [];

  const allVariables: Array<{
    scope: string;
    variables: Array<{
      name: string;
      value: string;
      type?: string;
      variablesReference: number;
      redacted: boolean;
    }>;
  }> = [];

  for (const scope of scopes) {
    const varsResponse = await client.variables({
      variablesReference: scope.variablesReference,
    });
    const varsBody = varsResponse.body as { variables?: DebugProtocol.Variable[] } | undefined;
    const variables = varsBody?.variables ?? [];

    allVariables.push({
      scope: scope.name,
      variables: variables.map((v) => {
        const redaction = redactValue(v.name, v.value);
        return {
          name: v.name,
          value: redaction.value,
          type: v.type,
          variablesReference: v.variablesReference,
          redacted: redaction.redacted,
        };
      }),
    });
  }

  return JSON.stringify({ sessionId, frameId, scopes: allVariables }, null, 2);
}

async function readWatches(uri: string): Promise<string> {
  const sessionId = extractOne(uri, /^debug:\/\/sessions\/([^/]+)\/watches$/, 'watches');
  sessionManager.getSession(sessionId);

  const { INSPECTION_TOOLS } = await import('../tools/inspection-tools.js');
  const watchTool = INSPECTION_TOOLS.find((t) => t.name === 'manage_watch');
  if (!watchTool) {
    throw new Error('manage_watch tool not found');
  }

  const result = await watchTool.handler({ sessionId, action: 'list' });
  const textContent = result.content.find((c) => c.type === 'text');
  return textContent && 'text' in textContent ? textContent.text : '{}';
}

/** Template resources for debug state. */
export const DEBUG_RESOURCE_TEMPLATES: readonly McpResourceTemplateDefinition[] = [
  {
    uriTemplate: 'debug://sessions/{id}/breakpoints',
    name: 'Session Breakpoints',
    description: 'List of breakpoints for a debug session',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'debug://sessions/{id}/threads',
    name: 'Session Threads',
    description: 'List of threads in the debuggee process',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'debug://sessions/{id}/callstack/{threadId}',
    name: 'Thread Call Stack',
    description: 'Call stack for a specific thread',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'debug://sessions/{id}/variables/{frameId}',
    name: 'Frame Variables',
    description: 'Variables in scope for a specific stack frame (with redaction)',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'debug://sessions/{id}/watches',
    name: 'Session Watches',
    description: 'Watch expressions for a debug session',
    mimeType: 'application/json',
  },
];

/** Pattern-based handlers for debug template resources. */
export const DEBUG_TEMPLATE_HANDLERS: readonly TemplateResourceHandler[] = [
  {
    pattern: /^debug:\/\/sessions\/[^/]+\/breakpoints$/,
    handler: readBreakpoints,
  },
  {
    pattern: /^debug:\/\/sessions\/[^/]+\/threads$/,
    handler: readThreads,
  },
  {
    pattern: /^debug:\/\/sessions\/[^/]+\/callstack\/\d+$/,
    handler: readCallStack,
  },
  {
    pattern: /^debug:\/\/sessions\/[^/]+\/variables\/\d+$/,
    handler: readVariables,
  },
  {
    pattern: /^debug:\/\/sessions\/[^/]+\/watches$/,
    handler: readWatches,
  },
];

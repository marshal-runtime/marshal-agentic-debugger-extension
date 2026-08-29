import { sessionManager } from '../tools/session-tools.js';

/** Static resource definition for MCP registration. */
export interface McpResourceDefinition {
  readonly uri: string;
  readonly name: string;
  readonly description: string;
  readonly mimeType: string;
}

/** Template resource definition for MCP registration. */
export interface McpResourceTemplateDefinition {
  readonly uriTemplate: string;
  readonly name: string;
  readonly description: string;
  readonly mimeType: string;
}

/** Read handler for resolving a resource URI to content. */
export type ResourceReadHandler = (uri: string) => Promise<string>;

/** Sessions list resource. */
async function readSessionsList(): Promise<string> {
  const sessions = sessionManager.listSessions();
  return JSON.stringify({ sessions, count: sessions.length }, null, 2);
}

/** Single session state resource. */
async function readSessionState(uri: string): Promise<string> {
  const sessionId = extractSessionId(uri, /^debug:\/\/sessions\/([^/]+)\/state$/);
  if (!sessionId) {
    throw new Error(`Invalid session state URI: ${uri}`);
  }
  const session = sessionManager.getSession(sessionId);
  return JSON.stringify(session.snapshot(), null, 2);
}

/** Extract a capture group from a URI using a regex pattern. */
function extractSessionId(uri: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(uri);
  return match?.[1];
}

/** Static resources for sessions. */
export const SESSION_RESOURCES: readonly McpResourceDefinition[] = [
  {
    uri: 'debug://sessions',
    name: 'Debug Sessions',
    description: 'List of all active debug sessions with ID, state, language, and adapter',
    mimeType: 'application/json',
  },
];

/** Template resources for sessions. */
export const SESSION_RESOURCE_TEMPLATES: readonly McpResourceTemplateDefinition[] = [
  {
    uriTemplate: 'debug://sessions/{id}/state',
    name: 'Session State',
    description: 'Detailed state for a specific debug session',
    mimeType: 'application/json',
  },
];

/** Route map from URI pattern to read handler. */
export const SESSION_RESOURCE_HANDLERS: ReadonlyMap<string, ResourceReadHandler> = new Map<
  string,
  ResourceReadHandler
>([
  ['debug://sessions', readSessionsList],
]);

/** Pattern-based handlers for template resources. */
export interface TemplateResourceHandler {
  readonly pattern: RegExp;
  readonly handler: ResourceReadHandler;
}

export const SESSION_TEMPLATE_HANDLERS: readonly TemplateResourceHandler[] = [
  {
    pattern: /^debug:\/\/sessions\/[^/]+\/state$/,
    handler: readSessionState,
  },
];

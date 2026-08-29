import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createMcpServer } from '../../src/mcp/index.js';
import { hasBinary } from './helpers/adapter-helpers.js';

const TEST_PROGRAM = resolve(__dirname, 'helpers/test-programs/js/basic.js');
const BREAKPOINT_LINE = 5;

const jsDebugAvailable = hasBinary('js-debug');

interface ToolTextContent {
  readonly type: 'text';
  readonly text: string;
}

interface CallToolContentResult {
  readonly content: ReadonlyArray<{ type: string; text?: string }>;
  readonly isError?: boolean;
}

function hasContent(result: unknown): result is CallToolContentResult {
  return (
    typeof result === 'object' &&
    result !== null &&
    'content' in result &&
    Array.isArray((result as CallToolContentResult).content)
  );
}

function parseToolResult(result: unknown): unknown {
  if (!hasContent(result)) {
    throw new Error('Tool result does not contain content array');
  }
  const textContent = result.content.find(
    (c): c is ToolTextContent => c.type === 'text',
  );
  if (!textContent) {
    throw new Error('No text content in tool result');
  }
  return JSON.parse(textContent.text);
}

function getToolError(result: unknown): string | undefined {
  if (!hasContent(result)) {
    return undefined;
  }
  if (!result.isError) {
    return undefined;
  }
  const textContent = result.content.find(
    (c): c is ToolTextContent => c.type === 'text',
  );
  return textContent?.text;
}

describe('MCP server integration', () => {
  describe('server lifecycle and schema validation', () => {
    let client: Client;
    let serverTransport: InMemoryTransport;
    let clientTransport: InMemoryTransport;

    beforeAll(async () => {
      const server = createMcpServer({ name: 'test-server', version: '0.0.1' });
      [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

      client = new Client({ name: 'test-client', version: '0.0.1' });

      await server.connect(serverTransport);
      await client.connect(clientTransport);
    }, 10_000);

    afterAll(async () => {
      await clientTransport.close();
      await serverTransport.close();
    });

    it('should list all registered tools', async () => {
      const result = await client.listTools();
      const toolNames = result.tools.map((t) => t.name);

      expect(toolNames).toContain('launch_debug');
      expect(toolNames).toContain('set_breakpoint');
      expect(toolNames).toContain('continue_execution');
      expect(toolNames).toContain('get_variables');
      expect(toolNames).toContain('list_sessions');
      expect(toolNames).toContain('evaluate_expression');
      expect(toolNames).toContain('get_threads');
      expect(toolNames).toContain('get_scopes');
      expect(toolNames).toContain('manage_watch');
      expect(toolNames).toContain('step_over');
      expect(toolNames).toContain('step_into');
      expect(toolNames).toContain('step_out');
      expect(toolNames).toContain('pause_execution');
      expect(toolNames).toContain('disconnect');
      expect(toolNames).toContain('terminate');
      expect(toolNames).toContain('attach_debug');
      expect(toolNames).toContain('set_function_breakpoint');
      expect(toolNames).toContain('set_exception_breakpoints');
      expect(toolNames).toContain('set_data_breakpoint');
      expect(toolNames).toContain('list_breakpoints');
      expect(toolNames).toContain('remove_breakpoint');
      expect(toolNames).toContain('get_call_stack');
      expect(toolNames).toContain('set_next_statement');

      for (const tool of result.tools) {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
      }
    });

    it('should list registered resources', async () => {
      const result = await client.listResources();
      const resourceUris = result.resources.map((r) => r.uri);

      expect(resourceUris).toContain('debug://sessions');
    });

    it('should list registered resource templates', async () => {
      const result = await client.listResourceTemplates();
      const templateUris = result.resourceTemplates.map((t) => t.uriTemplate);

      expect(templateUris).toContain('debug://sessions/{id}/state');
      expect(templateUris).toContain('debug://sessions/{id}/breakpoints');
      expect(templateUris).toContain('debug://sessions/{id}/threads');
      expect(templateUris).toContain('debug://sessions/{id}/callstack/{threadId}');
      expect(templateUris).toContain('debug://sessions/{id}/variables/{frameId}');
      expect(templateUris).toContain('debug://sessions/{id}/watches');
    });

    it('should return structured error for unknown tool', async () => {
      const result = await client.callTool({
        name: 'nonexistent_tool',
        arguments: {},
      });

      expect(hasContent(result)).toBe(true);
      if (hasContent(result)) {
        expect(result.isError).toBe(true);
        const errorText = getToolError(result);
        expect(errorText).toContain('Unknown tool');
      }
    });

    it('should return structured error for malformed set_breakpoint input', async () => {
      const result = await client.callTool({
        name: 'set_breakpoint',
        arguments: {
          sessionId: 'nonexistent',
          file: 123,
          line: 'not-a-number',
        },
      });

      expect(hasContent(result)).toBe(true);
      if (hasContent(result)) {
        expect(result.isError).toBe(true);
      }
    });

    it('should return structured error for missing required fields', async () => {
      const result = await client.callTool({
        name: 'set_breakpoint',
        arguments: {},
      });

      expect(hasContent(result)).toBe(true);
      if (hasContent(result)) {
        expect(result.isError).toBe(true);
      }
    });

    it('should return structured error for malformed launch_debug input', async () => {
      const result = await client.callTool({
        name: 'launch_debug',
        arguments: {
          program: 42,
        },
      });

      expect(hasContent(result)).toBe(true);
      if (hasContent(result)) {
        expect(result.isError).toBe(true);
      }
    });

    it('should read debug://sessions resource with no sessions', async () => {
      const result = await client.readResource({ uri: 'debug://sessions' });

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0]!.mimeType).toBe('application/json');

      const content = result.contents[0]!;
      const text = 'text' in content ? (content as { text: string }).text : '';
      const data = JSON.parse(text) as { sessions: unknown[]; count: number };
      expect(data).toHaveProperty('sessions');
      expect(data).toHaveProperty('count');
      expect(Array.isArray(data.sessions)).toBe(true);
    });

    it('should return error for continue_execution with nonexistent session', async () => {
      const result = await client.callTool({
        name: 'continue_execution',
        arguments: {
          sessionId: 'does-not-exist',
        },
      });

      expect(hasContent(result)).toBe(true);
      if (hasContent(result)) {
        expect(result.isError).toBe(true);
        const errorText = getToolError(result);
        expect(errorText).toBeDefined();
      }
    });

    it('should return error for get_variables with nonexistent session', async () => {
      const result = await client.callTool({
        name: 'get_variables',
        arguments: {
          sessionId: 'does-not-exist',
          variablesReference: 1,
        },
      });

      expect(hasContent(result)).toBe(true);
      if (hasContent(result)) {
        expect(result.isError).toBe(true);
      }
    });

    it('should list sessions via tool when no sessions exist', async () => {
      const result = await client.callTool({
        name: 'list_sessions',
        arguments: {},
      });

      const data = parseToolResult(result) as { sessions: unknown[]; count: number };
      expect(data.sessions).toBeDefined();
      expect(data.count).toBe(0);
    });
  });

  describe.skipIf(!jsDebugAvailable)('tool invocations with js-debug', () => {
    let client: Client;
    let serverTransport: InMemoryTransport;
    let clientTransport: InMemoryTransport;
    let sessionId: string;
    let notificationsReceived: Array<{ method: string; params: Record<string, unknown> }>;

    beforeAll(async () => {
      const server = createMcpServer({ name: 'test-server-debug', version: '0.0.1' });
      [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

      client = new Client({ name: 'test-client-debug', version: '0.0.1' });

      notificationsReceived = [];

      const originalOnMessage = clientTransport.onmessage;
      clientTransport.onmessage = (message, extra) => {
        const msg = message as Record<string, unknown>;
        if (msg['method'] && !msg['id']) {
          notificationsReceived.push({
            method: msg['method'] as string,
            params: (msg['params'] ?? {}) as Record<string, unknown>,
          });
        }
        if (originalOnMessage) {
          originalOnMessage(message, extra);
        }
      };

      await server.connect(serverTransport);
      await client.connect(clientTransport);
    }, 15_000);

    afterAll(async () => {
      if (sessionId) {
        try {
          await client.callTool({
            name: 'disconnect',
            arguments: { sessionId, terminateDebuggee: true },
          });
        } catch {
          // Best-effort cleanup
        }
      }
      await clientTransport.close();
      await serverTransport.close();
    }, 15_000);

    it('should launch a debug session via launch_debug tool', async () => {
      const result = await client.callTool({
        name: 'launch_debug',
        arguments: {
          program: TEST_PROGRAM,
          language: 'javascript',
          stopOnEntry: true,
        },
      });

      expect(hasContent(result)).toBe(true);
      if (hasContent(result)) {
        expect(result.isError).toBeUndefined();
      }

      const data = parseToolResult(result) as {
        sessionId: string;
        state: string;
        language: string;
      };

      expect(data.sessionId).toBeDefined();
      expect(typeof data.sessionId).toBe('string');
      expect(data.language).toBe('javascript');
      sessionId = data.sessionId;
    }, 30_000);

    it('should list sessions including the active session', async () => {
      const result = await client.callTool({
        name: 'list_sessions',
        arguments: {},
      });

      const data = parseToolResult(result) as { sessions: Array<{ sessionId: string }>; count: number };
      expect(data.count).toBeGreaterThanOrEqual(1);

      const found = data.sessions.some(
        (s) => s.sessionId === sessionId,
      );
      expect(found).toBe(true);
    }, 10_000);

    it('should set a breakpoint via set_breakpoint tool', async () => {
      const result = await client.callTool({
        name: 'set_breakpoint',
        arguments: {
          sessionId,
          file: TEST_PROGRAM,
          line: BREAKPOINT_LINE,
        },
      });

      expect(hasContent(result)).toBe(true);
      if (hasContent(result)) {
        expect(result.isError).toBeUndefined();
      }

      const data = parseToolResult(result) as {
        sessionId: string;
        file: string;
        line: number;
        verified: boolean;
      };

      expect(data.sessionId).toBe(sessionId);
      expect(data.file).toBe(TEST_PROGRAM);
      expect(data.line).toBe(BREAKPOINT_LINE);
      expect(data.verified).toBe(true);
    }, 10_000);

    it('should continue execution via continue_execution tool', async () => {
      const result = await client.callTool({
        name: 'continue_execution',
        arguments: {
          sessionId,
        },
      });

      expect(hasContent(result)).toBe(true);
      if (hasContent(result)) {
        expect(result.isError).toBeUndefined();
      }

      const data = parseToolResult(result) as {
        sessionId: string;
        threadId: number;
        allThreadsContinued: boolean;
      };

      expect(data.sessionId).toBe(sessionId);
      expect(data.threadId).toBeGreaterThan(0);

      // Wait for the program to hit the breakpoint
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }, 15_000);

    it('should get variables via get_variables tool', async () => {
      const threadsResult = await client.callTool({
        name: 'get_threads',
        arguments: { sessionId },
      });

      expect(hasContent(threadsResult)).toBe(true);
      const threadsData = parseToolResult(threadsResult) as {
        threads: Array<{ id: number }>;
      };
      const threadId = threadsData.threads[0]?.id ?? 1;

      const stackResult = await client.callTool({
        name: 'get_call_stack',
        arguments: { sessionId, threadId },
      });

      expect(hasContent(stackResult)).toBe(true);
      const stackData = parseToolResult(stackResult) as {
        stackFrames: Array<{ id: number }>;
      };

      const frameId = stackData.stackFrames[0]?.id;
      expect(frameId).toBeDefined();

      const scopesResult = await client.callTool({
        name: 'get_scopes',
        arguments: { sessionId, frameId: frameId! },
      });

      expect(hasContent(scopesResult)).toBe(true);
      const scopesData = parseToolResult(scopesResult) as {
        scopes: Array<{ name: string; variablesReference: number }>;
      };

      const localScope = scopesData.scopes.find(
        (s) => s.name === 'Local' || s.name === 'Closure',
      ) ?? scopesData.scopes[0];

      expect(localScope).toBeDefined();

      const varsResult = await client.callTool({
        name: 'get_variables',
        arguments: {
          sessionId,
          variablesReference: localScope!.variablesReference,
        },
      });

      expect(hasContent(varsResult)).toBe(true);
      const varsData = parseToolResult(varsResult) as {
        variables: Array<{ name: string; value: string }>;
        count: number;
      };

      expect(varsData.variables).toBeDefined();
      expect(varsData.count).toBeGreaterThan(0);
    }, 15_000);

    it('should read debug://sessions resource with active session', async () => {
      const result = await client.readResource({ uri: 'debug://sessions' });

      expect(result.contents).toHaveLength(1);
      const content = result.contents[0]!;
      const text = 'text' in content ? (content as { text: string }).text : '';
      const data = JSON.parse(text) as { sessions: Array<{ sessionId: string }>; count: number };

      expect(data.count).toBeGreaterThanOrEqual(1);
      const found = data.sessions.some((s) => s.sessionId === sessionId);
      expect(found).toBe(true);
    }, 10_000);

    it('should read debug://sessions/{id}/state resource', async () => {
      const result = await client.readResource({
        uri: `debug://sessions/${sessionId}/state`,
      });

      expect(result.contents).toHaveLength(1);
      const content = result.contents[0]!;
      const text = 'text' in content ? (content as { text: string }).text : '';
      const data = JSON.parse(text) as { sessionId: string; state: string };

      expect(data).toHaveProperty('sessionId');
      expect(data).toHaveProperty('state');
      expect(data.sessionId).toBe(sessionId);
    }, 10_000);

    it('should verify MCP notification emission on stopped event', () => {
      const stoppedNotifications = notificationsReceived.filter(
        (n) => n.method === 'notifications/debug/stopped',
      );

      expect(stoppedNotifications.length).toBeGreaterThanOrEqual(1);

      const notification = stoppedNotifications[0]!;
      expect(notification.params).toHaveProperty('sessionId');
      expect(notification.params).toHaveProperty('timestamp');
      expect(notification.params).toHaveProperty('reason');
    });
  });
});

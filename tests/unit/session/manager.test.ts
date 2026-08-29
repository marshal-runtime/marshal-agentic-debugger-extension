import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager } from '../../../src/session/index.js';
import { SessionNotFoundError, MaxSessionsExceededError } from '../../../src/session/types.js';
import { SessionState } from '../../../src/types/session.js';
import type { DapClient } from '../../../src/dap/client.js';
import type { DapEventHandler, DapResponse } from '../../../src/dap/types.js';
import type { CreateSessionOptions } from '../../../src/session/index.js';

function successResponse(command: string, body?: unknown): DapResponse {
  return { seq: 1, type: 'response', request_seq: 1, success: true, command, body };
}

function createMockClient(): DapClient {
  const eventHandlers = new Map<string, DapEventHandler[]>();

  return {
    initialize: vi.fn<DapClient['initialize']>().mockResolvedValue(
      successResponse('initialize', { supportsConfigurationDoneRequest: true }),
    ),
    configurationDone: vi.fn<DapClient['configurationDone']>().mockResolvedValue(
      successResponse('configurationDone'),
    ),
    launch: vi.fn<DapClient['launch']>().mockResolvedValue(successResponse('launch')),
    attach: vi.fn<DapClient['attach']>().mockResolvedValue(successResponse('attach')),
    disconnect: vi.fn<DapClient['disconnect']>().mockResolvedValue(successResponse('disconnect')),
    sendRequest: vi.fn<DapClient['sendRequest']>().mockResolvedValue(successResponse('terminate')),
    onEvent(eventType: string, handler: DapEventHandler): void {
      const list = eventHandlers.get(eventType) ?? [];
      list.push(handler);
      eventHandlers.set(eventType, list);
    },
    getCapabilities: vi.fn().mockReturnValue(undefined),
    setBreakpoints: vi.fn<DapClient['setBreakpoints']>().mockResolvedValue(successResponse('setBreakpoints')),
    setFunctionBreakpoints: vi.fn<DapClient['setFunctionBreakpoints']>().mockResolvedValue(successResponse('setFunctionBreakpoints')),
    setExceptionBreakpoints: vi.fn<DapClient['setExceptionBreakpoints']>().mockResolvedValue(successResponse('setExceptionBreakpoints')),
    continue: vi.fn<DapClient['continue']>().mockResolvedValue(successResponse('continue')),
    next: vi.fn<DapClient['next']>().mockResolvedValue(successResponse('next')),
    stepIn: vi.fn<DapClient['stepIn']>().mockResolvedValue(successResponse('stepIn')),
    stepOut: vi.fn<DapClient['stepOut']>().mockResolvedValue(successResponse('stepOut')),
    pause: vi.fn<DapClient['pause']>().mockResolvedValue(successResponse('pause')),
    stackTrace: vi.fn<DapClient['stackTrace']>().mockResolvedValue(successResponse('stackTrace')),
    scopes: vi.fn<DapClient['scopes']>().mockResolvedValue(successResponse('scopes')),
    variables: vi.fn<DapClient['variables']>().mockResolvedValue(successResponse('variables')),
    evaluate: vi.fn<DapClient['evaluate']>().mockResolvedValue(successResponse('evaluate')),
    threads: vi.fn<DapClient['threads']>().mockResolvedValue(successResponse('threads')),
    gotoTargets: vi.fn<DapClient['gotoTargets']>().mockResolvedValue(successResponse('gotoTargets')),
    goto: vi.fn<DapClient['goto']>().mockResolvedValue(successResponse('goto')),
    dispose: vi.fn(),
  } as unknown as DapClient;
}

function createOptions(client?: DapClient): CreateSessionOptions {
  return {
    config: {
      program: '/app/main.ts',
      language: 'typescript',
    },
    client: client ?? createMockClient(),
  };
}

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  it('should create a new session with a unique sess- prefixed ID', () => {
    const session = manager.createSession(createOptions());
    expect(session.id).toMatch(/^sess-[a-zA-Z0-9_-]{8}$/);
    expect(session.state).toBe(SessionState.Idle);
    expect(manager.activeCount).toBe(1);
  });

  it('should generate unique IDs for each session', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const session = manager.createSession(createOptions());
      ids.add(session.id);
    }
    expect(ids.size).toBe(5);
  });

  it('should retrieve a session by id', () => {
    const session = manager.createSession(createOptions());
    const retrieved = manager.getSession(session.id);
    expect(retrieved).toBe(session);
  });

  it('should throw SessionNotFoundError for unknown session id', () => {
    expect(() => manager.getSession('sess-unknown1')).toThrow(SessionNotFoundError);
    expect(() => manager.getSession('sess-unknown1')).toThrow('Session not found: sess-unknown1');
  });

  it('should list all active sessions as snapshots', () => {
    manager.createSession(createOptions());
    manager.createSession(createOptions());
    manager.createSession(createOptions());

    const snapshots = manager.listSessions();
    expect(snapshots).toHaveLength(3);
    for (const snap of snapshots) {
      expect(snap.sessionId).toMatch(/^sess-/);
      expect(snap.state).toBe(SessionState.Idle);
      expect(snap.language).toBe('typescript');
      expect(snap.createdAt).toBeDefined();
    }
  });

  it('should destroy a running session with graceful disconnect', async () => {
    const mockClient = createMockClient();
    const session = manager.createSession(createOptions(mockClient));
    expect(manager.activeCount).toBe(1);

    await session.initialize();
    await session.launch({ program: '/app/main.ts' });
    expect(session.state).toBe(SessionState.Running);

    await manager.destroySession(session.id);
    expect(manager.activeCount).toBe(0);
    expect(mockClient.disconnect).toHaveBeenCalledOnce();
    expect(() => manager.getSession(session.id)).toThrow(SessionNotFoundError);
  });

  it('should destroy an idle session without calling disconnect', async () => {
    const mockClient = createMockClient();
    const session = manager.createSession(createOptions(mockClient));
    expect(session.state).toBe(SessionState.Idle);

    await manager.destroySession(session.id);
    expect(manager.activeCount).toBe(0);
    expect(mockClient.disconnect).not.toHaveBeenCalled();
  });

  it('should throw SessionNotFoundError when destroying unknown session', async () => {
    await expect(manager.destroySession('sess-unknown1')).rejects.toThrow(SessionNotFoundError);
  });

  it('should enforce maximum concurrent sessions limit', () => {
    const smallManager = new SessionManager({ maxConcurrentSessions: 2 });
    smallManager.createSession(createOptions());
    smallManager.createSession(createOptions());

    expect(() => smallManager.createSession(createOptions())).toThrow(MaxSessionsExceededError);
    expect(() => smallManager.createSession(createOptions())).toThrow(
      'Maximum concurrent sessions (2) exceeded',
    );
  });

  it('should allow creating sessions again after destroying one', async () => {
    const smallManager = new SessionManager({ maxConcurrentSessions: 2 });
    const session1 = smallManager.createSession(createOptions());
    smallManager.createSession(createOptions());

    expect(() => smallManager.createSession(createOptions())).toThrow(MaxSessionsExceededError);

    await smallManager.destroySession(session1.id);
    const session3 = smallManager.createSession(createOptions());
    expect(session3.id).toMatch(/^sess-/);
    expect(smallManager.activeCount).toBe(2);
  });

  it('should default to max 10 concurrent sessions', () => {
    for (let i = 0; i < 10; i++) {
      manager.createSession(createOptions());
    }
    expect(manager.activeCount).toBe(10);
    expect(() => manager.createSession(createOptions())).toThrow(MaxSessionsExceededError);
  });
});

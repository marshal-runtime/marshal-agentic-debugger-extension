import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DebugSession } from '../../../src/session/session.js';
import { SessionState } from '../../../src/types/session.js';
import { SessionStateError } from '../../../src/session/types.js';
import type { DebugSessionOptions } from '../../../src/session/types.js';
import { SessionEventType } from '../../../src/session/events.js';
import type { SessionStateChangedEvent } from '../../../src/session/events.js';
import type { DapClient } from '../../../src/dap/client.js';
import type { DapEventHandler, DapResponse } from '../../../src/dap/types.js';

function successResponse(command: string, body?: unknown): DapResponse {
  return { seq: 1, type: 'response', request_seq: 1, success: true, command, body };
}

function createMockClient(): DapClient & { triggerEvent: (event: string) => void } {
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
    triggerEvent(event: string): void {
      const list = eventHandlers.get(event);
      if (list) {
        for (const h of list) {
          h({ seq: 0, type: 'event', event, body: {} });
        }
      }
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
  } as unknown as DapClient & { triggerEvent: (event: string) => void };
}

function createSessionOptions(
  client: DapClient,
): DebugSessionOptions {
  return {
    config: {
      sessionId: 'test-session-1',
      program: '/app/main.ts',
      language: 'typescript',
    },
    client,
  };
}

describe('DebugSession', () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let session: DebugSession;

  beforeEach(() => {
    mockClient = createMockClient();
    session = new DebugSession(createSessionOptions(mockClient));
  });

  it('should initialize with idle state', () => {
    expect(session.state).toBe(SessionState.Idle);
    expect(session.id).toBe('test-session-1');
    expect(session.language).toBe('typescript');
  });

  it('should transition to initializing on initialize()', async () => {
    await session.initialize();
    expect(session.state).toBe(SessionState.Initializing);
    expect(mockClient.initialize).toHaveBeenCalledOnce();
  });

  it('should store capabilities from initialize response', async () => {
    await session.initialize();
    expect(session.capabilities).toEqual({ supportsConfigurationDoneRequest: true });
  });

  it('should transition to running after launch()', async () => {
    await session.initialize();
    await session.launch({ program: '/app/main.ts' });
    expect(session.state).toBe(SessionState.Running);
    expect(mockClient.launch).toHaveBeenCalledOnce();
    expect(mockClient.configurationDone).toHaveBeenCalledOnce();
  });

  it('should transition to running after attach()', async () => {
    await session.initialize();
    await session.attach({ port: 9229 });
    expect(session.state).toBe(SessionState.Running);
    expect(mockClient.attach).toHaveBeenCalledOnce();
    expect(mockClient.configurationDone).toHaveBeenCalledOnce();
  });

  it('should transition to terminated on disconnect()', async () => {
    await session.initialize();
    await session.launch({ program: '/app/main.ts' });
    await session.disconnect();
    expect(session.state).toBe(SessionState.Terminated);
    expect(mockClient.disconnect).toHaveBeenCalledOnce();
  });

  it('should transition to terminating on terminate()', async () => {
    await session.initialize();
    await session.launch({ program: '/app/main.ts' });
    await session.terminate();
    expect(session.state).toBe(SessionState.Terminating);
    expect(mockClient.sendRequest).toHaveBeenCalledWith('terminate');
  });

  it('should reject terminate from idle state with SessionStateError', async () => {
    await expect(session.terminate()).rejects.toThrow(SessionStateError);
  });

  it('should reject launch from idle state with SessionStateError', async () => {
    await expect(session.launch({ program: '/app/main.ts' })).rejects.toThrow(SessionStateError);
  });

  it('should handle DAP stopped event by transitioning to stopped', async () => {
    await session.initialize();
    await session.launch({ program: '/app/main.ts' });
    expect(session.state).toBe(SessionState.Running);

    mockClient.triggerEvent('stopped');
    expect(session.state).toBe(SessionState.Stopped);
  });

  it('should handle DAP continued event by transitioning to running', async () => {
    await session.initialize();
    await session.launch({ program: '/app/main.ts' });
    mockClient.triggerEvent('stopped');
    expect(session.state).toBe(SessionState.Stopped);

    mockClient.triggerEvent('continued');
    expect(session.state).toBe(SessionState.Running);
  });

  it('should handle DAP terminated event by transitioning from terminating to terminated', async () => {
    await session.initialize();
    await session.launch({ program: '/app/main.ts' });
    await session.terminate();
    expect(session.state).toBe(SessionState.Terminating);

    mockClient.triggerEvent('terminated');
    expect(session.state).toBe(SessionState.Terminated);
  });

  it('should emit typed StateChanged events on each state change', async () => {
    const events: SessionStateChangedEvent[] = [];
    session.eventEmitter.on(SessionEventType.StateChanged, (event) => {
      events.push(event as SessionStateChangedEvent);
    });

    await session.initialize();
    await session.launch({ program: '/app/main.ts' });

    expect(events).toHaveLength(2);
    expect(events[0]!.previousState).toBe(SessionState.Idle);
    expect(events[0]!.newState).toBe(SessionState.Initializing);
    expect(events[1]!.previousState).toBe(SessionState.Initializing);
    expect(events[1]!.newState).toBe(SessionState.Running);
  });

  it('should return a valid snapshot', () => {
    const snap = session.snapshot();
    expect(snap.sessionId).toBe('test-session-1');
    expect(snap.state).toBe(SessionState.Idle);
    expect(snap.language).toBe('typescript');
    expect(snap.createdAt).toBeDefined();
  });

  it('should allow disconnect from stopped state', async () => {
    await session.initialize();
    await session.launch({ program: '/app/main.ts' });
    mockClient.triggerEvent('stopped');
    expect(session.state).toBe(SessionState.Stopped);

    await session.disconnect();
    expect(session.state).toBe(SessionState.Terminated);
  });

  it('should allow terminate from stopped state', async () => {
    await session.initialize();
    await session.launch({ program: '/app/main.ts' });
    mockClient.triggerEvent('stopped');
    expect(session.state).toBe(SessionState.Stopped);

    await session.terminate();
    expect(session.state).toBe(SessionState.Terminating);
  });
});

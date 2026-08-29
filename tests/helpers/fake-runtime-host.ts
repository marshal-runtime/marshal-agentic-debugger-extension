import type {
  DebuggerBreakpoint,
  DebuggerSnapshot,
  DebuggerSourceFile,
} from '../../src/ui/types.js';
import type {
  DebuggerHostAdapter,
  DebuggerHostEvent,
  DebuggerHostInvocation,
  DebuggerScopeBinding,
} from '../../src/runtime/contracts.js';

function initialSnapshot(): DebuggerSnapshot {
  return {
    state: 'paused',
    statusMessage: 'Paused on entry',
    sources: [
      {
        path: 'Q:\\fixture\\app.ts',
        name: 'app.ts',
        language: 'typescript',
        content: 'const answer = 42;\nconsole.log(answer);',
      },
    ],
    activeSourcePath: 'Q:\\fixture\\app.ts',
    currentLocation: { file: 'Q:\\fixture\\app.ts', line: 1 },
    currentThreadId: 7,
    selectedFrameId: 11,
    breakpoints: [],
    callStack: [
      {
        id: 11,
        name: 'main',
        source: 'Q:\\fixture\\app.ts',
        line: 1,
      },
    ],
    locals: [{ name: 'answer', value: '42', type: 'number' }],
    watches: [],
    console: [],
    events: [],
  };
}

export class FakeRuntimeHost implements DebuggerHostAdapter {
  readonly invocations: DebuggerHostInvocation[] = [];
  readonly disposedScopes: string[] = [];
  private readonly snapshots = new Map<string, DebuggerSnapshot>();
  private readonly listeners = new Map<string, Set<(event: DebuggerHostEvent) => void>>();
  private sequence = 0;

  async invoke(invocation: DebuggerHostInvocation): Promise<unknown> {
    this.invocations.push(invocation);
    if (
      invocation.capability === 'debug.session.launch' ||
      invocation.capability === 'debug.session.attach'
    ) {
      const sessionId = `debug-${++this.sequence}`;
      const snapshot = initialSnapshot();
      this.snapshots.set(sessionId, snapshot);
      return { sessionId, snapshot };
    }
    if (invocation.capability === 'debug.adapter.list') {
      return { adapters: [{ type: 'js-debug', languages: ['typescript', 'javascript'] }] };
    }

    const sessionId = String(invocation.input['sessionId']);
    const current = this.snapshots.get(sessionId);
    if (!current) throw new Error(`Fake session not found: ${sessionId}`);

    let snapshot = current;
    if (invocation.capability === 'debug.execution.continue') {
      snapshot = { ...current, state: 'running', statusMessage: 'Running' };
    } else if (invocation.capability === 'debug.execution.pause') {
      snapshot = { ...current, state: 'paused', statusMessage: 'Paused' };
    } else if (
      invocation.capability === 'debug.session.disconnect' ||
      invocation.capability === 'debug.session.terminate'
    ) {
      snapshot = { ...current, state: 'completed', statusMessage: 'Completed' };
    } else if (invocation.capability === 'debug.breakpoint.set') {
      const breakpoint: DebuggerBreakpoint = {
        id: `bp-${this.sequence}`,
        file: String(invocation.input['file']),
        line: Number(invocation.input['line']),
        enabled: true,
        verified: true,
        condition:
          typeof invocation.input['condition'] === 'string'
            ? invocation.input['condition']
            : undefined,
        origin: invocation.input['origin'] === 'human' ? 'human' : 'agent',
      };
      snapshot = { ...current, breakpoints: [...current.breakpoints, breakpoint] };
    } else if (invocation.capability === 'debug.inspect.evaluate') {
      snapshot = {
        ...current,
        console: [
          ...current.console,
          {
            id: `console-${this.sequence}`,
            expression: String(invocation.input['expression']),
            result: '42',
            type: 'number',
            origin: invocation.input['origin'] === 'human' ? 'human' : 'agent',
            timestamp: '2026-08-16T16:00:00.000Z',
          },
        ],
      };
    }
    this.snapshots.set(sessionId, snapshot);
    return { sessionId, snapshot };
  }

  async readSource(
    _scope: DebuggerScopeBinding,
    debuggerSessionId: string,
    path: string,
  ): Promise<DebuggerSourceFile> {
    const source = this.snapshots
      .get(debuggerSessionId)
      ?.sources.find((candidate) => candidate.path === path);
    if (!source) throw new Error(`Source not found: ${path}`);
    return source;
  }

  subscribe(
    _scope: DebuggerScopeBinding,
    debuggerSessionId: string,
    listener: (event: DebuggerHostEvent) => void,
  ): () => void {
    const listeners = this.listeners.get(debuggerSessionId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(debuggerSessionId, listeners);
    return () => listeners.delete(listener);
  }

  emit(debuggerSessionId: string, patch: Partial<DebuggerSnapshot>, type = 'stopped'): void {
    const current = this.snapshots.get(debuggerSessionId);
    if (!current) throw new Error(`Fake session not found: ${debuggerSessionId}`);
    const snapshot = { ...current, ...patch };
    this.snapshots.set(debuggerSessionId, snapshot);
    const event: DebuggerHostEvent = {
      sessionId: debuggerSessionId,
      type,
      occurredAt: '2026-08-16T16:01:00.000Z',
      snapshot,
    };
    for (const listener of this.listeners.get(debuggerSessionId) ?? []) listener(event);
  }

  async disposeScope(scopeKey: string): Promise<void> {
    this.disposedScopes.push(scopeKey);
  }
}

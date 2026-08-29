import { isSafeExpression } from '../security/eval-safety.js';
import type { DebuggerSnapshot, DebuggerSourceFile } from '../ui/types.js';
import {
  DEBUGGER_CAPABILITY_DESCRIPTORS,
  DEBUGGER_PROVIDER_ID,
  RUNTIME_PROTOCOL_VERSION,
} from './capabilities.js';
import type {
  BoundDebuggerSession,
  CapabilityInvocationResult,
  CapabilityProvider,
  DebuggerBridgeEvent,
  DebuggerExecutionBlock,
  DebuggerHostAdapter,
  DebuggerHostEvent,
  DebuggerScopeBinding,
  InvocationContext,
} from './contracts.js';
import { deriveDebuggerScope } from './scope.js';
import type { MarshalDebuggerUiCoordinator } from './ui-coordinator.js';

const MAX_EVENTS_PER_SESSION = 256;
const COMPLETION_CAPABILITIES = new Set(['debug.session.disconnect', 'debug.session.terminate']);
const UNBOUND_CAPABILITIES = new Set([
  'debug.session.launch',
  'debug.session.attach',
  'debug.session.list',
  'debug.adapter.list',
]);
const COMPLETED_SESSION_CAPABILITIES = new Set([
  'debug.session.get',
  'debug.session.events',
  'debug.source.read',
  'debug.ui.selectExecutionBlock',
]);

interface MutableExecutionBlock {
  id: string;
  capability: string;
  debuggerSessionId?: string;
  scope: DebuggerScopeBinding;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  completedAt?: string;
  error?: { code: string; message: string };
}

interface MutableBoundSession {
  debuggerSessionId: string;
  scope: DebuggerScopeBinding;
  createdAt: string;
  executionBlockIds: string[];
  completed: boolean;
  latestSnapshot?: DebuggerSnapshot;
  events: DebuggerHostEvent[];
  unsubscribe?: () => void;
}

interface ScopeBucket {
  readonly sessions: Map<string, MutableBoundSession>;
  readonly blocks: Map<string, MutableExecutionBlock>;
  readonly listeners: Set<(event: DebuggerBridgeEvent) => void>;
}

function record(value: unknown, label = 'input'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(recordValue: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = recordValue[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = (error as Record<string, unknown>)['code'];
    if (typeof code === 'string') return code;
  }
  return 'DEBUGGER_OPERATION_FAILED';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertSafeExpression(expression: string): void {
  const safety = isSafeExpression(expression, {
    mode: 'safe',
    interfaceContext: 'mcp',
  });
  if (!safety.safe) {
    throw Object.assign(new Error(safety.warning ?? 'Expression is not safe to evaluate.'), {
      code: 'EXPRESSION_NOT_SAFE',
    });
  }
}

function extractDebuggerSessionId(output: unknown): string | undefined {
  if (!output || typeof output !== 'object') return undefined;
  const value = output as Record<string, unknown>;
  const direct = value['sessionId'];
  if (typeof direct === 'string') return direct;
  const session = value['session'];
  if (session && typeof session === 'object') {
    const nested = (session as Record<string, unknown>)['sessionId'];
    if (typeof nested === 'string') return nested;
  }
  return undefined;
}

function extractSnapshot(output: unknown): DebuggerSnapshot | undefined {
  if (!output || typeof output !== 'object') return undefined;
  const value = output as Record<string, unknown>;
  const snapshot = value['snapshot'];
  if (!snapshot || typeof snapshot !== 'object') return undefined;
  return snapshot as DebuggerSnapshot;
}

function freezeBlock(block: MutableExecutionBlock): DebuggerExecutionBlock {
  return Object.freeze({
    id: block.id,
    capability: block.capability,
    ...(block.debuggerSessionId ? { debuggerSessionId: block.debuggerSessionId } : {}),
    scope: block.scope,
    status: block.status,
    createdAt: block.createdAt,
    ...(block.completedAt ? { completedAt: block.completedAt } : {}),
    ...(block.error ? { error: Object.freeze({ ...block.error }) } : {}),
  });
}

function freezeSession(session: MutableBoundSession): BoundDebuggerSession {
  return Object.freeze({
    debuggerSessionId: session.debuggerSessionId,
    scope: session.scope,
    createdAt: session.createdAt,
    executionBlockIds: Object.freeze([...session.executionBlockIds]),
    completed: session.completed,
    ...(session.latestSnapshot ? { latestSnapshot: session.latestSnapshot } : {}),
  });
}

export interface DebuggerRuntimeBridgeOptions {
  readonly host: DebuggerHostAdapter;
  readonly ui?: MarshalDebuggerUiCoordinator;
  readonly now?: () => string;
  readonly disposeHost?: boolean;
}

export class DebuggerRuntimeBridge {
  private readonly scopes = new Map<string, ScopeBucket>();
  private readonly descriptors = new Map(
    DEBUGGER_CAPABILITY_DESCRIPTORS.map((descriptor) => [descriptor.name, descriptor]),
  );
  private readonly now: () => string;
  private disposed = false;
  private receiptSequence = 0;

  constructor(private readonly options: DebuggerRuntimeBridgeOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  createProvider(): CapabilityProvider {
    return Object.freeze({
      id: DEBUGGER_PROVIDER_ID,
      version: '1.0.0',
      list: (_context: InvocationContext) => DEBUGGER_CAPABILITY_DESCRIPTORS,
      get: (name: string, _context: InvocationContext) => this.descriptors.get(name),
      invoke: (name: string, input: unknown, context: InvocationContext) =>
        this.invoke(name, input, context),
    });
  }

  async invoke(
    capability: string,
    input: unknown,
    context: InvocationContext,
  ): Promise<CapabilityInvocationResult> {
    this.assertActive();
    if (!this.descriptors.has(capability)) {
      throw Object.assign(new Error(`Unknown debugger capability: ${capability}`), {
        code: 'CAPABILITY_NOT_SUPPORTED',
      });
    }
    if (context.signal?.aborted) {
      throw Object.assign(new Error('Debugger execution was cancelled before dispatch.'), {
        code: 'CANCELLED',
      });
    }

    const scope = deriveDebuggerScope(context);
    const bucket = this.bucket(scope.scopeKey);
    const values = record(input);
    const block: MutableExecutionBlock = {
      id: scope.executionBlockId,
      capability,
      scope,
      status: 'running',
      createdAt: this.now(),
    };
    bucket.blocks.set(block.id, block);
    this.emit(bucket, {
      type: 'execution-block-created',
      scope,
      executionBlock: freezeBlock(block),
    });

    let debuggerSessionId = text(values, 'sessionId');
    let boundSession: MutableBoundSession | undefined;

    try {
      if (!UNBOUND_CAPABILITIES.has(capability)) {
        if (!debuggerSessionId) {
          throw Object.assign(new Error('sessionId is required for this debugger capability.'), {
            code: 'SESSION_NOT_FOUND',
          });
        }
        boundSession = this.requireSession(bucket, debuggerSessionId, scope);
        if (boundSession.completed && !COMPLETED_SESSION_CAPABILITIES.has(capability)) {
          throw Object.assign(
            new Error(`Debugger session is already completed: ${debuggerSessionId}`),
            { code: 'INVALID_STATE' },
          );
        }
        boundSession.executionBlockIds.push(block.id);
        block.debuggerSessionId = debuggerSessionId;
      }

      if (capability === 'debug.inspect.evaluate') {
        assertSafeExpression(text(values, 'expression') ?? '');
      }
      if (capability === 'debug.watch.manage') {
        const action = text(values, 'action');
        const expression = text(values, 'expression');
        if ((action === 'add' || action === 'evaluate') && expression) {
          assertSafeExpression(expression);
        }
      }

      const output = await this.dispatch(capability, values, scope, bucket, boundSession, context);

      if (capability === 'debug.session.launch' || capability === 'debug.session.attach') {
        debuggerSessionId = extractDebuggerSessionId(output);
        if (!debuggerSessionId) {
          throw Object.assign(
            new Error(`${capability} did not return a debugger session identifier.`),
            { code: 'WORKER_PROTOCOL_ERROR' },
          );
        }
        block.debuggerSessionId = debuggerSessionId;
        boundSession = this.bindSession(bucket, scope, debuggerSessionId, output);
      }

      if (boundSession) {
        const snapshot = extractSnapshot(output);
        if (snapshot) boundSession.latestSnapshot = snapshot;
      }

      let ui: Awaited<ReturnType<MarshalDebuggerUiCoordinator['openOrFocus']>> | undefined;
      if (debuggerSessionId && this.options.ui && context.metadata?.['marshalRuntimeUi'] !== true) {
        ui = await this.options.ui.openOrFocus(scope, debuggerSessionId, context);
      }

      if (boundSession && COMPLETION_CAPABILITIES.has(capability)) {
        boundSession.completed = true;
        boundSession.unsubscribe?.();
        boundSession.unsubscribe = undefined;
        this.emit(bucket, {
          type: 'session-completed',
          scope,
          debuggerSessionId: boundSession.debuggerSessionId,
        });
      }

      block.status = 'completed';
      block.completedAt = this.now();
      this.emit(bucket, {
        type: 'execution-block-completed',
        scope,
        debuggerSessionId,
        executionBlock: freezeBlock(block),
      });

      return Object.freeze({
        output: Object.freeze({
          value: output,
          scope,
          executionBlock: freezeBlock(block),
          ...(ui ? { ui } : {}),
        }),
        provenance: Object.freeze([
          Object.freeze({
            source: DEBUGGER_PROVIDER_ID,
            uri: `runtime://debugger/executions/${encodeURIComponent(block.id)}`,
            retrievedAt: block.completedAt,
            trust: 'authoritative' as const,
          }),
        ]),
        metadata: Object.freeze({
          scopeKey: scope.scopeKey,
          executionBlockId: block.id,
          ...(debuggerSessionId ? { debuggerSessionId } : {}),
        }),
        receipt: Object.freeze({
          id: `debugger-receipt-${++this.receiptSequence}`,
          providerId: DEBUGGER_PROVIDER_ID,
          capability,
          executionBlockId: block.id,
          scopeKey: scope.scopeKey,
          completedAt: block.completedAt,
        }),
      });
    } catch (error) {
      block.status = context.signal?.aborted ? 'cancelled' : 'failed';
      block.completedAt = this.now();
      block.error = {
        code: errorCode(error),
        message: errorMessage(error),
      };
      this.emit(bucket, {
        type: 'execution-block-failed',
        scope,
        debuggerSessionId,
        executionBlock: freezeBlock(block),
      });
      throw error;
    }
  }

  listSessions(scopeKey: string): readonly BoundDebuggerSession[] {
    const bucket = this.scopes.get(scopeKey);
    if (!bucket) return [];
    return Object.freeze([...bucket.sessions.values()].map(freezeSession));
  }

  getSession(scopeKey: string, debuggerSessionId: string): BoundDebuggerSession | undefined {
    const session = this.scopes.get(scopeKey)?.sessions.get(debuggerSessionId);
    return session ? freezeSession(session) : undefined;
  }

  subscribeScope(scopeKey: string, listener: (event: DebuggerBridgeEvent) => void): () => void {
    const bucket = this.bucket(scopeKey);
    bucket.listeners.add(listener);
    return () => bucket.listeners.delete(listener);
  }

  subscribeSession(
    scopeKey: string,
    debuggerSessionId: string,
    listener: (snapshot: DebuggerSnapshot) => void,
  ): () => void {
    return this.subscribeScope(scopeKey, (event) => {
      if (event.debuggerSessionId === debuggerSessionId && event.event?.snapshot) {
        listener(event.event.snapshot);
      }
    });
  }

  async readSource(
    scope: DebuggerScopeBinding,
    debuggerSessionId: string,
    path: string,
  ): Promise<DebuggerSourceFile> {
    this.assertActive();
    const bucket = this.scopes.get(scope.scopeKey);
    if (!bucket) {
      throw Object.assign(new Error('Debugger scope is not active.'), {
        code: 'SCOPE_MISMATCH',
      });
    }
    this.requireSession(bucket, debuggerSessionId, scope);
    if (!this.options.host.readSource) {
      throw Object.assign(new Error('The debugger host does not expose source reads.'), {
        code: 'CAPABILITY_NOT_SUPPORTED',
      });
    }
    return this.options.host.readSource(scope, debuggerSessionId, path);
  }

  async disposeScope(scopeKey: string): Promise<void> {
    const bucket = this.scopes.get(scopeKey);
    if (!bucket) return;
    for (const session of bucket.sessions.values()) session.unsubscribe?.();
    bucket.sessions.clear();
    bucket.blocks.clear();
    bucket.listeners.clear();
    this.scopes.delete(scopeKey);
    await this.options.host.disposeScope?.(scopeKey);
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const scopeKey of [...this.scopes.keys()]) await this.disposeScope(scopeKey);
    if (this.options.disposeHost) await this.options.host.dispose?.();
  }

  private async dispatch(
    capability: string,
    input: Readonly<Record<string, unknown>>,
    scope: DebuggerScopeBinding,
    bucket: ScopeBucket,
    session: MutableBoundSession | undefined,
    context: InvocationContext,
  ): Promise<unknown> {
    if (capability === 'debug.session.list') {
      return {
        sessions: [...bucket.sessions.values()].map(freezeSession),
        count: bucket.sessions.size,
      };
    }
    if (capability === 'debug.session.get' && session) {
      if (session.latestSnapshot) {
        return { session: freezeSession(session), snapshot: session.latestSnapshot };
      }
    }
    if (capability === 'debug.session.events' && session) {
      const after = typeof input['after'] === 'number' ? input['after'] : 0;
      const limit = typeof input['limit'] === 'number' ? Math.min(input['limit'], 256) : 256;
      const events = session.events.slice(after, after + limit);
      return {
        sessionId: session.debuggerSessionId,
        events,
        next: after + events.length,
        truncated: after + events.length < session.events.length,
      };
    }
    if (capability === 'debug.source.read' && session) {
      const path = text(input, 'path');
      if (!path) throw new TypeError('path is required.');
      return this.readSource(scope, session.debuggerSessionId, path);
    }
    if (capability === 'debug.ui.selectExecutionBlock' && session) {
      return {
        selected: true,
        session: freezeSession(session),
        executionBlockId: text(input, 'executionBlockId') ?? scope.executionBlockId,
      };
    }

    return this.options.host.invoke({
      capability,
      input,
      scope,
      signal: context.signal,
    });
  }

  private bindSession(
    bucket: ScopeBucket,
    scope: DebuggerScopeBinding,
    debuggerSessionId: string,
    output: unknown,
  ): MutableBoundSession {
    if (bucket.sessions.has(debuggerSessionId)) {
      throw Object.assign(new Error(`Debugger session already exists: ${debuggerSessionId}`), {
        code: 'INVALID_STATE',
      });
    }
    const session: MutableBoundSession = {
      debuggerSessionId,
      scope,
      createdAt: this.now(),
      executionBlockIds: [scope.executionBlockId],
      completed: false,
      events: [],
      latestSnapshot: extractSnapshot(output),
    };
    if (this.options.host.subscribe) {
      session.unsubscribe = this.options.host.subscribe(scope, debuggerSessionId, (event) =>
        this.onHostEvent(bucket, session, event),
      );
    }
    bucket.sessions.set(debuggerSessionId, session);
    return session;
  }

  private onHostEvent(
    bucket: ScopeBucket,
    session: MutableBoundSession,
    event: DebuggerHostEvent,
  ): void {
    if (event.sessionId !== session.debuggerSessionId) return;
    if (event.snapshot) session.latestSnapshot = event.snapshot;
    session.events.push(event);
    if (session.events.length > MAX_EVENTS_PER_SESSION) session.events.shift();
    if (event.type === 'terminated' || event.type === 'exited' || event.type === 'completed') {
      session.completed = true;
      session.unsubscribe?.();
      session.unsubscribe = undefined;
    }
    this.emit(bucket, {
      type: 'debugger-event',
      scope: session.scope,
      debuggerSessionId: session.debuggerSessionId,
      event,
    });
  }

  private requireSession(
    bucket: ScopeBucket,
    debuggerSessionId: string,
    scope: DebuggerScopeBinding,
  ): MutableBoundSession {
    const session = bucket.sessions.get(debuggerSessionId);
    if (!session) {
      throw Object.assign(
        new Error(`Debugger session is not owned by this Marshal scope: ${debuggerSessionId}`),
        { code: 'SCOPE_MISMATCH' },
      );
    }
    if (session.scope.scopeKey !== scope.scopeKey) {
      throw Object.assign(new Error('Debugger session scope mismatch.'), {
        code: 'SCOPE_MISMATCH',
      });
    }
    return session;
  }

  private bucket(scopeKey: string): ScopeBucket {
    let bucket = this.scopes.get(scopeKey);
    if (!bucket) {
      bucket = {
        sessions: new Map(),
        blocks: new Map(),
        listeners: new Set(),
      };
      this.scopes.set(scopeKey, bucket);
    }
    return bucket;
  }

  private emit(bucket: ScopeBucket, event: DebuggerBridgeEvent): void {
    for (const listener of bucket.listeners) listener(event);
  }

  private assertActive(): void {
    if (this.disposed) {
      throw Object.assign(new Error('Debugger runtime bridge has been disposed.'), {
        code: 'INVALID_STATE',
      });
    }
  }
}

export function unwrapDebuggerBridgeOutput<T>(result: CapabilityInvocationResult): T {
  const envelope = record(result.output, 'bridge output');
  return envelope['value'] as T;
}

export function runtimeProtocolVersion(): string {
  return RUNTIME_PROTOCOL_VERSION;
}

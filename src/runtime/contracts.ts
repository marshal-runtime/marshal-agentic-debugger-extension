import type { DebuggerPanelScope, DebuggerSnapshot, DebuggerSourceFile } from '../ui/types.js';

export interface RuntimeAbortSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
}

export interface RuntimeScope {
  readonly workspaceId?: string;
  readonly workspaceName?: string;
  readonly projectId?: string;
  readonly sessionId?: string;
  readonly threadId?: string;
  readonly chatId?: string;
  readonly parentExecutionId?: string;
  readonly [key: string]: string | undefined;
}

export interface InvocationContext {
  readonly principal: {
    readonly id: string;
    readonly kind: string;
  };
  readonly scope?: RuntimeScope;
  readonly executionId?: string;
  readonly signal?: RuntimeAbortSignal;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CapabilityDescriptor {
  readonly protocolVersion: string;
  readonly name: string;
  readonly version: string;
  readonly title?: string;
  readonly description: string;
  readonly tags?: readonly string[];
  readonly inputSchema?: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly permissions?: readonly {
    readonly permission: string;
    readonly reason?: string;
    readonly risk?: 'low' | 'medium' | 'high' | 'critical';
  }[];
  readonly annotations?: Readonly<Record<string, unknown>>;
}

export interface CapabilityInvocationResult<TOutput = unknown> {
  readonly output: TOutput;
  readonly provenance?: readonly {
    readonly source: string;
    readonly uri?: string;
    readonly retrievedAt?: string;
    readonly trust?: 'unverified' | 'low' | 'medium' | 'high' | 'authoritative';
  }[];
  readonly diagnostics?: readonly {
    readonly level: 'debug' | 'info' | 'warning' | 'error';
    readonly code?: string;
    readonly message: string;
    readonly details?: unknown;
  }[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly receipt?: unknown;
}

export interface CapabilityProvider {
  readonly id: string;
  readonly version?: string;
  list(context: InvocationContext): readonly CapabilityDescriptor[];
  get?(name: string, context: InvocationContext): CapabilityDescriptor | undefined;
  invoke(
    name: string,
    input: unknown,
    context: InvocationContext,
  ): Promise<CapabilityInvocationResult>;
}

export interface RuntimeExecuteRequest {
  readonly protocolVersion: string;
  readonly targetType: 'operation';
  readonly target: string;
  readonly input?: unknown;
  readonly requestId?: string;
}

export interface RuntimeExecResponse<TOutput = unknown> {
  readonly protocolVersion: string;
  readonly status:
    | 'success'
    | 'not_found'
    | 'denied'
    | 'approval_required'
    | 'failed'
    | 'cancelled';
  readonly result?: CapabilityInvocationResult<TOutput>;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  };
  readonly receipt: unknown;
}

export type RuntimeServiceToken<T> = symbol & {
  readonly __type?: (value: T) => T;
};

export interface RuntimeServiceAccessor {
  get<T>(token: RuntimeServiceToken<T>): T;
  tryGet<T>(token: RuntimeServiceToken<T>): T | undefined;
  getAll<T>(token: RuntimeServiceToken<T>): readonly T[];
}

export interface RuntimeServiceContribution<TProvider = unknown> {
  readonly token: RuntimeServiceToken<TProvider>;
  readonly binding: { readonly useValue: TProvider };
  readonly mode?: 'bind' | 'replace' | 'many';
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface DebuggerInvokeInput {
  readonly capability: string;
  readonly input: { readonly [key: string]: JsonValue };
}

export type DebuggerInvokeOutput = CapabilityInvocationResult;

export interface IDebugger {
  invoke(input: DebuggerInvokeInput): Promise<DebuggerInvokeOutput>;
}

export type DebuggerServiceProvider = {
  readonly invoke: (
    input: DebuggerInvokeInput,
    context?: InvocationContext,
  ) => Promise<DebuggerInvokeOutput>;
};

export interface RuntimeExtensionActivationContext {
  readonly manifest: {
    readonly schemaVersion: 1;
    readonly identity: string;
    readonly version: string;
    readonly entrypoint: string;
    readonly moduleFormat: 'commonjs-bundle-v1';
  };
  readonly services?: RuntimeServiceAccessor;
  readonly signal?: RuntimeAbortSignal;
  search(request: Readonly<Record<string, unknown>>, context?: InvocationContext): Promise<unknown>;
  execute<TOutput = unknown>(
    request: RuntimeExecuteRequest,
    context?: InvocationContext,
  ): Promise<RuntimeExecResponse<TOutput>>;
}

export interface RuntimeExtensionUiApplication {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly renderId: string;
  readonly resource: {
    readonly uri: string;
    readonly mimeType?: string;
    readonly text?: string;
    readonly name?: string;
  };
  readonly application: {
    readonly version: '1.0.0';
    readonly presentationModes: readonly ('inline' | 'fullscreen' | 'pip')[];
    readonly actions: readonly Readonly<Record<string, unknown>>[];
    readonly tools: readonly Readonly<Record<string, unknown>>[];
    readonly localState?: {
      readonly scope: 'session' | 'project' | 'workspace';
      readonly schemaVersion: string;
    };
    readonly authoritativeState?: {
      readonly capability: string;
      readonly resourceId: string;
      readonly version: string;
    };
  };
  readonly tags?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface RuntimeExtensionActivation {
  readonly capabilityProviders?: readonly CapabilityProvider[];
  readonly serviceContributions?: readonly RuntimeServiceContribution<any>[];
  readonly uiApplications?: readonly RuntimeExtensionUiApplication[];
  readonly dispose?: () => void | Promise<void>;
}

export interface RuntimeExtensionModule {
  activate(
    context: RuntimeExtensionActivationContext,
  ): RuntimeExtensionActivation | Promise<RuntimeExtensionActivation>;
}

export interface DebuggerScopeBinding {
  readonly chatId: string;
  readonly sessionId: string;
  readonly workspaceName: string;
  readonly executionBlockId: string;
  readonly scopeKey: string;
}

export interface DebuggerExecutionBlock {
  readonly id: string;
  readonly capability: string;
  readonly debuggerSessionId?: string;
  readonly scope: DebuggerScopeBinding;
  readonly status: 'running' | 'completed' | 'failed' | 'cancelled';
  readonly createdAt: string;
  readonly completedAt?: string;
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

export interface BoundDebuggerSession {
  readonly debuggerSessionId: string;
  readonly scope: DebuggerScopeBinding;
  readonly createdAt: string;
  readonly executionBlockIds: readonly string[];
  readonly completed: boolean;
  readonly latestSnapshot?: DebuggerSnapshot;
}

export interface DebuggerHostInvocation {
  readonly capability: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly scope: DebuggerScopeBinding;
  readonly signal?: RuntimeAbortSignal;
}

export interface DebuggerHostEvent {
  readonly sessionId: string;
  readonly type: string;
  readonly occurredAt: string;
  readonly body?: unknown;
  readonly snapshot?: DebuggerSnapshot;
}

export interface DebuggerHostAdapter {
  invoke(invocation: DebuggerHostInvocation): Promise<unknown>;
  readSource?(
    scope: DebuggerScopeBinding,
    debuggerSessionId: string,
    path: string,
  ): Promise<DebuggerSourceFile>;
  subscribe?(
    scope: DebuggerScopeBinding,
    debuggerSessionId: string,
    listener: (event: DebuggerHostEvent) => void,
  ): () => void;
  disposeScope?(scopeKey: string): void | Promise<void>;
  dispose?(): void | Promise<void>;
}

export interface DebuggerBridgeEvent {
  readonly type:
    | 'execution-block-created'
    | 'execution-block-completed'
    | 'execution-block-failed'
    | 'debugger-event'
    | 'session-completed';
  readonly scope: DebuggerScopeBinding;
  readonly executionBlock?: DebuggerExecutionBlock;
  readonly debuggerSessionId?: string;
  readonly event?: DebuggerHostEvent;
}

export interface DebuggerUiOpenResult {
  readonly action: 'opened-and-focused' | 'unavailable';
  readonly instanceId?: string;
}

export interface DebuggerPanelBinding {
  readonly panelScope: DebuggerPanelScope;
  readonly runtimeScope: DebuggerScopeBinding;
  readonly debuggerSessionId: string;
}

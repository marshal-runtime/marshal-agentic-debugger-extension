export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface DebuggerInvokeInput {
  readonly capability: string;
  readonly input: { readonly [key: string]: JsonValue };
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

export interface DebuggerUiOpenResult {
  readonly action: 'opened-and-focused' | 'unavailable';
  readonly instanceId?: string;
}

export interface DebuggerProvenance {
  readonly source: string;
  readonly uri?: string;
  readonly retrievedAt?: string;
  readonly trust?: 'unverified' | 'low' | 'medium' | 'high' | 'authoritative';
}

export interface DebuggerDiagnostic {
  readonly level: 'debug' | 'info' | 'warning' | 'error';
  readonly code?: string;
  readonly message: string;
  readonly details?: unknown;
}

export interface DebuggerReceipt {
  readonly id: string;
  readonly providerId: string;
  readonly capability: string;
  readonly executionBlockId: string;
  readonly scopeKey: string;
  readonly completedAt: string;
}

export interface DebuggerInvokeOutput {
  readonly output: {
    readonly value: unknown;
    readonly scope: DebuggerScopeBinding;
    readonly executionBlock: DebuggerExecutionBlock;
    readonly ui?: DebuggerUiOpenResult;
  };
  readonly provenance?: readonly DebuggerProvenance[];
  readonly diagnostics?: readonly DebuggerDiagnostic[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly receipt?: DebuggerReceipt;
}

export interface IDebugger {
  invoke(input: DebuggerInvokeInput): Promise<DebuggerInvokeOutput>;
}

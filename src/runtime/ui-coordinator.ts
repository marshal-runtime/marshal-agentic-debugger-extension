import {
  DEBUGGER_APPLICATION_ID,
  DEBUGGER_PROVIDER_ID,
  RUNTIME_PROTOCOL_VERSION,
} from './capabilities.js';
import type {
  DebuggerScopeBinding,
  DebuggerUiOpenResult,
  InvocationContext,
  RuntimeExtensionActivationContext,
} from './contracts.js';

export interface DebuggerUiCoordinatorOptions {
  readonly surface?: 'panel' | 'tab';
}

function readInstanceId(value: unknown, depth = 0): string | undefined {
  if (depth > 4) return undefined;
  if (!value || typeof value !== 'object') return undefined;
  const output = value as Record<string, unknown>;
  const direct = output['instanceId'];
  if (typeof direct === 'string') return direct;
  const instance = output['instance'];
  if (instance && typeof instance === 'object') {
    const instanceId = (instance as Record<string, unknown>)['instanceId'];
    if (typeof instanceId === 'string') return instanceId;
  }
  const instances = output['instances'];
  if (Array.isArray(instances)) {
    for (const candidate of instances) {
      const instanceId = readInstanceId(candidate, depth + 1);
      if (instanceId) return instanceId;
    }
  }
  for (const key of ['output', 'result', 'value']) {
    const instanceId = readInstanceId(output[key], depth + 1);
    if (instanceId) return instanceId;
  }
  return undefined;
}

export class MarshalDebuggerUiCoordinator {
  private readonly surface: 'panel' | 'tab';

  constructor(
    private readonly activationContext: RuntimeExtensionActivationContext,
    options: DebuggerUiCoordinatorOptions = {},
  ) {
    this.surface = options.surface ?? 'panel';
  }

  async openOrFocus(
    scope: DebuggerScopeBinding,
    debuggerSessionId: string,
    invocationContext: InvocationContext,
  ): Promise<DebuggerUiOpenResult> {
    const instanceKey = `debugger:${scope.scopeKey}:${debuggerSessionId}`;
    const state = Object.freeze({
      chatId: scope.chatId,
      runtimeSessionId: scope.sessionId,
      debuggerSessionId,
      executionBlockId: scope.executionBlockId,
      scopeKey: scope.scopeKey,
      workspaceName: scope.workspaceName,
    });
    const listed = await this.activationContext.execute(
      {
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
        targetType: 'operation',
        target: 'ui.application.list',
        input: {
          extensionId: DEBUGGER_PROVIDER_ID,
          applicationId: DEBUGGER_APPLICATION_ID,
          surface: this.surface,
        },
        requestId: `${scope.executionBlockId}:list`,
      },
      invocationContext,
    );
    let instanceId =
      listed.status === 'success' ? readInstanceId(listed.result?.output) : undefined;
    if (!instanceId) {
      const open = await this.activationContext.execute(
        {
          protocolVersion: RUNTIME_PROTOCOL_VERSION,
          targetType: 'operation',
          target: 'ui.application.open',
          input: {
            extensionId: DEBUGGER_PROVIDER_ID,
            applicationId: DEBUGGER_APPLICATION_ID,
            surface: this.surface,
            state,
            idempotencyKey: instanceKey,
          },
          requestId: `${scope.executionBlockId}:open`,
        },
        invocationContext,
      );
      if (open.status !== 'success') return { action: 'unavailable' };
      instanceId = readInstanceId(open.result?.output);
    }
    if (!instanceId) return { action: 'unavailable' };

    const update = await this.activationContext.execute(
      {
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
        targetType: 'operation',
        target: 'ui.application.update',
        input: {
          extensionId: DEBUGGER_PROVIDER_ID,
          applicationId: DEBUGGER_APPLICATION_ID,
          instanceId,
          state,
          idempotencyKey: `${instanceKey}:update:${scope.executionBlockId}`,
        },
        requestId: `${scope.executionBlockId}:update`,
      },
      invocationContext,
    );
    if (update.status !== 'success') return { action: 'unavailable' };

    const focus = await this.activationContext.execute(
      {
        protocolVersion: RUNTIME_PROTOCOL_VERSION,
        targetType: 'operation',
        target: 'ui.application.focus',
        input: {
          extensionId: DEBUGGER_PROVIDER_ID,
          applicationId: DEBUGGER_APPLICATION_ID,
          instanceId,
          idempotencyKey: `${instanceKey}:focus:${scope.executionBlockId}`,
        },
        requestId: `${scope.executionBlockId}:focus`,
      },
      invocationContext,
    );
    if (focus.status !== 'success') return { action: 'unavailable' };

    return { action: 'opened-and-focused', instanceId };
  }
}

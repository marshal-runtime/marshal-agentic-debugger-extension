import type { InvocationContext, DebuggerScopeBinding } from './contracts.js';

function requireText(value: string | undefined, label: string): string {
  if (!value?.trim()) {
    throw new Error(`${label} is required in the Marshal invocation context.`);
  }
  return value;
}

function fnv1a(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function stableDebuggerScopeKey(
  workspaceName: string,
  chatId: string,
  sessionId: string,
): string {
  const value = `${workspaceName}\0${chatId}\0${sessionId}`;
  return `debugger-${fnv1a(value, 0x811c9dc5)}${fnv1a(value, 0x9e3779b9)}`;
}

export function deriveDebuggerScope(context: InvocationContext): DebuggerScopeBinding {
  const scope = context.scope;
  const sessionId = requireText(scope?.sessionId, 'scope.sessionId');
  const chatId = scope?.chatId ?? scope?.threadId ?? sessionId;
  const metadataWorkspace = context.metadata?.['marshalWorkspaceName'];
  const workspaceName = requireText(
    typeof metadataWorkspace === 'string'
      ? metadataWorkspace
      : (scope?.workspaceName ?? scope?.workspaceId ?? scope?.projectId),
    'metadata.marshalWorkspaceName',
  );
  const executionBlockId = requireText(context.executionId, 'executionId');

  return Object.freeze({
    chatId,
    sessionId,
    workspaceName,
    executionBlockId,
    scopeKey: stableDebuggerScopeKey(workspaceName, chatId, sessionId),
  });
}

export function isSameDebuggerOwner(
  left: DebuggerScopeBinding,
  right: DebuggerScopeBinding,
): boolean {
  return left.scopeKey === right.scopeKey;
}

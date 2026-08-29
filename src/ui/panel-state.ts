import type { DebuggerPanelScope, DebuggerPanelViewState, DebuggerSnapshot } from './types.js';

const panelStateCache = new Map<string, DebuggerPanelViewState>();

export function debuggerScopeKey(scope: DebuggerPanelScope): string {
  return JSON.stringify([
    scope.scopeKey ??
      [scope.workspaceName ?? 'default', scope.chatId, scope.runtimeSessionId ?? 'default'].join(
        ':',
      ),
    scope.sessionId,
  ]);
}

export function defaultPanelViewState(snapshot?: DebuggerSnapshot | null): DebuggerPanelViewState {
  return {
    activeSourcePath:
      snapshot?.activeSourcePath ??
      snapshot?.currentLocation?.file ??
      snapshot?.sources[0]?.path ??
      null,
    selectedFrameId: snapshot?.selectedFrameId ?? snapshot?.callStack[0]?.id ?? null,
    consoleDraft: '',
    watchDraft: '',
  };
}

export function normalizePanelViewState(
  state: DebuggerPanelViewState,
  snapshot?: DebuggerSnapshot | null,
): DebuggerPanelViewState {
  if (!snapshot) return state;
  const sourceExists = snapshot.sources.some((source) => source.path === state.activeSourcePath);
  const frameExists = snapshot.callStack.some((frame) => frame.id === state.selectedFrameId);
  const fallback = defaultPanelViewState(snapshot);
  return {
    ...state,
    activeSourcePath: sourceExists ? state.activeSourcePath : fallback.activeSourcePath,
    selectedFrameId: frameExists ? state.selectedFrameId : fallback.selectedFrameId,
  };
}

export function readCachedPanelState(
  scope: DebuggerPanelScope,
  snapshot?: DebuggerSnapshot | null,
): DebuggerPanelViewState {
  const cached = panelStateCache.get(debuggerScopeKey(scope));
  return normalizePanelViewState(cached ?? defaultPanelViewState(snapshot), snapshot);
}

export function rememberPanelState(scope: DebuggerPanelScope, state: DebuggerPanelViewState): void {
  panelStateCache.set(debuggerScopeKey(scope), state);
}

export function clearDebuggerPanelStateCache(): void {
  panelStateCache.clear();
}

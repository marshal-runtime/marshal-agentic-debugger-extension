import { createRoot } from 'react-dom/client';
import type { JSX } from 'react';

import { DebuggerPanel } from './DebuggerPanel.js';
import type { DebuggerBridgeAdapter, DebuggerEditor, DebuggerPanelScope } from './types.js';

export interface RuntimeDebuggerUiState {
  readonly chatId: string;
  readonly runtimeSessionId: string;
  readonly debuggerSessionId: string;
  readonly executionBlockId: string;
  readonly scopeKey: string;
  readonly workspaceName?: string;
}

export interface DebuggerRuntimeUiProps {
  readonly state: RuntimeDebuggerUiState;
  readonly adapter: DebuggerBridgeAdapter;
  readonly editor: DebuggerEditor;
  readonly theme?: 'dark' | 'light';
  readonly className?: string;
}

function requiredStateText(value: string, key: string): string {
  if (!value.trim()) throw new TypeError(`Debugger runtime UI state requires ${key}.`);
  return value;
}

export function debuggerPanelScopeFromRuntimeState(
  state: RuntimeDebuggerUiState,
): DebuggerPanelScope {
  return Object.freeze({
    chatId: requiredStateText(state.chatId, 'chatId'),
    sessionId: requiredStateText(state.debuggerSessionId, 'debuggerSessionId'),
    executionBlockId: requiredStateText(state.executionBlockId, 'executionBlockId'),
    runtimeSessionId: requiredStateText(state.runtimeSessionId, 'runtimeSessionId'),
    scopeKey: requiredStateText(state.scopeKey, 'scopeKey'),
    workspaceName: state.workspaceName,
  });
}

export function DebuggerRuntimeUi({
  state,
  adapter,
  editor,
  theme,
  className,
}: DebuggerRuntimeUiProps): JSX.Element {
  return (
    <DebuggerPanel
      scope={debuggerPanelScopeFromRuntimeState(state)}
      adapter={adapter}
      editor={editor}
      theme={theme}
      className={className}
    />
  );
}

export function mountDebuggerRuntimeUi(
  container: HTMLElement,
  props: DebuggerRuntimeUiProps,
): () => void {
  const root = createRoot(container);
  root.render(<DebuggerRuntimeUi {...props} />);
  return () => root.unmount();
}

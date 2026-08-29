import type { ComponentType } from 'react';

export type DebuggerExecutionState = 'paused' | 'running' | 'completed';
export type DebuggerEntryOrigin = 'agent' | 'human';

/**
 * Stable identity for one debugger panel. Runtime ownership is carried by the
 * stable scope key while the execution block identifies the currently focused
 * invocation. Cached navigation remains stable across execution-block changes.
 */
export interface DebuggerPanelScope {
  readonly chatId: string;
  readonly sessionId: string;
  readonly executionBlockId: string;
  readonly runtimeSessionId?: string;
  readonly workspaceName?: string;
  readonly scopeKey?: string;
}

export interface DebuggerSourceFile {
  readonly path: string;
  readonly name?: string;
  readonly language: string;
  readonly content?: string;
}

/**
 * Host-provided source editor contract. The debugger UI deliberately does not
 * know whether Marshal renders this with Monaco or another editor.
 */
export interface DebuggerEditorSourceProps {
  readonly source: DebuggerSourceFile;
  readonly breakpoints: readonly DebuggerBreakpoint[];
  readonly currentLine?: number;
  readonly theme: 'dark' | 'light';
  readonly onToggleBreakpoint: (line: number) => void;
}

export interface DebuggerEditor {
  readonly id: string;
  readonly SourceEditor: ComponentType<DebuggerEditorSourceProps>;
}

export interface DebuggerSourceLocation {
  readonly file: string;
  readonly line: number;
  readonly column?: number;
}

export interface DebuggerBreakpoint {
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly column?: number;
  readonly enabled: boolean;
  readonly verified: boolean;
  readonly condition?: string;
  readonly hitCondition?: string;
  readonly logMessage?: string;
  readonly origin: DebuggerEntryOrigin;
}

export interface DebuggerStackFrame {
  readonly id: number;
  readonly name: string;
  readonly source?: string;
  readonly line?: number;
  readonly column?: number;
}

export interface DebuggerVariable {
  readonly name: string;
  readonly value: string;
  readonly type?: string;
  readonly variablesReference?: number;
  readonly redacted?: boolean;
  readonly children?: readonly DebuggerVariable[];
}

export interface DebuggerWatchValue {
  readonly id: string;
  readonly expression: string;
  readonly value?: string;
  readonly type?: string;
  readonly error?: string;
  readonly origin: DebuggerEntryOrigin;
}

export interface DebuggerConsoleEntry {
  readonly id: string;
  readonly expression: string;
  readonly result?: string;
  readonly type?: string;
  readonly error?: string;
  readonly origin: DebuggerEntryOrigin;
  readonly timestamp: string;
}

export interface DebuggerOutputEvent {
  readonly id: string;
  readonly category: 'debugger' | 'stdout' | 'stderr' | 'telemetry';
  readonly message: string;
  readonly timestamp: string;
}

export interface DebuggerSnapshot {
  readonly state: DebuggerExecutionState;
  readonly statusMessage?: string;
  readonly sources: readonly DebuggerSourceFile[];
  readonly activeSourcePath?: string;
  readonly currentLocation?: DebuggerSourceLocation;
  readonly currentThreadId?: number;
  readonly selectedFrameId?: number;
  readonly breakpoints: readonly DebuggerBreakpoint[];
  readonly callStack: readonly DebuggerStackFrame[];
  readonly locals: readonly DebuggerVariable[];
  readonly watches: readonly DebuggerWatchValue[];
  readonly console: readonly DebuggerConsoleEntry[];
  readonly events: readonly DebuggerOutputEvent[];
}

export interface DebuggerPanelViewState {
  readonly activeSourcePath: string | null;
  readonly selectedFrameId: number | null;
  readonly consoleDraft: string;
  readonly watchDraft: string;
}

export type DebuggerCommand =
  | { readonly type: 'continue'; readonly threadId?: number }
  | { readonly type: 'pause'; readonly threadId?: number }
  | { readonly type: 'step-over'; readonly threadId?: number }
  | { readonly type: 'step-into'; readonly threadId?: number }
  | { readonly type: 'step-out'; readonly threadId?: number }
  | { readonly type: 'select-frame'; readonly frameId: number }
  | {
      readonly type: 'set-breakpoint';
      readonly file: string;
      readonly line: number;
      readonly origin: 'human';
    }
  | {
      readonly type: 'toggle-breakpoint';
      readonly breakpointId: string;
      readonly enabled: boolean;
    }
  | {
      readonly type: 'update-breakpoint';
      readonly breakpointId: string;
      readonly condition?: string;
    }
  | { readonly type: 'remove-breakpoint'; readonly breakpointId: string }
  | {
      readonly type: 'add-watch';
      readonly expression: string;
      readonly frameId?: number;
      readonly origin: 'human';
    }
  | { readonly type: 'remove-watch'; readonly watchId: string }
  | {
      readonly type: 'evaluate';
      readonly expression: string;
      readonly frameId?: number;
      readonly origin: 'human';
    };

/**
 * Host-owned bridge boundary. The UI intentionally knows nothing about
 * Electron, MCP, DAP transports, or Marshal runtime activation.
 */
export interface DebuggerBridgeAdapter {
  getSnapshot(scope: DebuggerPanelScope): Promise<DebuggerSnapshot>;
  readSource(scope: DebuggerPanelScope, path: string): Promise<DebuggerSourceFile>;
  dispatch(scope: DebuggerPanelScope, command: DebuggerCommand): Promise<void>;
  subscribe(scope: DebuggerPanelScope, listener: (snapshot: DebuggerSnapshot) => void): () => void;
  loadPanelState?(scope: DebuggerPanelScope): Promise<DebuggerPanelViewState | null>;
  savePanelState?(scope: DebuggerPanelScope, state: DebuggerPanelViewState): Promise<void>;
}

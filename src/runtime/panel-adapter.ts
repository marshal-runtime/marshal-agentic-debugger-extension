import type {
  DebuggerBreakpoint,
  DebuggerBridgeAdapter,
  DebuggerCommand,
  DebuggerPanelScope,
  DebuggerPanelViewState,
  DebuggerSnapshot,
} from '../ui/types.js';
import { debuggerScopeKey } from '../ui/panel-state.js';
import { DebuggerRuntimeBridge, unwrapDebuggerBridgeOutput } from './bridge.js';
import type { DebuggerPanelBinding, InvocationContext } from './contracts.js';

function contextFor(binding: DebuggerPanelBinding, executionBlockId: string): InvocationContext {
  return {
    principal: { id: 'marshal-debugger-ui', kind: 'user' },
    executionId: executionBlockId,
    scope: {
      sessionId: binding.runtimeScope.sessionId,
      chatId: binding.runtimeScope.chatId,
    },
    metadata: { marshalWorkspaceName: binding.runtimeScope.workspaceName },
  };
}

function breakpointById(snapshot: DebuggerSnapshot, breakpointId: string): DebuggerBreakpoint {
  const breakpoint = snapshot.breakpoints.find((candidate) => candidate.id === breakpointId);
  if (!breakpoint) throw new Error(`Breakpoint not found: ${breakpointId}`);
  return breakpoint;
}

function snapshotFromValue(value: unknown): DebuggerSnapshot {
  if (!value || typeof value !== 'object') {
    throw new Error('Debugger session did not return a snapshot.');
  }
  const snapshot = (value as Record<string, unknown>)['snapshot'];
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Debugger session did not return a snapshot.');
  }
  return snapshot as DebuggerSnapshot;
}

export function createDebuggerPanelBridgeAdapter(
  bridge: DebuggerRuntimeBridge,
  binding: DebuggerPanelBinding,
): DebuggerBridgeAdapter {
  const panelState = new Map<string, DebuggerPanelViewState>();
  let latestSnapshot: DebuggerSnapshot | undefined;
  let executionSequence = 0;
  const nextContext = (): InvocationContext =>
    contextFor(binding, `${binding.panelScope.executionBlockId}:ui:${++executionSequence}`);

  const getSnapshot = async (): Promise<DebuggerSnapshot> => {
    const result = await bridge.invoke(
      'debug.session.get',
      { sessionId: binding.debuggerSessionId },
      nextContext(),
    );
    latestSnapshot = snapshotFromValue(unwrapDebuggerBridgeOutput(result));
    return latestSnapshot;
  };

  const invoke = async (
    capability: string,
    input: Readonly<Record<string, unknown>>,
  ): Promise<void> => {
    await bridge.invoke(
      capability,
      { sessionId: binding.debuggerSessionId, ...input },
      nextContext(),
    );
    latestSnapshot = await getSnapshot();
  };

  const dispatch = async (_scope: DebuggerPanelScope, command: DebuggerCommand): Promise<void> => {
    const snapshot = latestSnapshot ?? (await getSnapshot());
    switch (command.type) {
      case 'continue':
        return invoke('debug.execution.continue', { threadId: command.threadId });
      case 'pause':
        return invoke('debug.execution.pause', { threadId: command.threadId });
      case 'step-over':
        return invoke('debug.execution.stepOver', { threadId: command.threadId });
      case 'step-into':
        return invoke('debug.execution.stepInto', { threadId: command.threadId });
      case 'step-out':
        return invoke('debug.execution.stepOut', { threadId: command.threadId });
      case 'select-frame':
        latestSnapshot = { ...snapshot, selectedFrameId: command.frameId };
        return;
      case 'set-breakpoint':
        return invoke('debug.breakpoint.set', {
          file: command.file,
          line: command.line,
          origin: command.origin,
        });
      case 'toggle-breakpoint': {
        const breakpoint = breakpointById(snapshot, command.breakpointId);
        return invoke(command.enabled ? 'debug.breakpoint.enable' : 'debug.breakpoint.disable', {
          breakpointId: breakpoint.id,
          file: breakpoint.file,
          line: breakpoint.line,
        });
      }
      case 'update-breakpoint': {
        const breakpoint = breakpointById(snapshot, command.breakpointId);
        return invoke('debug.breakpoint.set', {
          file: breakpoint.file,
          line: breakpoint.line,
          condition: command.condition,
          origin: breakpoint.origin,
        });
      }
      case 'remove-breakpoint': {
        const breakpoint = breakpointById(snapshot, command.breakpointId);
        return invoke('debug.breakpoint.remove', {
          breakpointId: breakpoint.id,
          file: breakpoint.file,
          line: breakpoint.line,
        });
      }
      case 'add-watch':
        return invoke('debug.watch.manage', {
          action: 'add',
          expression: command.expression,
          frameId: command.frameId,
          origin: command.origin,
        });
      case 'remove-watch': {
        const watch = snapshot.watches.find((candidate) => candidate.id === command.watchId);
        if (!watch) throw new Error(`Watch not found: ${command.watchId}`);
        return invoke('debug.watch.manage', {
          action: 'remove',
          watchId: command.watchId,
          expression: watch.expression,
        });
      }
      case 'evaluate':
        return invoke('debug.inspect.evaluate', {
          expression: command.expression,
          frameId: command.frameId,
          context: 'repl',
          origin: command.origin,
        });
    }
  };

  return {
    async getSnapshot() {
      return getSnapshot();
    },
    async readSource(_scope, path) {
      return bridge.readSource(binding.runtimeScope, binding.debuggerSessionId, path);
    },
    dispatch,
    subscribe(_scope, listener) {
      return bridge.subscribeSession(
        binding.runtimeScope.scopeKey,
        binding.debuggerSessionId,
        (snapshot) => {
          latestSnapshot = snapshot;
          listener(snapshot);
        },
      );
    },
    async loadPanelState(scope) {
      return panelState.get(debuggerScopeKey(scope)) ?? null;
    },
    async savePanelState(scope, state) {
      panelState.set(debuggerScopeKey(scope), state);
    },
  };
}

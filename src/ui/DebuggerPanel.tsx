import { useCallback, useEffect, useMemo, useState, type FormEvent, type JSX } from 'react';

import {
  debuggerScopeKey,
  normalizePanelViewState,
  readCachedPanelState,
  rememberPanelState,
} from './panel-state.js';
import type {
  DebuggerBreakpoint,
  DebuggerBridgeAdapter,
  DebuggerCommand,
  DebuggerEditor,
  DebuggerPanelScope,
  DebuggerPanelViewState,
  DebuggerSnapshot,
  DebuggerSourceFile,
  DebuggerStackFrame,
  DebuggerVariable,
} from './types.js';

import './debugger-panel.css';

export interface DebuggerPanelProps {
  readonly scope: DebuggerPanelScope;
  readonly adapter: DebuggerBridgeAdapter;
  readonly editor: DebuggerEditor;
  readonly initialSnapshot?: DebuggerSnapshot;
  readonly theme?: 'dark' | 'light';
  readonly className?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sourceName(source: DebuggerSourceFile | string): string {
  const path = typeof source === 'string' ? source : (source.name ?? source.path);
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function timestampLabel(timestamp: string): string {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? timestamp : parsed.toLocaleTimeString();
}

function VariableTree({
  variables,
}: {
  readonly variables: readonly DebuggerVariable[];
}): JSX.Element {
  if (variables.length === 0) return <p className="adb-empty">No locals available.</p>;
  return (
    <ul className="adb-variable-tree">
      {variables.map((variable, index) => (
        <li key={`${variable.name}:${index}`}>
          {variable.children?.length ? (
            <details>
              <summary>
                <VariableValue variable={variable} />
              </summary>
              <VariableTree variables={variable.children} />
            </details>
          ) : (
            <VariableValue variable={variable} />
          )}
        </li>
      ))}
    </ul>
  );
}

function VariableValue({ variable }: { readonly variable: DebuggerVariable }): JSX.Element {
  return (
    <span className="adb-variable">
      <span className="adb-variable-name">{variable.name}</span>
      <span aria-hidden="true"> = </span>
      <span
        className={variable.redacted ? 'adb-variable-value adb-redacted' : 'adb-variable-value'}
      >
        {variable.value}
      </span>
      {variable.type && <span className="adb-variable-type">{variable.type}</span>}
    </span>
  );
}

function BreakpointRow({
  breakpoint,
  busy,
  onCommand,
}: {
  readonly breakpoint: DebuggerBreakpoint;
  readonly busy: boolean;
  readonly onCommand: (command: DebuggerCommand) => Promise<void>;
}): JSX.Element {
  const [condition, setCondition] = useState(breakpoint.condition ?? '');
  useEffect(() => setCondition(breakpoint.condition ?? ''), [breakpoint.condition]);
  const label = `${sourceName(breakpoint.file)}:${breakpoint.line}`;

  return (
    <li className="adb-breakpoint-row">
      <div className="adb-row-heading">
        <label className="adb-checkbox-label">
          <input
            type="checkbox"
            checked={breakpoint.enabled}
            disabled={busy}
            aria-label={`Enable breakpoint ${label}`}
            onChange={(event) =>
              void onCommand({
                type: 'toggle-breakpoint',
                breakpointId: breakpoint.id,
                enabled: event.currentTarget.checked,
              })
            }
          />
          <span>{label}</span>
        </label>
        <span className={`adb-origin adb-origin-${breakpoint.origin}`}>{breakpoint.origin}</span>
      </div>
      <div className="adb-breakpoint-editor">
        <input
          value={condition}
          aria-label={`Condition for breakpoint ${label}`}
          placeholder="Condition"
          onChange={(event) => setCondition(event.currentTarget.value)}
        />
        <button
          type="button"
          className="adb-button adb-button-subtle"
          disabled={busy || condition === (breakpoint.condition ?? '')}
          onClick={() =>
            void onCommand({
              type: 'update-breakpoint',
              breakpointId: breakpoint.id,
              condition: condition.trim() || undefined,
            })
          }
        >
          Save
        </button>
        <button
          type="button"
          className="adb-button adb-button-danger"
          disabled={busy}
          aria-label={`Remove breakpoint ${label}`}
          onClick={() => void onCommand({ type: 'remove-breakpoint', breakpointId: breakpoint.id })}
        >
          Remove
        </button>
      </div>
      {!breakpoint.verified && <span className="adb-unverified">Unverified</span>}
    </li>
  );
}

function DebuggerPanelScope({
  scope,
  adapter,
  editor,
  initialSnapshot,
  theme = 'dark',
  className,
}: DebuggerPanelProps): JSX.Element {
  const scopeId = debuggerScopeKey(scope);
  const [snapshot, setSnapshot] = useState<DebuggerSnapshot | null>(initialSnapshot ?? null);
  const [viewState, setViewState] = useState<DebuggerPanelViewState>(() =>
    readCachedPanelState(scope, initialSnapshot),
  );
  const [loadedSources, setLoadedSources] = useState<ReadonlyMap<string, DebuggerSourceFile>>(
    () => new Map(),
  );
  const [loading, setLoading] = useState(!initialSnapshot);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingCommand, setPendingCommand] = useState<DebuggerCommand['type'] | null>(null);

  useEffect(() => {
    setSnapshot(initialSnapshot ?? null);
    setLoading(!initialSnapshot);
  }, [initialSnapshot, scopeId]);

  useEffect(() => {
    let active = true;
    setViewState(readCachedPanelState(scope, initialSnapshot));
    if (!adapter.loadPanelState) {
      setHydrated(true);
      return () => {
        active = false;
      };
    }
    const load = async (): Promise<void> => {
      try {
        const persisted = await adapter.loadPanelState?.(scope);
        if (active && persisted) {
          setViewState(normalizePanelViewState(persisted, initialSnapshot));
        }
      } catch (loadError) {
        if (active) setError(`Unable to restore debugger panel state: ${errorMessage(loadError)}`);
      }
      if (active) setHydrated(true);
    };
    void load();
    return () => {
      active = false;
    };
  }, [adapter, initialSnapshot, scopeId]);

  useEffect(() => {
    let active = true;
    let unsubscribe: () => void = () => undefined;
    try {
      unsubscribe = adapter.subscribe(scope, (nextSnapshot) => {
        if (!active) return;
        setSnapshot(nextSnapshot);
        setLoading(false);
        setError(null);
      });
    } catch (subscribeError) {
      setError(`Unable to subscribe to debugger updates: ${errorMessage(subscribeError)}`);
    }

    if (!initialSnapshot) {
      void adapter
        .getSnapshot(scope)
        .then((nextSnapshot) => {
          if (!active) return;
          setSnapshot(nextSnapshot);
          setLoading(false);
        })
        .catch((snapshotError: unknown) => {
          if (!active) return;
          setLoading(false);
          setError(`Unable to load debugger state: ${errorMessage(snapshotError)}`);
        });
    }

    return () => {
      active = false;
      unsubscribe();
    };
  }, [adapter, initialSnapshot, scopeId]);

  useEffect(() => {
    if (!snapshot) return;
    setViewState((current) => normalizePanelViewState(current, snapshot));
  }, [snapshot]);

  useEffect(() => {
    if (!hydrated) return;
    rememberPanelState(scope, viewState);
    if (!adapter.savePanelState) return;
    void adapter.savePanelState(scope, viewState).catch((saveError: unknown) => {
      setError(`Unable to save debugger panel state: ${errorMessage(saveError)}`);
    });
  }, [adapter, hydrated, scopeId, viewState]);

  const activeSourcePath =
    viewState.activeSourcePath ??
    snapshot?.activeSourcePath ??
    snapshot?.currentLocation?.file ??
    snapshot?.sources[0]?.path ??
    null;
  const sourceDescriptor = snapshot?.sources.find((source) => source.path === activeSourcePath);
  const activeSource =
    (activeSourcePath ? loadedSources.get(activeSourcePath) : undefined) ?? sourceDescriptor;

  useEffect(() => {
    if (
      !sourceDescriptor ||
      sourceDescriptor.content !== undefined ||
      loadedSources.has(sourceDescriptor.path)
    ) {
      return;
    }
    let active = true;
    void adapter
      .readSource(scope, sourceDescriptor.path)
      .then((source) => {
        if (!active) return;
        setLoadedSources((current) => {
          const next = new Map(current);
          next.set(source.path, source);
          return next;
        });
      })
      .catch((sourceError: unknown) => {
        if (active)
          setError(`Unable to read ${sourceDescriptor.path}: ${errorMessage(sourceError)}`);
      });
    return () => {
      active = false;
    };
  }, [adapter, loadedSources, scopeId, sourceDescriptor]);

  const runCommand = useCallback(
    async (command: DebuggerCommand): Promise<void> => {
      setError(null);
      setPendingCommand(command.type);
      try {
        await adapter.dispatch(scope, command);
      } catch (commandError) {
        setError(`Debugger command failed: ${errorMessage(commandError)}`);
      } finally {
        setPendingCommand(null);
      }
    },
    [adapter, scopeId],
  );

  const threadCommand = useCallback(
    (type: 'continue' | 'pause' | 'step-over' | 'step-into' | 'step-out') => {
      const command = snapshot?.currentThreadId
        ? { type, threadId: snapshot.currentThreadId }
        : { type };
      void runCommand(command);
    },
    [runCommand, snapshot?.currentThreadId],
  );

  const selectedFrameId =
    viewState.selectedFrameId ?? snapshot?.selectedFrameId ?? snapshot?.callStack[0]?.id;
  const currentFileBreakpoints = useMemo(
    () => snapshot?.breakpoints.filter((breakpoint) => breakpoint.file === activeSourcePath) ?? [],
    [activeSourcePath, snapshot?.breakpoints],
  );
  const currentLine =
    snapshot?.currentLocation?.file === activeSourcePath
      ? snapshot.currentLocation.line
      : undefined;
  const isPaused = snapshot?.state === 'paused';
  const isRunning = snapshot?.state === 'running';
  const isCompleted = snapshot?.state === 'completed';
  const busy = pendingCommand !== null;
  const SourceEditor = editor.SourceEditor;

  const toggleEditorBreakpoint = useCallback(
    (line: number) => {
      if (!activeSourcePath || !snapshot) return;
      const existing = snapshot.breakpoints.find(
        (breakpoint) => breakpoint.file === activeSourcePath && breakpoint.line === line,
      );
      if (existing) {
        void runCommand({
          type: 'toggle-breakpoint',
          breakpointId: existing.id,
          enabled: !existing.enabled,
        });
      } else {
        void runCommand({
          type: 'set-breakpoint',
          file: activeSourcePath,
          line,
          origin: 'human',
        });
      }
    },
    [activeSourcePath, runCommand, snapshot],
  );

  const selectFrame = (frame: DebuggerStackFrame): void => {
    setViewState((current) => ({
      ...current,
      selectedFrameId: frame.id,
      activeSourcePath: frame.source ?? current.activeSourcePath,
    }));
    void runCommand({ type: 'select-frame', frameId: frame.id });
  };

  const submitWatch = (event: FormEvent): void => {
    event.preventDefault();
    const expression = viewState.watchDraft.trim();
    if (!expression) return;
    void runCommand({
      type: 'add-watch',
      expression,
      frameId: selectedFrameId,
      origin: 'human',
    });
    setViewState((current) => ({ ...current, watchDraft: '' }));
  };

  const submitExpression = (event: FormEvent): void => {
    event.preventDefault();
    const expression = viewState.consoleDraft.trim();
    if (!expression) return;
    void runCommand({
      type: 'evaluate',
      expression,
      frameId: selectedFrameId,
      origin: 'human',
    });
    setViewState((current) => ({ ...current, consoleDraft: '' }));
  };

  if (loading && !snapshot) {
    return (
      <div className={`adb-debugger-panel adb-theme-${theme} ${className ?? ''}`} role="status">
        Loading debugger...
      </div>
    );
  }

  return (
    <section
      className={`adb-debugger-panel adb-theme-${theme} ${className ?? ''}`}
      aria-label="Debugger panel"
      data-debugger-scope={scopeId}
    >
      <header className="adb-toolbar">
        <div className="adb-title-group">
          <h2>Debugger</h2>
          <span className={`adb-status adb-status-${snapshot?.state ?? 'completed'}`}>
            {snapshot?.state ?? 'completed'}
          </span>
          {snapshot?.statusMessage && (
            <span className="adb-status-message">{snapshot.statusMessage}</span>
          )}
        </div>
        <div className="adb-controls" aria-label="Execution controls">
          <button
            type="button"
            className="adb-button adb-button-primary"
            disabled={!isPaused || busy}
            onClick={() => threadCommand('continue')}
          >
            Continue
          </button>
          <button
            type="button"
            className="adb-button"
            disabled={!isRunning || busy}
            onClick={() => threadCommand('pause')}
          >
            Pause
          </button>
          {(['step-over', 'step-into', 'step-out'] as const).map((type) => (
            <button
              key={type}
              type="button"
              className="adb-button"
              disabled={!isPaused || busy}
              onClick={() => threadCommand(type)}
            >
              {type === 'step-over' ? 'Step over' : type === 'step-into' ? 'Step into' : 'Step out'}
            </button>
          ))}
          {isCompleted && <span className="adb-completed-note">Execution completed</span>}
        </div>
      </header>

      {error && (
        <div className="adb-error" role="alert">
          {error}
          <button type="button" className="adb-error-dismiss" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="adb-workbench">
        <nav className="adb-sources" aria-label="Source files">
          <h3>Sources</h3>
          {snapshot?.sources.length ? (
            <ul>
              {snapshot.sources.map((source) => {
                const breakpointCount =
                  snapshot.breakpoints.filter((breakpoint) => breakpoint.file === source.path)
                    .length ?? 0;
                return (
                  <li key={source.path}>
                    <button
                      type="button"
                      className={source.path === activeSourcePath ? 'adb-source-active' : ''}
                      aria-current={source.path === activeSourcePath ? 'page' : undefined}
                      title={source.path}
                      onClick={() =>
                        setViewState((current) => ({
                          ...current,
                          activeSourcePath: source.path,
                        }))
                      }
                    >
                      <span>{sourceName(source)}</span>
                      {breakpointCount > 0 && <span className="adb-count">{breakpointCount}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="adb-empty">No source files loaded.</p>
          )}
        </nav>

        <main className="adb-editor-region">
          <div className="adb-file-bar">
            <span>{activeSource ? sourceName(activeSource) : 'No source selected'}</span>
            {currentLine !== undefined && <span>Paused at line {currentLine}</span>}
          </div>
          <div className="adb-editor-shell">
            {activeSource ? (
              <SourceEditor
                source={activeSource}
                breakpoints={currentFileBreakpoints}
                currentLine={currentLine}
                theme={theme}
                onToggleBreakpoint={toggleEditorBreakpoint}
              />
            ) : (
              <div className="adb-editor-empty">Select a source file to inspect it.</div>
            )}
          </div>
        </main>

        <aside className="adb-inspector" aria-label="Debugger inspection">
          <details open>
            <summary>Call stack</summary>
            {snapshot?.callStack.length ? (
              <ol className="adb-stack">
                {snapshot.callStack.map((frame) => (
                  <li key={frame.id}>
                    <button
                      type="button"
                      className={frame.id === selectedFrameId ? 'adb-frame-active' : ''}
                      aria-pressed={frame.id === selectedFrameId}
                      onClick={() => selectFrame(frame)}
                    >
                      <strong>{frame.name}</strong>
                      <span>
                        {frame.source ? sourceName(frame.source) : 'Unknown source'}
                        {frame.line ? `:${frame.line}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="adb-empty">Call stack unavailable while running.</p>
            )}
          </details>

          <details open>
            <summary>Locals</summary>
            <VariableTree variables={snapshot?.locals ?? []} />
          </details>

          <details open>
            <summary>Watch</summary>
            <form className="adb-inline-form" onSubmit={submitWatch}>
              <input
                value={viewState.watchDraft}
                aria-label="Watch expression"
                placeholder="Add expression"
                disabled={isCompleted}
                onChange={(event) => {
                  const watchDraft = event.currentTarget.value;
                  setViewState((current) => ({
                    ...current,
                    watchDraft,
                  }));
                }}
              />
              <button
                type="submit"
                className="adb-button adb-button-subtle"
                disabled={busy || isCompleted || !viewState.watchDraft.trim()}
              >
                Add
              </button>
            </form>
            <ul className="adb-watch-list">
              {snapshot?.watches.map((watch) => (
                <li key={watch.id}>
                  <div>
                    <span className={`adb-origin adb-origin-${watch.origin}`}>{watch.origin}</span>
                    <code>{watch.expression}</code>
                  </div>
                  <span className={watch.error ? 'adb-value-error' : 'adb-watch-value'}>
                    {watch.error ?? watch.value ?? 'Not evaluated'}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove watch ${watch.expression}`}
                    disabled={busy}
                    onClick={() => void runCommand({ type: 'remove-watch', watchId: watch.id })}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </details>

          <details open>
            <summary>Breakpoints</summary>
            {snapshot?.breakpoints.length ? (
              <ul className="adb-breakpoint-list">
                {snapshot.breakpoints.map((breakpoint) => (
                  <BreakpointRow
                    key={breakpoint.id}
                    breakpoint={breakpoint}
                    busy={busy}
                    onCommand={runCommand}
                  />
                ))}
              </ul>
            ) : (
              <p className="adb-empty">Click the editor gutter to add a breakpoint.</p>
            )}
          </details>
        </aside>
      </div>

      <div className="adb-bottom">
        <section className="adb-console" aria-labelledby="adb-console-title">
          <h3 id="adb-console-title">Debug console</h3>
          <div className="adb-console-output" aria-live="polite">
            {snapshot?.console.map((entry) => (
              <div className="adb-console-entry" key={entry.id}>
                <span className={`adb-origin adb-origin-${entry.origin}`}>{entry.origin}</span>
                <code>{entry.expression}</code>
                <span className={entry.error ? 'adb-value-error' : ''}>
                  {entry.error ?? entry.result ?? ''}
                </span>
                <time dateTime={entry.timestamp}>{timestampLabel(entry.timestamp)}</time>
              </div>
            ))}
          </div>
          <form className="adb-console-form" onSubmit={submitExpression}>
            <span aria-hidden="true">&gt;</span>
            <input
              value={viewState.consoleDraft}
              aria-label="Debug console expression"
              placeholder={isPaused ? 'Evaluate in selected frame' : 'Pause to evaluate'}
              disabled={!isPaused}
              onChange={(event) => {
                const consoleDraft = event.currentTarget.value;
                setViewState((current) => ({
                  ...current,
                  consoleDraft,
                }));
              }}
            />
            <button
              type="submit"
              className="adb-button adb-button-primary"
              disabled={busy || !isPaused || !viewState.consoleDraft.trim()}
            >
              Evaluate
            </button>
          </form>
        </section>

        <section className="adb-events" aria-labelledby="adb-events-title">
          <h3 id="adb-events-title">Debugger output</h3>
          <ol>
            {snapshot?.events.map((event) => (
              <li key={event.id} className={`adb-event-${event.category}`}>
                <time dateTime={event.timestamp}>{timestampLabel(event.timestamp)}</time>
                <span>{event.category}</span>
                <pre>{event.message}</pre>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </section>
  );
}

export function DebuggerPanel(props: DebuggerPanelProps): JSX.Element {
  return <DebuggerPanelScope key={debuggerScopeKey(props.scope)} {...props} />;
}

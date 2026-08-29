// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DebuggerPanel,
  clearDebuggerPanelStateCache,
  type DebuggerBridgeAdapter,
  type DebuggerEditor,
  type DebuggerPanelScope,
  type DebuggerSnapshot,
} from '../../../src/ui/index.js';

const scope: DebuggerPanelScope = {
  chatId: 'chat-1',
  sessionId: 'session-1',
  executionBlockId: 'execution-1',
};

const editor: DebuggerEditor = {
  id: 'test-editor',
  SourceEditor: ({ source }) => <pre data-testid="monaco-editor">{source.content}</pre>,
};

function snapshot(): DebuggerSnapshot {
  return {
    state: 'paused',
    statusMessage: 'Paused on breakpoint',
    sources: [
      {
        path: 'Q:\\src\\app.ts',
        name: 'app.ts',
        language: 'typescript',
        content: 'const total = items.length;\nreturn total;',
      },
      {
        path: 'Q:\\src\\helpers.ts',
        name: 'helpers.ts',
        language: 'typescript',
        content: 'export const twice = (value: number) => value * 2;',
      },
    ],
    activeSourcePath: 'Q:\\src\\app.ts',
    currentLocation: { file: 'Q:\\src\\app.ts', line: 2 },
    currentThreadId: 7,
    selectedFrameId: 101,
    breakpoints: [
      {
        id: 'bp-agent',
        file: 'Q:\\src\\app.ts',
        line: 2,
        enabled: true,
        verified: true,
        condition: 'total > 2',
        origin: 'agent',
      },
    ],
    callStack: [
      {
        id: 101,
        name: 'calculate',
        source: 'Q:\\src\\app.ts',
        line: 2,
      },
    ],
    locals: [{ name: 'total', value: '3', type: 'number' }],
    watches: [
      {
        id: 'watch-agent',
        expression: 'items.length',
        value: '3',
        type: 'number',
        origin: 'agent',
      },
    ],
    console: [
      {
        id: 'console-agent',
        expression: 'items[0]',
        result: '"alpha"',
        type: 'string',
        origin: 'agent',
        timestamp: '2026-08-16T16:00:00.000Z',
      },
    ],
    events: [
      {
        id: 'event-1',
        category: 'debugger',
        message: 'Stopped on breakpoint',
        timestamp: '2026-08-16T16:00:00.000Z',
      },
    ],
  };
}

function adapter(current: DebuggerSnapshot): DebuggerBridgeAdapter {
  return {
    getSnapshot: vi.fn().mockResolvedValue(current),
    readSource: vi.fn().mockImplementation(async (_scope, path: string) => {
      const source = current.sources.find((candidate) => candidate.path === path);
      if (!source) throw new Error(`Missing source: ${path}`);
      return source;
    }),
    dispatch: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => undefined),
  };
}

describe('DebuggerPanel', () => {
  beforeEach(() => {
    clearDebuggerPanelStateCache();
  });

  it('renders source, execution state, inspection data, agent entries, console, and events', async () => {
    render(
      <DebuggerPanel
        scope={scope}
        adapter={adapter(snapshot())}
        editor={editor}
        initialSnapshot={snapshot()}
      />,
    );

    expect(screen.getByRole('region', { name: 'Debugger panel' })).toBeInTheDocument();
    expect(screen.getByText('paused')).toBeInTheDocument();
    expect(screen.getByText('Paused at line 2')).toBeInTheDocument();
    expect(screen.getByTestId('monaco-editor')).toHaveTextContent('const total = items.length');
    expect(screen.getByRole('button', { name: /calculate/ })).toBeInTheDocument();
    expect(screen.getByText('total')).toBeInTheDocument();
    expect(screen.getByText('items.length')).toBeInTheDocument();
    expect(screen.getAllByText('agent')).toHaveLength(3);
    expect(screen.getByText('items[0]')).toBeInTheDocument();
    expect(screen.getByText('Stopped on breakpoint')).toBeInTheDocument();
    expect(screen.getByLabelText('Condition for breakpoint app.ts:2')).toHaveValue('total > 2');
  });

  it('dispatches execution, frame, watch, breakpoint, and console commands with the full scope', async () => {
    const bridge = adapter(snapshot());
    render(
      <DebuggerPanel scope={scope} adapter={bridge} editor={editor} initialSnapshot={snapshot()} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Step over' }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /calculate/ }));
    });

    const condition = screen.getByLabelText('Condition for breakpoint app.ts:2');
    fireEvent.change(condition, { target: { value: 'total === 3' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });

    fireEvent.change(screen.getByLabelText('Watch expression'), {
      target: { value: 'total * 2' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    });

    fireEvent.change(screen.getByLabelText('Debug console expression'), {
      target: { value: 'total + 1' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Evaluate' }));
    });

    expect(bridge.dispatch).toHaveBeenCalledWith(scope, { type: 'continue', threadId: 7 });
    expect(bridge.dispatch).toHaveBeenCalledWith(scope, { type: 'step-over', threadId: 7 });
    expect(bridge.dispatch).toHaveBeenCalledWith(scope, { type: 'select-frame', frameId: 101 });
    expect(bridge.dispatch).toHaveBeenCalledWith(scope, {
      type: 'update-breakpoint',
      breakpointId: 'bp-agent',
      condition: 'total === 3',
    });
    expect(bridge.dispatch).toHaveBeenCalledWith(scope, {
      type: 'add-watch',
      expression: 'total * 2',
      frameId: 101,
      origin: 'human',
    });
    expect(bridge.dispatch).toHaveBeenCalledWith(scope, {
      type: 'evaluate',
      expression: 'total + 1',
      frameId: 101,
      origin: 'human',
    });
  });

  it('restores navigation across execution blocks but isolates debugger sessions', async () => {
    const current = snapshot();
    const bridge = adapter(current);
    const first = render(
      <DebuggerPanel scope={scope} adapter={bridge} editor={editor} initialSnapshot={current} />,
    );

    const sourceNavigation = screen.getByRole('navigation', { name: 'Source files' });
    fireEvent.click(within(sourceNavigation).getByRole('button', { name: 'helpers.ts' }));
    expect(screen.getByTestId('monaco-editor')).toHaveTextContent('export const twice');
    first.unmount();

    const sameScope = render(
      <DebuggerPanel
        scope={{ ...scope }}
        adapter={bridge}
        editor={editor}
        initialSnapshot={current}
      />,
    );
    expect(screen.getByTestId('monaco-editor')).toHaveTextContent('export const twice');
    sameScope.unmount();

    const nextExecution = render(
      <DebuggerPanel
        scope={{ ...scope, executionBlockId: 'execution-2' }}
        adapter={bridge}
        editor={editor}
        initialSnapshot={current}
      />,
    );
    expect(screen.getByTestId('monaco-editor')).toHaveTextContent('export const twice');
    nextExecution.unmount();

    render(
      <DebuggerPanel
        scope={{ ...scope, sessionId: 'session-2', executionBlockId: 'execution-3' }}
        adapter={bridge}
        editor={editor}
        initialSnapshot={current}
      />,
    );
    expect(screen.getByTestId('monaco-editor')).toHaveTextContent('const total = items.length');
  });

  it('renders running and completed lifecycle states with safe controls', () => {
    const running = { ...snapshot(), state: 'running' as const, statusMessage: 'Running' };
    const view = render(
      <DebuggerPanel
        scope={scope}
        adapter={adapter(running)}
        editor={editor}
        initialSnapshot={running}
      />,
    );
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

    const completed = {
      ...snapshot(),
      state: 'completed' as const,
      statusMessage: 'Completed',
      callStack: [],
      locals: [],
    };
    view.rerender(
      <DebuggerPanel
        scope={scope}
        adapter={adapter(completed)}
        editor={editor}
        initialSnapshot={completed}
      />,
    );
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('Execution completed')).toBeInTheDocument();
    expect(screen.getByLabelText('Debug console expression')).toBeDisabled();
  });
});

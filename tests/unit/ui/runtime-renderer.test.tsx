// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { act, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  mountDebuggerRuntimeUi,
  type DebuggerBridgeAdapter,
  type DebuggerEditor,
  type DebuggerSnapshot,
} from '../../../src/ui/index.js';

const editor: DebuggerEditor = {
  id: 'test-editor',
  SourceEditor: ({ source }) => <pre data-testid="monaco-editor">{source.content}</pre>,
};

function snapshot(): DebuggerSnapshot {
  return {
    state: 'paused',
    statusMessage: 'Paused on entry',
    sources: [
      {
        path: 'Q:\\fixture\\app.ts',
        name: 'app.ts',
        language: 'typescript',
        content: 'const answer = 42;',
      },
    ],
    activeSourcePath: 'Q:\\fixture\\app.ts',
    currentLocation: { file: 'Q:\\fixture\\app.ts', line: 1 },
    currentThreadId: 7,
    selectedFrameId: 11,
    breakpoints: [],
    callStack: [{ id: 11, name: 'main', source: 'Q:\\fixture\\app.ts', line: 1 }],
    locals: [{ name: 'answer', value: '42', type: 'number' }],
    watches: [],
    console: [],
    events: [],
  };
}

describe('mountDebuggerRuntimeUi', () => {
  it('mounts and unmounts the Monaco debugger from registered runtime UI state', async () => {
    const current = snapshot();
    const adapter: DebuggerBridgeAdapter = {
      getSnapshot: vi.fn().mockResolvedValue(current),
      readSource: vi.fn().mockResolvedValue(current.sources[0]),
      dispatch: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockReturnValue(() => undefined),
    };
    const container = document.createElement('div');
    document.body.append(container);
    let unmount = (): void => undefined;

    await act(async () => {
      unmount = mountDebuggerRuntimeUi(container, {
        state: {
          chatId: 'chat-1',
          runtimeSessionId: 'marshal-session-1',
          debuggerSessionId: 'debugger-session-1',
          executionBlockId: 'execution-1',
          scopeKey: 'scope-1',
          workspaceName: 'workspace-1',
        },
        adapter,
        editor,
      });
    });

    expect(screen.getByRole('region', { name: 'Debugger panel' })).toBeInTheDocument();
    expect(screen.getByTestId('monaco-editor')).toHaveTextContent('const answer = 42');

    await act(async () => unmount());
    expect(container).toBeEmptyDOMElement();
    container.remove();
  });
});

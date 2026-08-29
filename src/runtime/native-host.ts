import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { DebugProtocol } from '@vscode/debugprotocol';
import { nanoid } from 'nanoid';

import { ClrDebugAdapter } from '../adapters/clr-debug/index.js';
import { DebugpyAdapter } from '../adapters/debugpy/index.js';
import type { IAdapter } from '../adapters/index.js';
import { JsDebugAdapter } from '../adapters/js-debug/index.js';
import { NetcoredbgAdapter } from '../adapters/netcoredbg/index.js';
import { VsdbgAdapter } from '../adapters/vsdbg/index.js';
import { detectLanguage } from '../adapters/detector.js';
import type { DapClient } from '../dap/client.js';
import { isProcessAllowed } from '../security/process-guard.js';
import { redactValue } from '../security/redaction.js';
import type { AdapterType, LanguageId } from '../types/adapter.js';
import type {
  DebuggerBreakpoint,
  DebuggerConsoleEntry,
  DebuggerOutputEvent,
  DebuggerSnapshot,
  DebuggerSourceFile,
  DebuggerStackFrame,
  DebuggerVariable,
  DebuggerWatchValue,
} from '../ui/types.js';
import type {
  DebuggerHostAdapter,
  DebuggerHostEvent,
  DebuggerHostInvocation,
  DebuggerScopeBinding,
} from './contracts.js';

interface NativeAdapter extends IAdapter {
  getClient(): DapClient | undefined;
}

interface NativeSession {
  readonly id: string;
  readonly scopeKey: string;
  readonly language: LanguageId;
  readonly adapter: NativeAdapter;
  readonly client: DapClient;
  readonly createdAt: string;
  readonly breakpoints: DebuggerBreakpoint[];
  readonly watches: DebuggerWatchValue[];
  readonly console: DebuggerConsoleEntry[];
  readonly output: DebuggerOutputEvent[];
  readonly listeners: Set<(event: DebuggerHostEvent) => void>;
  readonly sources: Map<string, DebuggerSourceFile>;
  state: DebuggerSnapshot['state'];
  statusMessage?: string;
  currentThreadId?: number;
  currentLocation?: DebuggerSnapshot['currentLocation'];
  selectedFrameId?: number;
  callStack: DebuggerStackFrame[];
  locals: DebuggerVariable[];
  closeRequested?: boolean;
  disposePromise?: Promise<void>;
}

function object(value: unknown, label = 'input'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredText(value: Readonly<Record<string, unknown>>, key: string): string {
  const result = value[key];
  if (typeof result !== 'string' || !result.trim()) {
    throw new TypeError(`${key} must be a non-empty string.`);
  }
  return result;
}

function optionalText(value: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const result = value[key];
  return typeof result === 'string' && result.trim() ? result : undefined;
}

function optionalInteger(
  value: Readonly<Record<string, unknown>>,
  key: string,
): number | undefined {
  const result = value[key];
  return Number.isInteger(result) ? (result as number) : undefined;
}

function sessionSnapshot(session: NativeSession): DebuggerSnapshot {
  return Object.freeze({
    state: session.state,
    statusMessage: session.statusMessage,
    sources: Object.freeze([...session.sources.values()]),
    activeSourcePath: session.currentLocation?.file ?? session.sources.keys().next().value,
    currentLocation: session.currentLocation,
    currentThreadId: session.currentThreadId,
    selectedFrameId: session.selectedFrameId,
    breakpoints: Object.freeze([...session.breakpoints]),
    callStack: Object.freeze([...session.callStack]),
    locals: Object.freeze([...session.locals]),
    watches: Object.freeze([...session.watches]),
    console: Object.freeze([...session.console]),
    events: Object.freeze([...session.output]),
  });
}

function adapterType(value: unknown): AdapterType | undefined {
  return value === 'js-debug' ||
    value === 'debugpy' ||
    value === 'netcoredbg' ||
    value === 'clr-debug' ||
    value === 'vsdbg'
    ? value
    : undefined;
}

function languageType(value: unknown): LanguageId | undefined {
  return value === 'javascript' ||
    value === 'typescript' ||
    value === 'python' ||
    value === 'csharp'
    ? value
    : undefined;
}

async function completeDapStartup(
  client: DapClient,
  request: () => Promise<unknown>,
): Promise<void> {
  let configurationDone: Promise<void> | undefined;
  const sendConfigurationDone = (): Promise<void> => {
    configurationDone ??= client.configurationDone().then(() => undefined);
    return configurationDone;
  };

  client.onEvent('initialized', () => {
    void sendConfigurationDone().catch(() => undefined);
  });

  await request();
  await sendConfigurationDone();
}

function createAdapter(language: LanguageId, requested?: AdapterType): NativeAdapter {
  const selected =
    requested ??
    (language === 'python' ? 'debugpy' : language === 'csharp' ? 'netcoredbg' : 'js-debug');
  switch (selected) {
    case 'js-debug':
      return new JsDebugAdapter();
    case 'debugpy':
      return new DebugpyAdapter();
    case 'netcoredbg':
      return new NetcoredbgAdapter();
    case 'clr-debug':
      return new ClrDebugAdapter();
    case 'vsdbg':
      return new VsdbgAdapter();
  }
}

function adapterDapType(type: AdapterType): string {
  if (type === 'debugpy') return 'python';
  if (type === 'netcoredbg' || type === 'vsdbg') return 'coreclr';
  if (type === 'clr-debug') return 'clr';
  return 'pwa-node';
}

function variable(variable: DebugProtocol.Variable): DebuggerVariable {
  const redaction = redactValue(variable.name, variable.value);
  return {
    name: variable.name,
    value: redaction.value,
    type: variable.type,
    variablesReference: variable.variablesReference,
    redacted: redaction.redacted,
  };
}

export interface NativeDebuggerHostAdapterOptions {
  readonly maxSessions?: number;
}

export class NativeDebuggerHostAdapter implements DebuggerHostAdapter {
  private readonly sessions = new Map<string, NativeSession>();
  private readonly maxSessions: number;
  private disposed = false;

  constructor(options: NativeDebuggerHostAdapterOptions = {}) {
    this.maxSessions = options.maxSessions ?? 10;
  }

  async invoke(invocation: DebuggerHostInvocation): Promise<unknown> {
    this.assertActive();
    if (invocation.signal?.aborted) {
      throw Object.assign(new Error('Debugger command was cancelled.'), {
        code: 'CANCELLED',
      });
    }
    const input = invocation.input;
    switch (invocation.capability) {
      case 'debug.session.launch':
        return this.launch(invocation.scope, input);
      case 'debug.session.attach':
        return this.attach(invocation.scope, input);
      case 'debug.adapter.list':
        return this.listAdapters();
    }

    const session = this.requireSession(requiredText(input, 'sessionId'), invocation.scope);
    switch (invocation.capability) {
      case 'debug.session.get':
        return { sessionId: session.id, snapshot: sessionSnapshot(session) };
      case 'debug.session.disconnect':
        return this.closeSession(session, 'disconnect');
      case 'debug.session.terminate':
        return this.closeSession(session, 'terminate');
      case 'debug.session.restart':
        await session.client.sendRequest('restart');
        session.state = 'running';
        session.statusMessage = 'Restarted';
        this.emit(session, 'continued');
        return { sessionId: session.id, restarted: true, snapshot: sessionSnapshot(session) };
      case 'debug.breakpoint.set':
        return this.setBreakpoint(session, input);
      case 'debug.breakpoint.remove':
        return this.removeBreakpoint(session, input);
      case 'debug.breakpoint.enable':
        return this.toggleBreakpoint(session, input, true);
      case 'debug.breakpoint.disable':
        return this.toggleBreakpoint(session, input, false);
      case 'debug.breakpoint.list':
        return { sessionId: session.id, breakpoints: session.breakpoints };
      case 'debug.breakpoint.setFunction':
        return this.setFunctionBreakpoint(session, input);
      case 'debug.breakpoint.setException':
        return this.setExceptionBreakpoints(session, input);
      case 'debug.breakpoint.setData':
        return this.setDataBreakpoint(session, input);
      case 'debug.execution.continue':
        return this.control(session, 'continue', input);
      case 'debug.execution.pause':
        return this.control(session, 'pause', input);
      case 'debug.execution.stepOver':
        return this.control(session, 'next', input);
      case 'debug.execution.stepInto':
        return this.control(session, 'stepIn', input);
      case 'debug.execution.stepOut':
        return this.control(session, 'stepOut', input);
      case 'debug.execution.reverseContinue':
        return this.control(session, 'reverseContinue', input);
      case 'debug.execution.restartFrame':
        return this.restartFrame(session, input);
      case 'debug.execution.setNextStatement':
        return this.setNextStatement(session, input);
      case 'debug.inspect.evaluate':
        return this.evaluate(session, input);
      case 'debug.inspect.variables':
        return this.variables(session, input);
      case 'debug.inspect.callStack':
        return this.callStack(session, input);
      case 'debug.inspect.threads':
        return this.threads(session);
      case 'debug.inspect.scopes':
        return this.scopes(session, input);
      case 'debug.watch.manage':
        return this.manageWatch(session, input);
      case 'debug.inspect.loadedSources':
        return this.loadedSources(session);
      case 'debug.inspect.modules':
        return this.modules(session, input);
      case 'debug.inspect.exceptionInfo':
        return this.exceptionInfo(session, input);
      default:
        throw Object.assign(
          new Error(`Native debugger capability is not implemented: ${invocation.capability}`),
          { code: 'CAPABILITY_NOT_SUPPORTED' },
        );
    }
  }

  async readSource(
    scope: DebuggerScopeBinding,
    debuggerSessionId: string,
    path: string,
  ): Promise<DebuggerSourceFile> {
    const session = this.requireSession(debuggerSessionId, scope);
    const canonicalPath = resolve(path);
    const known = session.sources.get(canonicalPath);
    const breakpointSource = session.breakpoints.some(
      (breakpoint) => resolve(breakpoint.file) === canonicalPath,
    );
    if (!known && !breakpointSource && session.currentLocation?.file !== canonicalPath) {
      throw Object.assign(new Error('Source file is not associated with this debugger session.'), {
        code: 'PATH_OUTSIDE_WORKSPACE',
      });
    }
    const source: DebuggerSourceFile = {
      path: canonicalPath,
      name: canonicalPath.split(/[\\/]/).at(-1),
      language: session.language,
      content: await readFile(canonicalPath, 'utf8'),
    };
    session.sources.set(canonicalPath, source);
    return source;
  }

  subscribe(
    scope: DebuggerScopeBinding,
    debuggerSessionId: string,
    listener: (event: DebuggerHostEvent) => void,
  ): () => void {
    const session = this.requireSession(debuggerSessionId, scope);
    session.listeners.add(listener);
    return () => session.listeners.delete(listener);
  }

  async disposeScope(scopeKey: string): Promise<void> {
    const owned = [...this.sessions.values()].filter((session) => session.scopeKey === scopeKey);
    await Promise.all(owned.map((session) => this.disposeSession(session)));
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await Promise.all([...this.sessions.values()].map((session) => this.disposeSession(session)));
  }

  private async launch(
    scope: DebuggerScopeBinding,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    this.assertCapacity();
    const program = resolve(requiredText(input, 'program'));
    const language = languageType(input['language']) ?? (await detectLanguage(program));
    if (!language) {
      throw Object.assign(new Error(`Unable to detect language for ${program}`), {
        code: 'LANGUAGE_NOT_DETECTED',
      });
    }
    const adapter = createAdapter(language, adapterType(input['adapter']));
    const args = Array.isArray(input['args'])
      ? input['args'].filter((value): value is string => typeof value === 'string')
      : undefined;
    const cwd = optionalText(input, 'cwd');
    const env =
      input['env'] && typeof input['env'] === 'object' && !Array.isArray(input['env'])
        ? Object.fromEntries(
            Object.entries(input['env']).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string',
            ),
          )
        : undefined;
    let session: NativeSession | undefined;
    try {
      await adapter.launch({ language }, { program, args, cwd, env });
      const client = this.requireClient(adapter);
      if (adapter.type === 'debugpy' || adapter.type === 'netcoredbg') {
        session = this.createSession(scope, language, adapter, client, program);
        await client.initialize({
          clientID: 'agentic-debugger',
          clientName: 'Agentic Debugger',
          adapterID: adapterDapType(adapter.type),
          pathFormat: 'path',
          linesStartAt1: true,
          columnsStartAt1: true,
          supportsRunInTerminalRequest: false,
        });
        await completeDapStartup(client, () =>
          client.launch({
            type: adapterDapType(adapter.type),
            request: 'launch',
            program,
            args: args ?? [],
            cwd: cwd ?? process.cwd(),
            env,
            stopOnEntry: input['stopOnEntry'] === true,
          } as DebugProtocol.LaunchRequestArguments),
        );
      }
      session ??= this.createSession(scope, language, adapter, client, program);
      return { sessionId: session.id, snapshot: sessionSnapshot(session) };
    } catch (error) {
      if (session) this.sessions.delete(session.id);
      await adapter.dispose();
      throw error;
    }
  }

  private async attach(
    scope: DebuggerScopeBinding,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    this.assertCapacity();
    const language = languageType(input['language']);
    if (!language) throw new TypeError('language is required.');
    const processId = optionalInteger(input, 'pid');
    if (processId !== undefined) {
      const decision = isProcessAllowed(processId);
      if (!decision.allowed) {
        throw Object.assign(new Error(decision.reason), {
          code: 'PROCESS_RESTRICTED',
        });
      }
    }
    const adapter = createAdapter(language, adapterType(input['adapter']));
    const displayName =
      processId !== undefined
        ? `process ${processId}`
        : `${optionalText(input, 'host') ?? '127.0.0.1'}:${optionalInteger(input, 'port') ?? ''}`;
    let session: NativeSession | undefined;
    try {
      await adapter.attach(
        { language },
        {
          processId,
          host: optionalText(input, 'host'),
          port: optionalInteger(input, 'port'),
          debugType:
            input['type'] === 'chrome' || input['type'] === 'msedge' ? input['type'] : 'node',
        },
      );
      const client = this.requireClient(adapter);
      if (adapter.type === 'debugpy') {
        session = this.createSession(scope, language, adapter, client, displayName);
        await client.initialize({
          clientID: 'agentic-debugger',
          clientName: 'Agentic Debugger',
          adapterID: 'python',
          pathFormat: 'path',
          linesStartAt1: true,
          columnsStartAt1: true,
          supportsRunInTerminalRequest: false,
        });
        await completeDapStartup(client, () =>
          client.attach({
            type: 'python',
            request: 'attach',
            connect: {
              host: optionalText(input, 'host') ?? '127.0.0.1',
              port: optionalInteger(input, 'port') ?? 5678,
            },
          } as DebugProtocol.AttachRequestArguments),
        );
      }
      session ??= this.createSession(scope, language, adapter, client, displayName);
      return { sessionId: session.id, snapshot: sessionSnapshot(session) };
    } catch (error) {
      if (session) this.sessions.delete(session.id);
      await adapter.dispose();
      throw error;
    }
  }

  private createSession(
    scope: DebuggerScopeBinding,
    language: LanguageId,
    adapter: NativeAdapter,
    client: DapClient,
    target: string,
  ): NativeSession {
    const session: NativeSession = {
      id: `sess-${nanoid(8)}`,
      scopeKey: scope.scopeKey,
      language,
      adapter,
      client,
      createdAt: new Date().toISOString(),
      breakpoints: [],
      watches: [],
      console: [],
      output: [],
      listeners: new Set(),
      sources: new Map(),
      state: 'running',
      statusMessage: `Debugging ${target}`,
      callStack: [],
      locals: [],
    };
    this.sessions.set(session.id, session);
    this.wireEvents(session);
    return session;
  }

  private wireEvents(session: NativeSession): void {
    session.client.onEvent('stopped', (event) => {
      const body = object(event.body ?? {});
      session.state = 'paused';
      session.currentThreadId = optionalInteger(body, 'threadId');
      session.statusMessage = `Paused: ${optionalText(body, 'reason') ?? 'stopped'}`;
      void this.hydrateStoppedState(session).then(
        () => this.emit(session, 'stopped', body),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          session.output.push({
            id: `event-${nanoid(8)}`,
            category: 'stderr',
            message: `Unable to refresh stopped debugger state: ${message}`,
            timestamp: new Date().toISOString(),
          });
          if (session.output.length > 256) session.output.shift();
          this.emit(session, 'state-refresh-error', { message });
        },
      );
    });
    session.client.onEvent('continued', () => {
      session.state = 'running';
      session.statusMessage = 'Running';
      session.callStack = [];
      session.locals = [];
      session.currentLocation = undefined;
      this.emit(session, 'continued');
    });
    const complete = (): void => {
      this.complete(session, 'Completed');
      if (session.closeRequested) return;
      void this.disposeCompletedSession(session).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        session.output.push({
          id: `event-${nanoid(8)}`,
          category: 'stderr',
          message: `Unable to release completed debugger session: ${message}`,
          timestamp: new Date().toISOString(),
        });
        this.emit(session, 'cleanup-error', { message });
      });
    };
    session.client.onEvent('terminated', complete);
    session.client.onEvent('exited', complete);
    session.client.onEvent('output', (event) => {
      const body = object(event.body ?? {});
      const category =
        body['category'] === 'stderr' || body['category'] === 'stdout'
          ? body['category']
          : 'debugger';
      const output = typeof body['output'] === 'string' ? body['output'] : '';
      session.output.push({
        id: `event-${nanoid(8)}`,
        category,
        message: output,
        timestamp: new Date().toISOString(),
      });
      if (session.output.length > 256) session.output.shift();
      this.emit(session, 'output', body);
    });
    session.client.onEvent('breakpoint', (event) => this.emit(session, 'breakpoint', event.body));
    session.client.onEvent('thread', (event) => this.emit(session, 'thread', event.body));
    session.client.onEvent('module', (event) => this.emit(session, 'module', event.body));
  }

  private async hydrateStoppedState(session: NativeSession): Promise<void> {
    const threadId = session.currentThreadId;
    if (threadId === undefined) return;
    const stackResponse = await session.client.stackTrace({ threadId, levels: 100 });
    const stackBody = stackResponse.body as DebugProtocol.StackTraceResponse['body'] | undefined;
    const frames = stackBody?.stackFrames ?? [];
    session.callStack = frames.map((frame) => ({
      id: frame.id,
      name: frame.name,
      source: frame.source?.path ?? frame.source?.name,
      line: frame.line,
      column: frame.column,
    }));
    const first = frames[0];
    if (!first) return;
    session.selectedFrameId = first.id;
    if (first.source?.path) {
      const path = resolve(first.source.path);
      session.currentLocation = { file: path, line: first.line, column: first.column };
      session.sources.set(path, {
        path,
        name: first.source.name,
        language: session.language,
      });
    }
    const scopesResponse = await session.client.scopes({ frameId: first.id });
    const scopesBody = scopesResponse.body as DebugProtocol.ScopesResponse['body'] | undefined;
    const localScope = scopesBody?.scopes.find((scope) => !scope.expensive);
    if (!localScope) return;
    const variablesResponse = await session.client.variables({
      variablesReference: localScope.variablesReference,
      count: 200,
    });
    const variablesBody = variablesResponse.body as
      | DebugProtocol.VariablesResponse['body']
      | undefined;
    session.locals = (variablesBody?.variables ?? []).map(variable);
    await this.refreshWatches(session, first.id);
  }

  private async setBreakpoint(
    session: NativeSession,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const file = resolve(requiredText(input, 'file'));
    const line = optionalInteger(input, 'line');
    if (!line || line < 1) throw new TypeError('line must be a positive integer.');
    const existing = session.breakpoints.find(
      (breakpoint) => breakpoint.file === file && breakpoint.line === line,
    );
    const candidate: DebuggerBreakpoint = {
      id: existing?.id ?? `bp-${nanoid(8)}`,
      file,
      line,
      enabled: existing?.enabled ?? true,
      verified: false,
      condition: optionalText(input, 'condition'),
      hitCondition: optionalText(input, 'hitCondition'),
      logMessage: optionalText(input, 'logMessage'),
      origin: input['origin'] === 'human' ? 'human' : (existing?.origin ?? 'agent'),
    };
    const next = session.breakpoints.filter(
      (breakpoint) => !(breakpoint.file === file && breakpoint.line === line),
    );
    next.push(candidate);
    session.breakpoints.splice(0, session.breakpoints.length, ...next);
    await this.syncFileBreakpoints(session, file);
    this.emit(session, 'breakpoint');
    return { sessionId: session.id, breakpoint: candidate, snapshot: sessionSnapshot(session) };
  }

  private async removeBreakpoint(
    session: NativeSession,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const breakpoint = this.findBreakpoint(session, input);
    const index = session.breakpoints.findIndex((candidate) => candidate.id === breakpoint.id);
    session.breakpoints.splice(index, 1);
    await this.syncFileBreakpoints(session, breakpoint.file);
    this.emit(session, 'breakpoint');
    return { sessionId: session.id, removed: breakpoint.id, snapshot: sessionSnapshot(session) };
  }

  private async toggleBreakpoint(
    session: NativeSession,
    input: Readonly<Record<string, unknown>>,
    enabled: boolean,
  ): Promise<unknown> {
    const breakpoint = this.findBreakpoint(session, input);
    const index = session.breakpoints.findIndex((candidate) => candidate.id === breakpoint.id);
    session.breakpoints[index] = { ...breakpoint, enabled };
    await this.syncFileBreakpoints(session, breakpoint.file);
    this.emit(session, 'breakpoint');
    return {
      sessionId: session.id,
      breakpoint: session.breakpoints[index],
      snapshot: sessionSnapshot(session),
    };
  }

  private findBreakpoint(
    session: NativeSession,
    input: Readonly<Record<string, unknown>>,
  ): DebuggerBreakpoint {
    const breakpointId = optionalText(input, 'breakpointId');
    const file = optionalText(input, 'file');
    const line = optionalInteger(input, 'line');
    const breakpoint = session.breakpoints.find(
      (candidate) =>
        (breakpointId && candidate.id === breakpointId) ||
        (file && line && candidate.file === resolve(file) && candidate.line === line),
    );
    if (!breakpoint) {
      throw Object.assign(new Error('Breakpoint not found.'), {
        code: 'BREAKPOINT_NOT_FOUND',
      });
    }
    return breakpoint;
  }

  private async syncFileBreakpoints(session: NativeSession, file: string): Promise<void> {
    const candidates = session.breakpoints.filter(
      (breakpoint) => breakpoint.file === file && breakpoint.enabled,
    );
    const response = await session.client.setBreakpoints({
      source: { path: file },
      breakpoints: candidates.map((breakpoint) => ({
        line: breakpoint.line,
        condition: breakpoint.condition,
        hitCondition: breakpoint.hitCondition,
        logMessage: breakpoint.logMessage,
      })),
    });
    const body = response.body as DebugProtocol.SetBreakpointsResponse['body'] | undefined;
    for (const [index, result] of (body?.breakpoints ?? []).entries()) {
      const candidate = candidates[index];
      if (!candidate) continue;
      const storedIndex = session.breakpoints.findIndex(
        (breakpoint) => breakpoint.id === candidate.id,
      );
      session.breakpoints[storedIndex] = {
        ...candidate,
        verified: result.verified,
        line: result.line ?? candidate.line,
      };
    }
    session.sources.set(file, {
      path: file,
      name: file.split(/[\\/]/).at(-1),
      language: session.language,
    });
  }

  private async setFunctionBreakpoint(
    session: NativeSession,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const response = await session.client.setFunctionBreakpoints({
      breakpoints: [
        {
          name: requiredText(input, 'name'),
          condition: optionalText(input, 'condition'),
          hitCondition: optionalText(input, 'hitCondition'),
        },
      ],
    });
    return { sessionId: session.id, response: response.body ?? {} };
  }

  private async setExceptionBreakpoints(
    session: NativeSession,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const filters = Array.isArray(input['filters'])
      ? input['filters'].filter((value): value is string => typeof value === 'string')
      : [];
    await session.client.setExceptionBreakpoints({ filters });
    return { sessionId: session.id, filters };
  }

  private async setDataBreakpoint(
    session: NativeSession,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const response = await session.client.sendRequest('setDataBreakpoints', {
      breakpoints: [
        {
          dataId: requiredText(input, 'dataId'),
          accessType: optionalText(input, 'accessType') ?? 'write',
        },
      ],
    });
    return { sessionId: session.id, response: response.body ?? {} };
  }

  private async control(
    session: NativeSession,
    command: 'continue' | 'pause' | 'next' | 'stepIn' | 'stepOut' | 'reverseContinue',
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const threadId = optionalInteger(input, 'threadId') ?? session.currentThreadId;
    if (threadId === undefined) {
      throw Object.assign(new Error('No stopped thread is available.'), {
        code: 'THREAD_NOT_FOUND',
      });
    }
    await session.client.sendRequest(command, { threadId });
    session.state = 'running';
    session.statusMessage = command === 'pause' ? 'Pause requested' : command;
    this.emit(session, command);
    return { sessionId: session.id, threadId, action: command, snapshot: sessionSnapshot(session) };
  }

  private async restartFrame(
    session: NativeSession,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const frameId = optionalInteger(input, 'frameId');
    if (frameId === undefined) throw new TypeError('frameId is required.');
    await session.client.sendRequest('restartFrame', { frameId });
    return { sessionId: session.id, frameId };
  }

  private async setNextStatement(
    session: NativeSession,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const file = resolve(requiredText(input, 'file'));
    const line = optionalInteger(input, 'line');
    const threadId = optionalInteger(input, 'threadId') ?? session.currentThreadId;
    if (!line || threadId === undefined) {
      throw new TypeError('line and a stopped thread are required.');
    }
    const response = await session.client.gotoTargets({ source: { path: file }, line });
    const body = response.body as DebugProtocol.GotoTargetsResponse['body'] | undefined;
    const target = body?.targets[0];
    if (!target) throw new Error(`No goto target at ${file}:${line}`);
    await session.client.goto({ threadId, targetId: target.id });
    return { sessionId: session.id, threadId, file, line: target.line };
  }

  private async evaluate(
    session: NativeSession,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const expression = requiredText(input, 'expression');
    const response = await session.client.evaluate({
      expression,
      frameId: optionalInteger(input, 'frameId') ?? session.selectedFrameId,
      context:
        input['context'] === 'watch' || input['context'] === 'hover' ? input['context'] : 'repl',
    });
    const body = response.body as DebugProtocol.EvaluateResponse['body'] | undefined;
    const entry: DebuggerConsoleEntry = {
      id: `console-${nanoid(8)}`,
      expression,
      result: body?.result ?? '',
      type: body?.type,
      origin: input['origin'] === 'human' ? 'human' : 'agent',
      timestamp: new Date().toISOString(),
    };
    session.console.push(entry);
    if (session.console.length > 256) session.console.shift();
    this.emit(session, 'evaluate');
    return {
      sessionId: session.id,
      result: body?.result ?? '',
      type: body?.type,
      variablesReference: body?.variablesReference ?? 0,
      snapshot: sessionSnapshot(session),
    };
  }

  private async variables(
    session: NativeSession,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const reference = optionalInteger(input, 'variablesReference');
    if (reference === undefined) throw new TypeError('variablesReference is required.');
    const response = await session.client.variables({
      variablesReference: reference,
      count: optionalInteger(input, 'maxProperties') ?? 100,
    });
    const body = response.body as DebugProtocol.VariablesResponse['body'] | undefined;
    const variables = (body?.variables ?? []).map(variable);
    return { sessionId: session.id, variablesReference: reference, variables };
  }

  private async callStack(
    session: NativeSession,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const threadId = optionalInteger(input, 'threadId') ?? session.currentThreadId;
    if (threadId === undefined) throw new Error('No stopped thread is available.');
    const response = await session.client.stackTrace({
      threadId,
      startFrame: optionalInteger(input, 'startFrame'),
      levels: optionalInteger(input, 'levels') ?? 100,
    });
    const body = response.body as DebugProtocol.StackTraceResponse['body'] | undefined;
    return { sessionId: session.id, threadId, stackFrames: body?.stackFrames ?? [] };
  }

  private async threads(session: NativeSession): Promise<unknown> {
    const response = await session.client.threads();
    const body = response.body as DebugProtocol.ThreadsResponse['body'] | undefined;
    return { sessionId: session.id, threads: body?.threads ?? [] };
  }

  private async scopes(
    session: NativeSession,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const frameId = optionalInteger(input, 'frameId');
    if (frameId === undefined) throw new TypeError('frameId is required.');
    const response = await session.client.scopes({ frameId });
    const body = response.body as DebugProtocol.ScopesResponse['body'] | undefined;
    return { sessionId: session.id, frameId, scopes: body?.scopes ?? [] };
  }

  private async manageWatch(
    session: NativeSession,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const action = requiredText(input, 'action');
    const expression = optionalText(input, 'expression');
    if (action === 'add') {
      if (!expression) throw new TypeError('expression is required for add.');
      if (!session.watches.some((watch) => watch.expression === expression)) {
        session.watches.push({
          id: `watch-${nanoid(8)}`,
          expression,
          origin: input['origin'] === 'human' ? 'human' : 'agent',
        });
      }
    } else if (action === 'remove') {
      const watchId = optionalText(input, 'watchId');
      const index = session.watches.findIndex(
        (watch) => watch.id === watchId || watch.expression === expression,
      );
      if (index >= 0) session.watches.splice(index, 1);
    } else if (action !== 'list' && action !== 'evaluate') {
      throw new TypeError(`Unknown watch action: ${action}`);
    }
    if (action === 'add' || action === 'evaluate') {
      await this.refreshWatches(
        session,
        optionalInteger(input, 'frameId') ?? session.selectedFrameId,
      );
    }
    this.emit(session, 'watch');
    return {
      sessionId: session.id,
      action,
      watches: session.watches,
      snapshot: sessionSnapshot(session),
    };
  }

  private async refreshWatches(session: NativeSession, frameId: number | undefined): Promise<void> {
    for (let index = 0; index < session.watches.length; index += 1) {
      const watch = session.watches[index]!;
      try {
        const response = await session.client.evaluate({
          expression: watch.expression,
          frameId,
          context: 'watch',
        });
        const body = response.body as DebugProtocol.EvaluateResponse['body'] | undefined;
        session.watches[index] = {
          ...watch,
          value: body?.result ?? '',
          type: body?.type,
          error: undefined,
        };
      } catch (error) {
        session.watches[index] = {
          ...watch,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  private async loadedSources(session: NativeSession): Promise<unknown> {
    const response = await session.client.sendRequest('loadedSources');
    const body = response.body as DebugProtocol.LoadedSourcesResponse['body'] | undefined;
    const sources = body?.sources ?? [];
    for (const source of sources) {
      if (!source.path) continue;
      const path = resolve(source.path);
      session.sources.set(path, {
        path,
        name: source.name,
        language: session.language,
      });
    }
    return { sessionId: session.id, sources, snapshot: sessionSnapshot(session) };
  }

  private async modules(
    session: NativeSession,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const response = await session.client.sendRequest('modules', {
      startModule: optionalInteger(input, 'startModule'),
      moduleCount: optionalInteger(input, 'moduleCount'),
    });
    return { sessionId: session.id, modules: response.body ?? {} };
  }

  private async exceptionInfo(
    session: NativeSession,
    input: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const threadId = optionalInteger(input, 'threadId');
    if (threadId === undefined) throw new TypeError('threadId is required.');
    const response = await session.client.sendRequest('exceptionInfo', { threadId });
    return { sessionId: session.id, threadId, exception: response.body ?? {} };
  }

  private listAdapters(): unknown {
    return {
      adapters: [
        { type: 'js-debug', languages: ['javascript', 'typescript'] },
        { type: 'debugpy', languages: ['python'] },
        { type: 'netcoredbg', languages: ['csharp'] },
        { type: 'clr-debug', languages: ['csharp'], attachOnly: true },
        { type: 'vsdbg', languages: ['csharp'], optIn: true },
      ],
    };
  }

  private complete(session: NativeSession, message: string): void {
    const wasCompleted = session.state === 'completed';
    session.state = 'completed';
    session.statusMessage = message;
    session.callStack = [];
    session.locals = [];
    session.currentLocation = undefined;
    if (!wasCompleted) this.emit(session, 'completed');
  }

  private emit(session: NativeSession, type: string, body?: unknown): void {
    const event: DebuggerHostEvent = {
      sessionId: session.id,
      type,
      occurredAt: new Date().toISOString(),
      body,
      snapshot: sessionSnapshot(session),
    };
    for (const listener of session.listeners) listener(event);
  }

  private requireSession(id: string, scope: DebuggerScopeBinding): NativeSession {
    const session = this.sessions.get(id);
    if (!session || session.scopeKey !== scope.scopeKey) {
      throw Object.assign(new Error(`Debugger session not found in this scope: ${id}`), {
        code: 'SCOPE_MISMATCH',
      });
    }
    return session;
  }

  private requireClient(adapter: NativeAdapter): DapClient {
    const client = adapter.getClient();
    if (!client) {
      throw Object.assign(new Error('Debug adapter did not create a DAP client.'), {
        code: 'ADAPTER_NOT_AVAILABLE',
      });
    }
    return client;
  }

  private async closeSession(
    session: NativeSession,
    action: 'disconnect' | 'terminate',
  ): Promise<unknown> {
    session.closeRequested = true;
    try {
      if (action === 'disconnect') await session.adapter.disconnect();
      else await session.adapter.terminate();
      this.complete(session, action === 'disconnect' ? 'Disconnected' : 'Terminated');
      const snapshot = sessionSnapshot(session);
      await this.disposeSession(session);
      return {
        sessionId: session.id,
        [action === 'disconnect' ? 'disconnected' : 'terminated']: true,
        snapshot,
      };
    } catch (error) {
      await this.disposeSession(session);
      throw error;
    }
  }

  private async disposeCompletedSession(session: NativeSession): Promise<void> {
    await session.client.whenIdle();
    if (session.state === 'completed' && !session.closeRequested) {
      await this.disposeSession(session);
    }
  }

  private disposeSession(session: NativeSession): Promise<void> {
    session.disposePromise ??= (async () => {
      await session.adapter.dispose();
      session.listeners.clear();
      this.sessions.delete(session.id);
    })();
    return session.disposePromise;
  }

  private assertCapacity(): void {
    const activeSessions = [...this.sessions.values()].filter(
      (session) => session.state !== 'completed',
    ).length;
    if (activeSessions >= this.maxSessions) {
      throw Object.assign(new Error(`Maximum debugger sessions exceeded: ${this.maxSessions}`), {
        code: 'INVALID_STATE',
      });
    }
  }

  private assertActive(): void {
    if (this.disposed) {
      throw Object.assign(new Error('Native debugger host adapter is disposed.'), {
        code: 'INVALID_STATE',
      });
    }
  }
}

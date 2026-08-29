import type { DebugProtocol } from '@vscode/debugprotocol';

import { SessionState } from '../types/session.js';
import type { DapClient } from '../dap/client.js';
import type { DebugSessionOptions, SessionSnapshot } from './types.js';
import { SESSION_STATE_TRANSITIONS, SessionStateError } from './types.js';
import type { SessionEventEmitter, SessionStateChangedEvent } from './events.js';
import { DefaultSessionEventEmitter, SessionEventType } from './events.js';

/** Error thrown when a DAP capability is not supported by the adapter. */
export class CapabilityNotSupportedError extends Error {
  constructor(readonly capability: string) {
    super(
      `Capability not supported by debug adapter: ${capability}. ` +
        `The adapter does not implement this feature. ` +
        `Use a different adapter or remove the unsupported operation.`,
    );
    this.name = 'CapabilityNotSupportedError';
  }
}

/**
 * Wraps a DAP client connection for a single debug session.
 *
 * Manages the session state machine and coordinates communication
 * with the debug adapter via the DAP client.
 */
export class DebugSession {
  readonly id: string;
  readonly language: string;
  readonly createdAt: string;

  private currentState: SessionState;
  private lastStateChangeAt: string | undefined;
  private readonly client: DapClient;
  private readonly events: SessionEventEmitter;
  private storedCapabilities: DebugProtocol.Capabilities | undefined;

  constructor(options: DebugSessionOptions) {
    this.id = options.config.sessionId;
    this.language = options.config.language;
    this.createdAt = new Date().toISOString();
    this.currentState = SessionState.Idle;
    this.client = options.client;
    this.events = new DefaultSessionEventEmitter();

    this.registerDapEventHandlers();
  }

  get state(): SessionState {
    return this.currentState;
  }

  get capabilities(): DebugProtocol.Capabilities | undefined {
    return this.storedCapabilities;
  }

  /** Access the session event emitter for subscribing to state changes. */
  get eventEmitter(): SessionEventEmitter {
    return this.events;
  }

  /**
   * Send the DAP initialize handshake.
   *
   * Transitions: idle → initializing, then initializing → running
   */
  async initialize(): Promise<void> {
    this.transitionTo(SessionState.Initializing);

    const response = await this.client.initialize({
      clientID: 'agentic-debugger',
      clientName: 'Agentic Debugger',
      adapterID: this.language,
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsRunInTerminalRequest: false,
    });

    this.storedCapabilities = (response.body as DebugProtocol.Capabilities) ?? {};
  }

  /**
   * Launch a debuggee program.
   *
   * Sends DAP launch + configurationDone, then transitions to running.
   */
  async launch(args: Record<string, unknown>): Promise<void> {
    await this.startDebuggee(() =>
      this.client.launch(args as DebugProtocol.LaunchRequestArguments),
    );
    this.transitionTo(SessionState.Running);
  }

  /**
   * Attach to a running debuggee process.
   *
   * Sends DAP attach + configurationDone, then transitions to running.
   */
  async attach(args: Record<string, unknown>): Promise<void> {
    await this.startDebuggee(() =>
      this.client.attach(args as DebugProtocol.AttachRequestArguments),
    );
    this.transitionTo(SessionState.Running);
  }

  /**
   * Gracefully disconnect from the debug adapter.
   *
   * Transitions directly to terminated.
   */
  async disconnect(): Promise<void> {
    await this.client.disconnect();
    this.transitionTo(SessionState.Terminated);
  }

  /**
   * Request the debug adapter to terminate the debuggee.
   *
   * Transitions to terminating; terminated state occurs when the
   * adapter sends a terminated/exited event.
   */
  async terminate(): Promise<void> {
    this.transitionTo(SessionState.Terminating);
    await this.client.sendRequest('terminate');
  }

  /**
   * Restart the debug session.
   *
   * Requires adapter capability `supportsRestartRequest`.
   * Can be called from running or stopped state.
   *
   * @throws CapabilityNotSupportedError if adapter does not support restart.
   */
  async restart(): Promise<void> {
    if (!this.storedCapabilities?.supportsRestartRequest) {
      throw new CapabilityNotSupportedError('supportsRestartRequest');
    }

    await this.client.sendRequest('restart');

    if (this.currentState === SessionState.Stopped) {
      this.transitionTo(SessionState.Running);
    }
  }

  /** Take a snapshot of current session state. */
  snapshot(): SessionSnapshot {
    return {
      sessionId: this.id,
      state: this.currentState,
      language: this.language,
      createdAt: this.createdAt,
      lastStateChange: this.lastStateChangeAt,
    };
  }

  /**
   * Complete the DAP startup handshake without deadlocking adapters that wait
   * for configurationDone before resolving launch or attach.
   */
  private async startDebuggee(request: () => Promise<DebugProtocol.Response>): Promise<void> {
    let configurationDone: Promise<void> | undefined;
    const sendConfigurationDone = (): Promise<void> => {
      configurationDone ??= this.client.configurationDone().then(() => undefined);
      return configurationDone;
    };

    this.client.onEvent('initialized', () => {
      void sendConfigurationDone().catch(() => undefined);
    });

    await request();
    await sendConfigurationDone();
  }

  /**
   * Validate and apply a state transition.
   *
   * @throws SessionStateError if transition is not allowed.
   */
  private transitionTo(newState: SessionState): void {
    const allowed = SESSION_STATE_TRANSITIONS[this.currentState];
    if (!allowed.includes(newState)) {
      throw new SessionStateError(this.currentState, newState);
    }
    const previousState = this.currentState;
    this.currentState = newState;
    this.lastStateChangeAt = new Date().toISOString();

    const event: SessionStateChangedEvent = {
      type: SessionEventType.StateChanged,
      sessionId: this.id,
      timestamp: this.lastStateChangeAt,
      previousState,
      newState,
    };
    this.events.emit(event);
  }

  /** Register handlers for DAP events that drive state transitions. */
  private registerDapEventHandlers(): void {
    this.client.onEvent('stopped', () => {
      if (this.currentState === SessionState.Running) {
        this.transitionTo(SessionState.Stopped);
      }
    });

    this.client.onEvent('continued', () => {
      if (this.currentState === SessionState.Stopped) {
        this.transitionTo(SessionState.Running);
      }
    });

    this.client.onEvent('terminated', () => {
      if (this.currentState === SessionState.Terminating) {
        this.transitionTo(SessionState.Terminated);
      }
    });

    this.client.onEvent('exited', () => {
      if (this.currentState === SessionState.Terminating) {
        this.transitionTo(SessionState.Terminated);
      }
    });
  }
}

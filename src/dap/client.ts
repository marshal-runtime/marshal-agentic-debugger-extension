import type { DebugProtocol } from '@vscode/debugprotocol';

import type { Transport } from './transport/types.js';
import type {
  DapEventHandler,
  DapResponse,
  DapReverseRequestHandler,
  DapTimeoutConfig,
} from './types.js';
import { DapFramer } from './framer.js';
import { DapRouter } from './router.js';

/** Options for creating a DapClient instance. */
export interface DapClientOptions {
  /** The transport to use for communication. */
  readonly transport: Transport;
  /** Timeout configuration for DAP operations. */
  readonly timeouts?: DapTimeoutConfig;
}

/**
 * High-level DAP client providing a typed API for debug adapter communication.
 *
 * The DapClient orchestrates the full DAP stack:
 * - Transport (stdio or TCP) for raw byte I/O
 * - Framer for Content-Length message encoding/decoding
 * - Router for request-response correlation and event dispatch
 *
 * Usage:
 * ```typescript
 * const client = new DapClient({ transport });
 * await client.initialize({ clientID: "agentic-debugger" });
 * await client.launch({ program: "./app.js" });
 * ```
 */
export class DapClient {
  private readonly framer: DapFramer;
  private readonly router: DapRouter;
  private capabilities: DebugProtocol.Capabilities | undefined;

  constructor(private readonly options: DapClientOptions) {
    this.framer = new DapFramer();
    this.router = new DapRouter(options.transport, this.framer, options.timeouts);
  }

  /** Returns the adapter capabilities received from the initialize response. */
  getCapabilities(): DebugProtocol.Capabilities | undefined {
    return this.capabilities;
  }

  // ── Session lifecycle ──────────────────────────────────────────────

  async initialize(args: DebugProtocol.InitializeRequestArguments): Promise<DapResponse> {
    const response = await this.router.sendRequest('initialize', args);
    this.capabilities = (response.body as DebugProtocol.Capabilities) ?? {};
    return response;
  }

  async configurationDone(): Promise<DapResponse> {
    return this.router.sendRequest('configurationDone');
  }

  async launch(args: DebugProtocol.LaunchRequestArguments): Promise<DapResponse> {
    return this.router.sendRequest('launch', args);
  }

  async attach(args: DebugProtocol.AttachRequestArguments): Promise<DapResponse> {
    return this.router.sendRequest('attach', args);
  }

  async disconnect(args?: DebugProtocol.DisconnectArguments): Promise<DapResponse> {
    return this.router.sendRequest('disconnect', args);
  }

  // ── Breakpoints ────────────────────────────────────────────────────

  async setBreakpoints(args: DebugProtocol.SetBreakpointsArguments): Promise<DapResponse> {
    return this.router.sendRequest('setBreakpoints', args);
  }

  async setFunctionBreakpoints(
    args: DebugProtocol.SetFunctionBreakpointsArguments,
  ): Promise<DapResponse> {
    return this.router.sendRequest('setFunctionBreakpoints', args);
  }

  async setExceptionBreakpoints(
    args: DebugProtocol.SetExceptionBreakpointsArguments,
  ): Promise<DapResponse> {
    return this.router.sendRequest('setExceptionBreakpoints', args);
  }

  // ── Execution control ──────────────────────────────────────────────

  async continue(args: DebugProtocol.ContinueArguments): Promise<DapResponse> {
    return this.router.sendRequest('continue', args);
  }

  async next(args: DebugProtocol.NextArguments): Promise<DapResponse> {
    return this.router.sendRequest('next', args);
  }

  async stepIn(args: DebugProtocol.StepInArguments): Promise<DapResponse> {
    return this.router.sendRequest('stepIn', args);
  }

  async stepOut(args: DebugProtocol.StepOutArguments): Promise<DapResponse> {
    return this.router.sendRequest('stepOut', args);
  }

  async pause(args: DebugProtocol.PauseArguments): Promise<DapResponse> {
    return this.router.sendRequest('pause', args);
  }

  // ── Inspection ─────────────────────────────────────────────────────

  async stackTrace(args: DebugProtocol.StackTraceArguments): Promise<DapResponse> {
    return this.router.sendRequest('stackTrace', args);
  }

  async scopes(args: DebugProtocol.ScopesArguments): Promise<DapResponse> {
    return this.router.sendRequest('scopes', args);
  }

  async variables(args: DebugProtocol.VariablesArguments): Promise<DapResponse> {
    return this.router.sendRequest('variables', args);
  }

  async evaluate(args: DebugProtocol.EvaluateArguments): Promise<DapResponse> {
    return this.router.sendRequest('evaluate', args);
  }

  async threads(): Promise<DapResponse> {
    return this.router.sendRequest('threads');
  }

  // ── Navigation (set-next-statement) ────────────────────────────────

  async gotoTargets(args: DebugProtocol.GotoTargetsArguments): Promise<DapResponse> {
    return this.router.sendRequest('gotoTargets', args);
  }

  async goto(args: DebugProtocol.GotoArguments): Promise<DapResponse> {
    return this.router.sendRequest('goto', args);
  }

  // ── Events & generic ───────────────────────────────────────────────

  /** Register a handler for DAP events. */
  onEvent(eventType: string, handler: DapEventHandler): void {
    this.router.onEvent(eventType, handler);
  }

  /**
   * Register a handler for a reverse request from the debug adapter.
   *
   * Reverse requests are sent by the adapter back to the client.
   * Common examples include vsdbg's "handshake" challenge and
   * "runInTerminal" requests.
   *
   * @param command - The reverse request command name.
   * @param handler - Callback that must return a DAP response.
   */
  onReverseRequest(command: string, handler: DapReverseRequestHandler): void {
    this.router.onReverseRequest(command, handler);
  }

  /** Send a DAP response back to the adapter (for reverse requests). */
  sendResponse(response: DapResponse): void {
    this.router.sendResponse(response);
  }

  /** Send a generic DAP request to the adapter. */
  async sendRequest(command: string, args?: unknown): Promise<DapResponse> {
    return this.router.sendRequest(command, args);
  }

  /** Resolve after all currently pending DAP requests have settled. */
  whenIdle(): Promise<void> {
    return this.router.whenIdle();
  }

  // ── Cleanup ────────────────────────────────────────────────────────

  /** Dispose the client, releasing all resources. */
  dispose(): void {
    this.router.dispose();
    this.options.transport.close();
    this.framer.reset();
  }
}

import type { LanguageId, AdapterType, AdapterConfig } from '../types/adapter.js';

/** Capabilities reported by a debug adapter after initialization. */
export interface AdapterCapabilities {
  readonly supportsConditionalBreakpoints?: boolean;
  readonly supportsFunctionBreakpoints?: boolean;
  readonly supportsEvaluateForHovers?: boolean;
  readonly supportsStepBack?: boolean;
  readonly supportsSetVariable?: boolean;
  readonly supportsRestartFrame?: boolean;
  readonly supportsGotoTargetsRequest?: boolean;
  readonly supportsStepInTargetsRequest?: boolean;
  readonly supportsCompletionsRequest?: boolean;
  readonly supportsModulesRequest?: boolean;
  readonly supportsExceptionOptions?: boolean;
  readonly supportsValueFormattingOptions?: boolean;
  readonly supportsExceptionInfoRequest?: boolean;
  readonly supportsTerminateRequest?: boolean;
  readonly supportsDelayedStackTraceLoading?: boolean;
  readonly supportsLoadedSourcesRequest?: boolean;
  readonly supportsLogPoints?: boolean;
  readonly supportsTerminateThreadsRequest?: boolean;
  readonly supportsSetExpression?: boolean;
  readonly supportsTerminateDebuggee?: boolean;
  readonly supportsReadMemoryRequest?: boolean;
  readonly supportsWriteMemoryRequest?: boolean;
  readonly supportsDisassembleRequest?: boolean;
  readonly supportsCancelRequest?: boolean;
  readonly supportsBreakpointLocationsRequest?: boolean;
  readonly supportsClipboardContext?: boolean;
  readonly supportsSteppingGranularity?: boolean;
  readonly supportsInstructionBreakpoints?: boolean;
  readonly supportsExceptionFilterOptions?: boolean;
  readonly supportsSingleThreadExecutionRequests?: boolean;
  readonly supportsDataBreakpoints?: boolean;
  readonly supportsHitConditionalBreakpoints?: boolean;
  readonly supportsConfigurationDoneRequest?: boolean;
}

/** Options for launching a debug target. */
export interface LaunchOptions {
  readonly program: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}

/** Supported debug target types for attach scenarios. */
export type DebugTargetType = 'node' | 'chrome' | 'msedge' | 'clr';

/** Options for attaching to a running debug target. */
export interface AttachOptions {
  readonly port?: number;
  readonly host?: string;
  readonly processId?: number;
  /** Debug target type — determines the protocol used for attach. */
  readonly debugType?: DebugTargetType;
  /** Root directory of the web application source (for CDP sourcemap resolution). */
  readonly webRoot?: string;
  /** Custom sourcemap path overrides (pattern → local path). */
  readonly sourceMapPathOverrides?: Readonly<Record<string, string>>;
}

/** Interface that all debug adapters must implement. */
export interface IAdapter {
  readonly type: AdapterType;
  readonly languages: readonly LanguageId[];

  launch(config: AdapterConfig, options: LaunchOptions): Promise<void>;
  attach(config: AdapterConfig, options: AttachOptions): Promise<void>;
  disconnect(): Promise<void>;
  terminate(): Promise<void>;
  dispose(): Promise<void>;
  getCapabilities(): AdapterCapabilities;
}

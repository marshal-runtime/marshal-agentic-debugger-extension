// Library public API

// Session layer
export { SessionManager } from './session/index.js';
export type { SessionManagerOptions } from './session/index.js';
export { DebugSession } from './session/index.js';
export { SESSION_STATE_TRANSITIONS } from './session/index.js';
export type { DebugSessionOptions, SessionSnapshot } from './session/index.js';
export { SessionEventType } from './session/index.js';
export type {
  SessionEvent,
  SessionStateChangedEvent,
  SessionErrorEvent,
  SessionEventHandler,
  SessionEventEmitter,
} from './session/index.js';

// Adapter layer
export { AdapterManager } from './adapters/index.js';
export { AdapterRegistry } from './adapters/index.js';
export { detectLanguage } from './adapters/index.js';
export { BaseAdapter } from './adapters/index.js';
export type {
  IAdapter,
  AdapterCapabilities,
  LaunchOptions,
  AttachOptions,
} from './adapters/index.js';

// DAP layer
export { DapClient } from './dap/index.js';
export type { DapClientOptions } from './dap/index.js';
export { DapFramer, CONTENT_LENGTH_HEADER, HEADER_SEPARATOR } from './dap/index.js';
export { DapRouter } from './dap/index.js';
export { DapTimeoutError, DapProtocolError } from './dap/index.js';
export type {
  DapMessage,
  DapMessageType,
  DapRequest,
  DapResponse,
  DapEvent,
  DapEventHandler,
  DapTimeoutConfig,
} from './dap/index.js';
export type {
  Transport,
  TransportConnectOptions,
  DataHandler,
  CloseHandler,
  ErrorHandler,
} from './dap/index.js';
export { StdioTransport } from './dap/index.js';
export type { StdioTransportOptions } from './dap/index.js';
export { TcpTransport } from './dap/index.js';
export type { TcpTransportOptions } from './dap/index.js';

// Types
export { SessionState } from './types/index.js';
export type {
  SessionConfig,
  SessionInfo,
  LanguageId,
  AdapterConfig,
  AdapterType,
  AdapterInfo,
  CommandResult,
  CommandError,
  CommandInput,
} from './types/index.js';
export type {
  LaunchOptions as CommandLaunchOptions,
  AttachOptions as CommandAttachOptions,
} from './types/index.js';

// Config
export { loadConfig, DEFAULT_CONFIG, DEFAULT_REDACTION_PATTERNS } from './config/index.js';
export { configSchema, logLevelSchema, attachPolicySchema } from './config/index.js';
export type { AppConfig } from './config/index.js';

// MCP layer
export { createMcpServer, startMcpServer } from './mcp/index.js';
export type { McpServerOptions, McpOptions } from './mcp/index.js';
export { McpNotificationType, wireNotifications, wireSessionNotifications } from './mcp/index.js';
export type {
  McpNotificationPayload,
  StoppedNotificationPayload,
  ContinuedNotificationPayload,
  TerminatedNotificationPayload,
  OutputNotificationPayload,
  BreakpointNotificationPayload,
  ThreadNotificationPayload,
  McpToolDefinition,
} from './mcp/index.js';

// Marshal runtime extension and bridge
export * from './runtime/index.js';

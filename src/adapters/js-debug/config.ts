import type { AdapterConfig } from '../../types/adapter.js';

/** js-debug DAP launch configuration type for Node.js. */
export const JS_DEBUG_TYPE = 'pwa-node' as const;

/** js-debug DAP attach configuration type for Chrome/Edge CDP. */
export const JS_DEBUG_TYPE_CHROME = 'pwa-chrome' as const;

/** js-debug DAP attach configuration type for Microsoft Edge CDP. */
export const JS_DEBUG_TYPE_MSEDGE = 'pwa-msedge' as const;

/** Valid debug type identifiers for js-debug attach scenarios. */
export type JsDebugType = typeof JS_DEBUG_TYPE | typeof JS_DEBUG_TYPE_CHROME | typeof JS_DEBUG_TYPE_MSEDGE;

/** Default DAP port for js-debug attach sessions (Node.js V8 inspector). */
export const JS_DEBUG_DEFAULT_PORT = 9229;

/** Binary name for the standalone js-debug DAP server. */
export const JS_DEBUG_BINARY = 'js-debug-dap';

/** Well-known VS Code extension paths where js-debug may be bundled. */
export const JS_DEBUG_VSCODE_EXTENSION_PATHS: readonly string[] = [
  '.vscode/extensions/ms-vscode.js-debug/src/dapDebugServer.js',
  '.vscode/extensions/ms-vscode.js-debug-nightly/src/dapDebugServer.js',
];

/** Default configuration for the js-debug adapter. */
export const JS_DEBUG_DEFAULTS: AdapterConfig = {
  language: 'javascript',
  runtime: 'node',
  args: [],
};

/** js-debug launch configuration fields sent via DAP. */
export interface JsDebugLaunchConfig {
  readonly type: typeof JS_DEBUG_TYPE;
  readonly request: 'launch';
  readonly program: string;
  readonly cwd: string;
  readonly args: readonly string[];
  readonly runtimeExecutable: string;
  readonly sourceMaps: boolean;
  readonly resolveSourceMapLocations: readonly string[];
}

/** js-debug attach configuration fields sent via DAP (Node.js V8 inspector). */
export interface JsDebugAttachConfig {
  readonly type: typeof JS_DEBUG_TYPE;
  readonly request: 'attach';
  readonly port: number;
  readonly host: string;
  readonly sourceMaps: boolean;
  readonly resolveSourceMapLocations: readonly string[];
}

/** js-debug attach configuration fields sent via DAP (Chrome/Edge CDP). */
export interface JsDebugCdpAttachConfig {
  readonly type: typeof JS_DEBUG_TYPE_CHROME | typeof JS_DEBUG_TYPE_MSEDGE;
  readonly request: 'attach';
  readonly port: number;
  readonly webRoot: string;
  readonly sourceMaps: boolean;
  readonly urlFilter?: string;
  readonly sourceMapPathOverrides?: Readonly<Record<string, string>>;
}

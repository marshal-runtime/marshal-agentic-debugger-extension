/** Supported language identifiers for debug adapters. */
export type LanguageId = 'javascript' | 'typescript' | 'python' | 'csharp';

/** Configuration for a debug adapter. */
export interface AdapterConfig {
  /** Language this adapter supports. */
  readonly language: LanguageId;
  /** Runtime executable path (e.g., path to node, python). */
  readonly runtime?: string;
  /** Additional adapter-specific arguments. */
  readonly args?: readonly string[];
}

/** Adapter type discriminator for the adapter registry. */
export type AdapterType = 'js-debug' | 'debugpy' | 'netcoredbg' | 'vsdbg' | 'clr-debug';

/** Metadata about a registered adapter. */
export interface AdapterInfo {
  /** Adapter type identifier. */
  readonly type: AdapterType;
  /** Languages this adapter can debug. */
  readonly languages: readonly LanguageId[];
  /** Human-readable adapter name. */
  readonly name: string;
}

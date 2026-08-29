import type { LanguageId } from '../types/adapter.js';
import type { IAdapter } from './types.js';
import { AdapterRegistry } from './registry.js';
import { detectLanguage } from './detector.js';
import { JsDebugAdapter } from './js-debug/index.js';
import { DebugpyAdapter } from './debugpy/index.js';
import { ClrDebugAdapter } from './clr-debug/index.js';

/** Create an AdapterManager with all built-in adapters registered. */
export function createAdapterManager(): AdapterManager {
  const manager = new AdapterManager();

  manager.register(new JsDebugAdapter());
  manager.register(new DebugpyAdapter());
  manager.register(new ClrDebugAdapter());

  return manager;
}

/** Manages adapter registration, lookup, and language detection. */
export class AdapterManager {
  private readonly registry = new AdapterRegistry();

  /** Register an adapter with the manager. */
  register(adapter: IAdapter): void {
    this.registry.register(adapter);
  }

  /** Get an adapter by detecting the language of the given file. */
  async getAdapterForFile(filePath: string): Promise<IAdapter | undefined> {
    const language = await detectLanguage(filePath);
    if (!language) {
      return undefined;
    }
    return this.registry.getByLanguage(language);
  }

  /** Get an adapter for a specific language. */
  getAdapterForLanguage(language: LanguageId): IAdapter | undefined {
    return this.registry.getByLanguage(language);
  }

  /** List all registered adapter types. */
  listAdapters(): ReturnType<AdapterRegistry['list']> {
    return this.registry.list();
  }
}

export { AdapterRegistry } from './registry.js';
export { detectLanguage } from './detector.js';
export { BaseAdapter } from './base-adapter.js';

export type { IAdapter, AdapterCapabilities, LaunchOptions, AttachOptions } from './types.js';

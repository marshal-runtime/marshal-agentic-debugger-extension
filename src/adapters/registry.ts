import type { AdapterType, LanguageId } from '../types/adapter.js';
import type { IAdapter } from './types.js';

/** Static mapping from LanguageId to the AdapterType that handles it. */
const LANGUAGE_ADAPTER_MAP: Readonly<Record<LanguageId, AdapterType>> = {
  typescript: 'js-debug',
  javascript: 'js-debug',
  python: 'debugpy',
  csharp: 'clr-debug',
};

/**
 * Fallback adapter types to try when the primary adapter is not available.
 * C# uses clr-debug exclusively (ICorDebug for .NET Framework 4.x).
 */
const LANGUAGE_ADAPTER_FALLBACKS: Partial<Readonly<Record<LanguageId, readonly AdapterType[]>>> = {};

/** Required method names on a valid IAdapter implementation. */
const REQUIRED_METHODS: ReadonlyArray<keyof IAdapter> = [
  'launch',
  'attach',
  'disconnect',
  'terminate',
  'dispose',
  'getCapabilities',
];

/** Registry for managing debug adapter instances by type and language. */
export class AdapterRegistry {
  private readonly adapters = new Map<AdapterType, IAdapter>();

  /** Register an adapter instance for its declared type. */
  register(adapter: IAdapter): void {
    this.validateAdapter(adapter);

    if (this.adapters.has(adapter.type)) {
      throw new Error(`Adapter already registered for type: ${adapter.type}`);
    }

    this.adapters.set(adapter.type, adapter);
  }

  /** Look up an adapter by its type identifier. */
  get(type: AdapterType): IAdapter | undefined {
    return this.adapters.get(type);
  }

  /**
   * Look up an adapter that supports the given language.
   * Tries the primary adapter first, then falls back to alternatives.
   */
  getByLanguage(language: LanguageId): IAdapter | undefined {
    const adapterType = LANGUAGE_ADAPTER_MAP[language];
    if (!adapterType) {
      return undefined;
    }

    // Try primary adapter
    const primary = this.adapters.get(adapterType);
    if (primary) {
      return primary;
    }

    // Try fallback adapters
    const fallbacks = LANGUAGE_ADAPTER_FALLBACKS[language];
    if (fallbacks) {
      for (const fallbackType of fallbacks) {
        const fallback = this.adapters.get(fallbackType);
        if (fallback) {
          return fallback;
        }
      }
    }

    return undefined;
  }

  /** List all registered adapter types. */
  list(): readonly AdapterType[] {
    return [...this.adapters.keys()];
  }

  /** Validate that an adapter has all required properties and methods. */
  private validateAdapter(adapter: IAdapter): void {
    if (!adapter.type) {
      throw new Error('Adapter must have a type property');
    }

    if (!adapter.languages || !Array.isArray(adapter.languages) || adapter.languages.length === 0) {
      throw new Error('Adapter must have a non-empty languages array');
    }

    for (const method of REQUIRED_METHODS) {
      if (typeof adapter[method] !== 'function') {
        throw new Error(`Adapter missing required method: ${method}`);
      }
    }
  }
}

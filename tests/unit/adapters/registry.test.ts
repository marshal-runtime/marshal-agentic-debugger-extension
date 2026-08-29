import { describe, it, expect, beforeEach } from 'vitest';

import type { AdapterType, LanguageId, AdapterConfig } from '../../../src/types/adapter.js';
import type { AdapterCapabilities, AttachOptions, IAdapter, LaunchOptions } from '../../../src/adapters/types.js';
import { AdapterRegistry } from '../../../src/adapters/registry.js';

function createMockAdapter(
  type: AdapterType,
  languages: readonly LanguageId[],
): IAdapter {
  return {
    type,
    languages,
    launch: async (_config: AdapterConfig, _options: LaunchOptions): Promise<void> => {},
    attach: async (_config: AdapterConfig, _options: AttachOptions): Promise<void> => {},
    disconnect: async (): Promise<void> => {},
    terminate: async (): Promise<void> => {},
    dispose: async (): Promise<void> => {},
    getCapabilities: (): AdapterCapabilities => ({}),
  };
}

describe('AdapterRegistry', () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    registry = new AdapterRegistry();
  });

  it('should register an adapter and retrieve it by type', () => {
    const adapter = createMockAdapter('js-debug', ['typescript', 'javascript']);
    registry.register(adapter);

    expect(registry.get('js-debug')).toBe(adapter);
  });

  it('should return undefined for an unregistered type', () => {
    expect(registry.get('debugpy')).toBeUndefined();
  });

  it('should retrieve an adapter by language', () => {
    const adapter = createMockAdapter('js-debug', ['typescript', 'javascript']);
    registry.register(adapter);

    expect(registry.getByLanguage('typescript')).toBe(adapter);
    expect(registry.getByLanguage('javascript')).toBe(adapter);
  });

  it('should return undefined for an unregistered language', () => {
    expect(registry.getByLanguage('python')).toBeUndefined();
  });

  it('should list all registered adapter types', () => {
    registry.register(createMockAdapter('js-debug', ['typescript', 'javascript']));
    registry.register(createMockAdapter('debugpy', ['python']));

    const types = registry.list();
    expect(types).toContain('js-debug');
    expect(types).toContain('debugpy');
    expect(types).toHaveLength(2);
  });

  it('should reject duplicate adapter registration', () => {
    registry.register(createMockAdapter('js-debug', ['typescript', 'javascript']));

    expect(() => {
      registry.register(createMockAdapter('js-debug', ['typescript']));
    }).toThrow('Adapter already registered for type: js-debug');
  });

  it('should reject an adapter missing required methods', () => {
    const invalid = {
      type: 'js-debug' as AdapterType,
      languages: ['typescript'] as readonly LanguageId[],
      launch: async (): Promise<void> => {},
      // missing attach, disconnect, terminate, dispose, getCapabilities
    } as unknown as IAdapter;

    expect(() => {
      registry.register(invalid);
    }).toThrow('Adapter missing required method');
  });

  it('should reject an adapter with empty languages array', () => {
    const invalid = createMockAdapter('js-debug', []);
    // Override languages to empty
    Object.defineProperty(invalid, 'languages', { value: [] });

    expect(() => {
      registry.register(invalid);
    }).toThrow('Adapter must have a non-empty languages array');
  });

  it('should map multiple languages to different adapters', () => {
    const jsAdapter = createMockAdapter('js-debug', ['typescript', 'javascript']);
    const pyAdapter = createMockAdapter('debugpy', ['python']);
    const csAdapter = createMockAdapter('clr-debug', ['csharp']);

    registry.register(jsAdapter);
    registry.register(pyAdapter);
    registry.register(csAdapter);

    expect(registry.getByLanguage('typescript')).toBe(jsAdapter);
    expect(registry.getByLanguage('python')).toBe(pyAdapter);
    expect(registry.getByLanguage('csharp')).toBe(csAdapter);
  });
});

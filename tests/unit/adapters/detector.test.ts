import { describe, it, expect, vi, beforeEach } from 'vitest';

import { detectLanguage } from '../../../src/adapters/detector.js';

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
}));

import { readdir } from 'node:fs/promises';

const mockedReaddir = vi.mocked(readdir);

describe('detectLanguage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should detect TypeScript from .ts extension', async () => {
    expect(await detectLanguage('/project/src/main.ts')).toBe('typescript');
  });

  it('should detect TypeScript from .tsx extension', async () => {
    expect(await detectLanguage('/project/src/App.tsx')).toBe('typescript');
  });

  it('should detect JavaScript from .js extension', async () => {
    expect(await detectLanguage('/project/src/index.js')).toBe('javascript');
  });

  it('should detect JavaScript from .mjs extension', async () => {
    expect(await detectLanguage('/project/src/module.mjs')).toBe('javascript');
  });

  it('should detect JavaScript from .cjs extension', async () => {
    expect(await detectLanguage('/project/src/config.cjs')).toBe('javascript');
  });

  it('should detect Python from .py extension', async () => {
    expect(await detectLanguage('/project/src/main.py')).toBe('python');
  });

  it('should detect C# from .cs extension', async () => {
    expect(await detectLanguage('/project/src/Program.cs')).toBe('csharp');
  });

  it('should return null for unknown extensions', async () => {
    mockedReaddir.mockRejectedValue(new Error('ENOENT'));
    expect(await detectLanguage('/project/src/README.md')).toBeNull();
  });

  it('should return null for files with no extension', async () => {
    mockedReaddir.mockRejectedValue(new Error('ENOENT'));
    expect(await detectLanguage('/project/Makefile')).toBeNull();
  });

  it('should detect JavaScript from package.json in directory', async () => {
    mockedReaddir.mockResolvedValue(['package.json', 'README.md'] as unknown as Awaited<ReturnType<typeof readdir>>);
    expect(await detectLanguage('/project/config')).toBe('javascript');
  });

  it('should detect C# from .csproj in directory', async () => {
    mockedReaddir.mockResolvedValue(['MyApp.csproj', 'Program.cs'] as unknown as Awaited<ReturnType<typeof readdir>>);
    expect(await detectLanguage('/project/unknown')).toBe('csharp');
  });

  it('should detect Python from pyproject.toml in directory', async () => {
    mockedReaddir.mockResolvedValue(['pyproject.toml', 'src'] as unknown as Awaited<ReturnType<typeof readdir>>);
    expect(await detectLanguage('/project/data')).toBe('python');
  });

  it('should detect Python from requirements.txt in directory', async () => {
    mockedReaddir.mockResolvedValue(['requirements.txt', 'main.py'] as unknown as Awaited<ReturnType<typeof readdir>>);
    expect(await detectLanguage('/project/stuff')).toBe('python');
  });

  it('should return null when directory read fails', async () => {
    mockedReaddir.mockRejectedValue(new Error('ENOENT'));
    expect(await detectLanguage('/nonexistent/file')).toBeNull();
  });

  it('should handle case-insensitive extensions', async () => {
    expect(await detectLanguage('/project/src/Main.TS')).toBe('typescript');
    expect(await detectLanguage('/project/src/App.PY')).toBe('python');
  });
});

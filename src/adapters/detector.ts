import { readdir } from 'node:fs/promises';
import { dirname, extname } from 'node:path';

import type { LanguageId } from '../types/adapter.js';

/** File extension to language mapping. */
const EXTENSION_MAP = new Map<string, LanguageId>([
  ['.ts', 'typescript'],
  ['.tsx', 'typescript'],
  ['.js', 'javascript'],
  ['.jsx', 'javascript'],
  ['.mjs', 'javascript'],
  ['.cjs', 'javascript'],
  ['.py', 'python'],
  ['.cs', 'csharp'],
]);

/** Project structure files that indicate a language. */
const PROJECT_FILE_PATTERNS: ReadonlyArray<{ pattern: string | RegExp; language: LanguageId }> = [
  { pattern: 'package.json', language: 'javascript' },
  { pattern: /\.csproj$/, language: 'csharp' },
  { pattern: 'pyproject.toml', language: 'python' },
  { pattern: 'requirements.txt', language: 'python' },
];

/**
 * Detect the language of a file based on its extension.
 * Falls back to project structure detection when the extension is unknown.
 */
export async function detectLanguage(filePath: string): Promise<LanguageId | null> {
  const ext = extname(filePath).toLowerCase();
  const mapped = EXTENSION_MAP.get(ext);

  if (mapped) {
    return mapped;
  }

  return detectFromProjectStructure(dirname(filePath));
}

/** Scan the directory for known project structure files. */
async function detectFromProjectStructure(directory: string): Promise<LanguageId | null> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return null;
  }

  for (const { pattern, language } of PROJECT_FILE_PATTERNS) {
    if (typeof pattern === 'string') {
      if (entries.includes(pattern)) {
        return language;
      }
    } else {
      if (entries.some((entry) => pattern.test(entry))) {
        return language;
      }
    }
  }

  return null;
}

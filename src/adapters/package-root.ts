import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolvePackageRoot(moduleUrl: string): string {
  let candidate = dirname(fileURLToPath(moduleUrl));
  while (true) {
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) {
      throw new Error('Unable to resolve the agentic debugger package root.');
    }
    candidate = parent;
  }
}

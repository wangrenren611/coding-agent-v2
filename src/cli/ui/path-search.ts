import path from 'node:path';
import { promises as fs } from 'node:fs';

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  '.next',
  '.idea',
  '.vscode',
  '.pnpm-store',
]);

async function collectPathsRecursive(
  root: string,
  dir: string,
  depth: number,
  maxDepth: number,
  out: string[],
  maxItems: number
): Promise<void> {
  if (out.length >= maxItems || depth > maxDepth) {
    return;
  }

  let entries: Array<import('node:fs').Dirent>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (out.length >= maxItems) {
      return;
    }

    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      await collectPathsRecursive(root, abs, depth + 1, maxDepth, out, maxItems);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    out.push(rel);
  }
}

export async function buildPathIndex(cwd: string, maxItems = 6000): Promise<string[]> {
  const out: string[] = [];
  await collectPathsRecursive(cwd, cwd, 0, 8, out, maxItems);
  return out;
}

export function searchPathIndex(index: string[], query: string, maxResults = 40): string[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return index.slice(0, maxResults);
  }

  const starts = index.filter((item) => item.toLowerCase().startsWith(q));
  const includes = index.filter(
    (item) => !item.toLowerCase().startsWith(q) && item.toLowerCase().includes(q)
  );
  return [...starts, ...includes].slice(0, maxResults);
}

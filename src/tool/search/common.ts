import fs from 'fs/promises';
import type { Dirent } from 'fs';
import path from 'path';
import { minimatch } from 'minimatch';
import { expandHome, normalizePath } from '../file/path-utils';
import { isPathWithinAllowedDirectories } from '../file/path-validation';

export const DEFAULT_IGNORE_GLOBS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.git/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/build/**',
  '**/*.min.js',
  '**/*.min.css',
];

export interface SearchPathOptions {
  requestedPath?: string;
  allowedDirectories: string[];
}

export interface SearchPathResolved {
  rootPath: string;
  allowedDirectories: string[];
}

export function normalizeAllowedDirectories(inputDirs: string[]): string[] {
  const directories = inputDirs.length > 0 ? inputDirs : [process.cwd()];
  return directories.map((dir) => {
    const expanded = expandHome(dir);
    const resolved = path.resolve(expanded);
    return normalizePath(resolved);
  });
}

export async function resolveSearchRoot(options: SearchPathOptions): Promise<SearchPathResolved> {
  const allowedDirectories = normalizeAllowedDirectories(options.allowedDirectories);

  const requested = options.requestedPath?.trim() ? options.requestedPath : '.';
  const expanded = expandHome(requested);
  const absolute = path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(process.cwd(), expanded);
  const normalizedAbsolute = normalizePath(absolute);

  if (!isPathWithinAllowedDirectories(normalizedAbsolute, allowedDirectories)) {
    throw new Error(
      `SEARCH_PATH_NOT_ALLOWED: ${normalizedAbsolute} is outside allowed directories: ${allowedDirectories.join(', ')}`
    );
  }

  let stats;
  try {
    stats = await fs.stat(normalizedAbsolute);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(`SEARCH_PATH_NOT_FOUND: ${normalizedAbsolute}`);
    }
    if (code === 'EACCES' || code === 'EPERM') {
      throw new Error(`SEARCH_PATH_NO_PERMISSION: ${normalizedAbsolute}`);
    }
    throw error;
  }

  if (!stats.isDirectory()) {
    throw new Error(`SEARCH_PATH_NOT_DIRECTORY: ${normalizedAbsolute}`);
  }

  return {
    rootPath: normalizedAbsolute,
    allowedDirectories,
  };
}

export interface TraverseFile {
  absolutePath: string;
  relativePath: string;
}

export async function collectFilesByGlob(options: {
  rootPath: string;
  pattern: string;
  includeHidden: boolean;
  ignorePatterns: string[];
  maxResults: number;
}): Promise<{ files: TraverseFile[]; truncated: boolean }> {
  const files: TraverseFile[] = [];
  const queue = [options.rootPath];
  const visited = new Set<string>();
  let truncated = false;

  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir) {
      continue;
    }

    let realDir: string;
    try {
      realDir = await fs.realpath(currentDir);
    } catch {
      continue;
    }
    if (visited.has(realDir)) {
      continue;
    }
    visited.add(realDir);

    let entries: Dirent[];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (!options.includeHidden && entry.name.startsWith('.')) {
        continue;
      }

      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path.relative(options.rootPath, absolutePath).split(path.sep).join('/');
      if (!relativePath || relativePath === '.') {
        continue;
      }

      const ignored = options.ignorePatterns.some((ignorePattern) =>
        minimatch(relativePath, ignorePattern, { dot: options.includeHidden })
      );
      if (ignored) {
        continue;
      }

      if (entry.isDirectory()) {
        queue.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      if (!minimatch(relativePath, options.pattern, { dot: options.includeHidden })) {
        continue;
      }

      files.push({ absolutePath, relativePath });
      if (files.length >= options.maxResults) {
        truncated = true;
        return { files, truncated };
      }
    }
  }

  return { files, truncated };
}

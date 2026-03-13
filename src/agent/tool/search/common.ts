import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import { minimatch } from 'minimatch';
import {
  ensurePathWithinAllowed,
  normalizeAllowedDirectories,
  resolveRequestedPath,
} from '../path-security';

export const DEFAULT_IGNORE_GLOBS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/coverage/**',
  '**/*.min.js',
  '**/*.min.css',
];

export interface SearchPathOptions {
  requestedPath?: string;
  allowedDirectories?: string[];
}

export interface SearchPathResolved {
  rootPath: string;
  allowedDirectories: string[];
}

export interface TraverseFile {
  absolutePath: string;
  relativePath: string;
}

export async function resolveSearchRoot(options: SearchPathOptions): Promise<SearchPathResolved> {
  const allowedDirectories = normalizeAllowedDirectories(options.allowedDirectories);
  const requestedPath = options.requestedPath?.trim().length
    ? options.requestedPath
    : process.cwd();
  const absolute = resolveRequestedPath(requestedPath);
  const validated = ensurePathWithinAllowed(
    absolute,
    allowedDirectories,
    'SEARCH_PATH_NOT_ALLOWED'
  );

  let stats: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stats = await fs.stat(validated);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') {
      throw new Error(`SEARCH_PATH_NOT_FOUND: ${validated}`);
    }
    if (nodeError.code === 'EACCES' || nodeError.code === 'EPERM') {
      throw new Error(`SEARCH_PATH_NO_PERMISSION: ${validated}`);
    }
    throw error;
  }

  if (!stats.isDirectory()) {
    throw new Error(`SEARCH_PATH_NOT_DIRECTORY: ${validated}`);
  }

  return {
    rootPath: validated,
    allowedDirectories,
  };
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
    const current = queue.shift();
    if (!current) {
      continue;
    }

    let realCurrent: string;
    try {
      realCurrent = await fs.realpath(current);
    } catch {
      continue;
    }

    if (visited.has(realCurrent)) {
      continue;
    }
    visited.add(realCurrent);

    let entries: Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (!options.includeHidden && entry.name.startsWith('.')) {
        continue;
      }

      const absolutePath = path.join(current, entry.name);
      const relativePath = path.relative(options.rootPath, absolutePath).split(path.sep).join('/');
      if (!relativePath || relativePath === '.') {
        continue;
      }

      const ignored = options.ignorePatterns.some((pattern) =>
        minimatch(relativePath, pattern, { dot: options.includeHidden })
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

import { readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { resolveWorkspaceRoot } from '../agent/runtime/source-modules';
import type { PromptFileSelection } from './types';

const IGNORED_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
]);

const comparePaths = (a: PromptFileSelection, b: PromptFileSelection) => {
  return a.relativePath.localeCompare(b.relativePath);
};

const visitDirectory = async (
  root: string,
  directory: string,
  output: PromptFileSelection[]
): Promise<void> => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);

  const sortedEntries = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of sortedEntries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIR_NAMES.has(entry.name)) {
        continue;
      }
      await visitDirectory(root, absolutePath, output);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const fileStat = await stat(absolutePath).catch(() => undefined);
    if (!fileStat || !fileStat.isFile()) {
      continue;
    }

    output.push({
      relativePath: relative(root, absolutePath),
      absolutePath,
      size: fileStat.size,
    });
  }
};

export const listWorkspaceFiles = async (): Promise<PromptFileSelection[]> => {
  const workspaceRoot = resolveWorkspaceRoot();
  const files: PromptFileSelection[] = [];
  await visitDirectory(workspaceRoot, workspaceRoot, files);
  return files.sort(comparePaths);
};

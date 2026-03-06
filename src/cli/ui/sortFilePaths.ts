import { extname } from 'node:path';

const LANGUAGE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'py',
  'go',
  'rs',
  'java',
  'c',
  'cpp',
  'h',
  'hpp',
  'rb',
  'swift',
  'kt',
  'scala',
  'cs',
  'php',
  'vue',
  'svelte',
]);

const DOC_CONFIG_EXTENSIONS = new Set(['md', 'txt', 'rst', 'adoc', 'json', 'yaml', 'yml', 'toml']);

function getExtension(filePath: string): string {
  const ext = extname(filePath);
  return ext.startsWith('.') ? ext.slice(1) : ext;
}

function getCategoryPriority(filePath: string): number {
  const ext = getExtension(filePath).toLowerCase();
  if (LANGUAGE_EXTENSIONS.has(ext)) {
    return 0;
  }
  if (DOC_CONFIG_EXTENSIONS.has(ext)) {
    return 2;
  }
  return 1;
}

function getRelevanceScore(filePath: string, query: string): number {
  if (!query) {
    return 3;
  }

  const lowerPath = filePath.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const parts = lowerPath.split('/');
  const fileName = parts[parts.length - 1] ?? '';

  if (fileName.startsWith(lowerQuery)) {
    return 0;
  }
  if (lowerPath.startsWith(lowerQuery)) {
    return 1;
  }
  if (fileName.includes(lowerQuery)) {
    return 2;
  }
  return 3;
}

export function sortFilePaths(paths: string[], query: string): string[] {
  return [...paths].sort((left, right) => {
    const leftCategory = getCategoryPriority(left);
    const rightCategory = getCategoryPriority(right);
    if (leftCategory !== rightCategory) {
      return leftCategory - rightCategory;
    }

    const leftRelevance = getRelevanceScore(left, query);
    const rightRelevance = getRelevanceScore(right, query);
    if (leftRelevance !== rightRelevance) {
      return leftRelevance - rightRelevance;
    }

    return left.localeCompare(right);
  });
}

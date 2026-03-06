import { describe, expect, test } from 'vitest';
import { sortFilePaths } from './sortFilePaths';

describe('sortFilePaths', () => {
  test('prioritizes language files over docs and configs', () => {
    const paths = ['README.md', 'package.json', 'src/index.ts'];
    expect(sortFilePaths(paths, '')).toEqual(['src/index.ts', 'package.json', 'README.md']);
  });

  test('prioritizes filename prefix matches', () => {
    const paths = ['src/utils/store.ts', 'src/dataStore.ts', 'src/store.ts'];
    const result = sortFilePaths(paths, 'store');
    expect(result).toEqual(['src/store.ts', 'src/utils/store.ts', 'src/dataStore.ts']);
  });

  test('does not mutate original array', () => {
    const paths = ['README.md', 'src/index.ts'];
    const original = [...paths];
    sortFilePaths(paths, 'index');
    expect(paths).toEqual(original);
  });
});

import { describe, expect, test } from 'vitest';
import { looksLikeDiff } from './DiffViewer';
import { hasTodoList } from './Todo';

describe('message render helpers', () => {
  test('detects diff-like content', () => {
    expect(looksLikeDiff('diff --git a/a.ts b/a.ts\n@@ -1 +1 @@')).toBe(true);
    expect(looksLikeDiff('```diff\n+ hello\n```')).toBe(true);
    expect(looksLikeDiff('plain text')).toBe(false);
  });

  test('detects markdown todo list', () => {
    expect(hasTodoList('- [ ] first\n- [x] done')).toBe(true);
    expect(hasTodoList('1. item\n2. item')).toBe(false);
  });
});

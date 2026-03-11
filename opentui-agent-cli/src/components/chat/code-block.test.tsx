import { describe, expect, it } from 'vitest';

import {
  CodeBlock,
  extractDiffPath,
  inferCodeFiletype,
  inferFiletypeFromPath,
  looksLikeDiff,
} from './code-block';

type ElementLike = {
  type: unknown;
  props?: {
    children?: unknown;
    [key: string]: unknown;
  };
};

const isElementLike = (value: unknown): value is ElementLike => {
  return (
    Boolean(value) && typeof value === 'object' && 'type' in (value as Record<string, unknown>)
  );
};

const findElementByType = (node: unknown, targetType: string): ElementLike | null => {
  if (!node) {
    return null;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElementByType(child, targetType);
      if (match) {
        return match;
      }
    }
    return null;
  }

  if (!isElementLike(node)) {
    return null;
  }

  if (typeof node.type === 'function') {
    return findElementByType(
      (node.type as (props: object) => unknown)(node.props ?? {}),
      targetType
    );
  }

  if (node.type === targetType) {
    return node;
  }

  return findElementByType(node.props?.children, targetType);
};

describe('CodeBlock', () => {
  it('detects unified diff content and extracts the changed path', () => {
    const diff = [
      'diff --git a/src/App.tsx b/src/App.tsx',
      '--- a/src/App.tsx',
      '+++ b/src/App.tsx',
      '@@ -1,2 +1,2 @@',
      '-const before = true;',
      '+const after = true;',
    ].join('\n');

    expect(looksLikeDiff(diff)).toBe(true);
    expect(extractDiffPath(diff)).toBe('src/App.tsx');
    expect(inferCodeFiletype(diff)).toBe('diff');
    expect(inferFiletypeFromPath('src/App.tsx')).toBe('tsx');
  });

  it('infers json and bash snippets without explicit metadata', () => {
    expect(inferCodeFiletype('{\n  "name": "demo"\n}')).toBe('json');
    expect(inferCodeFiletype('$ pnpm test\n$ pnpm lint')).toBe('bash');
  });

  it('renders diff snippets with the OpenTUI diff component', () => {
    const tree = CodeBlock({
      label: 'output',
      content: ['--- a/a.ts', '+++ b/a.ts', '@@ -1 +1 @@', '-a', '+b'].join('\n'),
    });

    const diffNode = findElementByType(tree, 'diff');

    expect(diffNode).not.toBeNull();
    expect(diffNode?.props?.view).toBe('unified');
    expect(diffNode?.props?.showLineNumbers).toBe(true);
  });

  it('renders regular snippets with the OpenTUI code component', () => {
    const tree = CodeBlock({
      label: 'arguments',
      content: '{\n  "timeout": 1000\n}',
      languageHint: 'json',
    });

    const codeNode = findElementByType(tree, 'code');

    expect(codeNode).not.toBeNull();
    expect(codeNode?.props?.filetype).toBe('json');
  });
});

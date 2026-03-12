import { describe, expect, it } from 'vitest';

import type { ReplySegment } from '../../types/chat';
import { AssistantSegment } from './assistant-segment';

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

describe('AssistantSegment', () => {
  it('renders text segments with markdown renderable and finalized streaming state', () => {
    const segment: ReplySegment = {
      id: '1:text:1',
      type: 'text',
      content: '## Summary\n\n| a | b |\n|---|---|\n| 1 | 2 |',
    };

    const tree = AssistantSegment({ segment, streaming: false });
    const markdownNode = findElementByType(tree, 'markdown');

    expect(markdownNode).not.toBeNull();
    expect(markdownNode?.props?.content).toBe(segment.content);
    expect(markdownNode?.props?.streaming).toBe(false);
    expect(markdownNode?.props?.conceal).toBe(true);
    expect(typeof markdownNode?.props?.renderNode).toBe('function');
  });

  it('renders thinking segments with markdown renderable', () => {
    const segment: ReplySegment = {
      id: '1:thinking:1',
      type: 'thinking',
      content: '先整理一下结论。',
    };

    const tree = AssistantSegment({ segment, streaming: true });
    const markdownNode = findElementByType(tree, 'markdown');

    expect(markdownNode).not.toBeNull();
    expect(markdownNode?.props?.content).toBe('_Thinking:_ 先整理一下结论。');
    expect(markdownNode?.props?.streaming).toBe(true);
  });

  it('renders code segments with the OpenTUI code renderable', () => {
    const segment: ReplySegment = {
      id: '1:code:1',
      type: 'code',
      content: '{\n  "ok": true\n}',
    };

    const tree = AssistantSegment({ segment, streaming: false });
    const codeNode = findElementByType(tree, 'code');

    expect(codeNode).not.toBeNull();
    expect(codeNode?.props?.filetype).toBe('json');
  });
});

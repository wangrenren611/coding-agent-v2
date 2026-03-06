import { describe, expect, test } from 'vitest';
import { mergeAssistantText, shouldStartNewAssistantMessage } from './assistant-text';

describe('mergeAssistantText', () => {
  test('uses final text when stream is a prefix', () => {
    const streamed = '<think>\n用户';
    const finalText =
      '<think>\n用户用中文打招呼，我应该用中文回复。\n</think>\n\n你好！有什么我可以帮助你的吗？';
    expect(mergeAssistantText(streamed, finalText)).toBe(finalText);
  });

  test('keeps streamed text when it is more complete', () => {
    const finalText = '你好';
    const streamed = '你好！有什么我可以帮助你的吗？';
    expect(mergeAssistantText(streamed, finalText)).toBe(streamed);
  });

  test('merges by suffix-prefix overlap', () => {
    const streamed = 'abc123';
    const finalText = '123xyz';
    expect(mergeAssistantText(streamed, finalText)).toBe('abc123xyz');
  });

  test('splits assistant message when step ends with tool_calls', () => {
    expect(
      shouldStartNewAssistantMessage({
        finishReason: 'tool_calls',
        toolCallsCount: 1,
      })
    ).toBe(true);
  });

  test('does not split assistant message for final stop step', () => {
    expect(
      shouldStartNewAssistantMessage({
        finishReason: 'stop',
        toolCallsCount: 0,
      })
    ).toBe(false);
  });
});

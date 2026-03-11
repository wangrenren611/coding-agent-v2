import { describe, expect, it } from 'vitest';

import type { AssistantReply as AssistantReplyType } from '../../types/chat';
import { buildUsageItems, getCompletionErrorMessage } from './assistant-reply';

const createReply = (
  overrides: Partial<AssistantReplyType> = {}
): AssistantReplyType => ({
  agentLabel: '',
  modelLabel: 'glm-5',
  durationSeconds: 0.8,
  segments: [],
  status: 'done',
  ...overrides,
});

describe('assistant-reply helpers', () => {
  it('extracts completion error messages for error replies', () => {
    const reply = createReply({
      status: 'error',
      completionReason: 'error',
      completionMessage: 'Server returned 500: upstream provider timeout',
    });

    expect(getCompletionErrorMessage(reply)).toBe(
      'Server returned 500: upstream provider timeout'
    );
  });

  it('ignores completion messages for non-error replies', () => {
    const reply = createReply({
      status: 'done',
      completionReason: 'stop',
      completionMessage: 'Should not be shown',
    });

    expect(getCompletionErrorMessage(reply)).toBeUndefined();
  });

  it('keeps usage items compact and directional', () => {
    const reply = createReply({
      usagePromptTokens: 1250,
      usageCompletionTokens: 2400,
    });

    expect(buildUsageItems(reply)).toEqual([
      { icon: '↓', value: '1.3k' },
      { icon: '↑', value: '2.4k' },
    ]);
  });
});

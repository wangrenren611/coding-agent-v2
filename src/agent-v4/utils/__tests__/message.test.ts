import { describe, expect, it } from 'vitest';
import type { Message } from '../../types';
import {
  contentToText,
  getAssistantToolCalls,
  getToolCallId,
  isSummaryMessage,
  processToolCallPairs,
  rebuildMessages,
  splitMessages,
  stringifyContentPart,
} from '../message';

function createMessage(partial: Partial<Message>): Message {
  return {
    messageId: partial.messageId || crypto.randomUUID(),
    type: partial.type || 'assistant-text',
    role: partial.role || 'assistant',
    content: partial.content || '',
    timestamp: partial.timestamp ?? Date.now(),
    ...partial,
  };
}

describe('message utils', () => {
  it('contentToText handles empty, string and multimodal content', () => {
    expect(contentToText(undefined)).toBe('');
    expect(contentToText('hello')).toBe('hello');

    expect(
      contentToText([
        { type: 'text', text: 'line1' },
        { type: 'image_url', image_url: { url: 'http://img' } },
        { type: 'file', file: { filename: 'a.txt' } },
        { type: 'input_audio', input_audio: { data: 'x', format: 'mp3' } },
        { type: 'input_video', input_video: { file_id: 'v1' } },
      ])
    ).toBe('line1\n[image] http://img\n[file] a.txt\n[audio]\n[video] v1');
  });

  it('stringifyContentPart returns empty string for unknown part', () => {
    expect(stringifyContentPart({ type: 'text', text: 'x' })).toBe('x');
    expect(stringifyContentPart({ type: 'image_url', image_url: { url: 'u' } })).toBe('[image] u');
    expect(stringifyContentPart({ type: 'file', file: { file_id: 'f1' } })).toBe('[file] f1');
    expect(stringifyContentPart({ type: 'input_audio', input_audio: { data: 'd', format: 'wav' } })).toBe(
      '[audio]'
    );
    expect(stringifyContentPart({ type: 'input_video', input_video: { url: 'v' } })).toBe('[video] v');
    expect(stringifyContentPart({ type: 'unknown' } as never)).toBe('');
  });

  it('assistant tool call and tool_call_id helpers return expected values', () => {
    const assistantWithCalls = createMessage({
      role: 'assistant',
      type: 'tool-call',
      tool_calls: [
        { id: 'call_1', type: 'function', index: 0, function: { name: 'x', arguments: '{}' } },
        { id: 'call_2', type: 'function', index: 1, function: { name: 'y', arguments: '{}' } },
      ],
    });
    const toolMessage = createMessage({
      role: 'tool',
      type: 'tool-result',
      tool_call_id: 'call_1',
      content: 'ok',
    });
    const userMessage = createMessage({ role: 'user', type: 'user', content: 'u' });

    expect(getAssistantToolCalls(assistantWithCalls)).toEqual([{ id: 'call_1' }, { id: 'call_2' }]);
    expect(getAssistantToolCalls(userMessage)).toEqual([]);
    expect(getToolCallId(toolMessage)).toBe('call_1');
    expect(getToolCallId(userMessage)).toBeUndefined();
  });

  it('recognizes summary message prefixes', () => {
    expect(
      isSummaryMessage(
        createMessage({
          role: 'assistant',
          type: 'summary',
          content: '[Conversation Summary]\nabc',
        })
      )
    ).toBe(true);
    expect(
      isSummaryMessage(
        createMessage({
          role: 'assistant',
          type: 'summary',
          content: '[对话摘要]\nabc',
        })
      )
    ).toBe(true);
    expect(isSummaryMessage(createMessage({ role: 'assistant', type: 'assistant-text', content: 'normal' }))).toBe(
      false
    );
  });

  it('splitMessages preserves system and adjusts split point to last user', () => {
    const messages: Message[] = [
      createMessage({ messageId: 's', type: 'system', role: 'system', content: 'sys', timestamp: 1 }),
      createMessage({ messageId: 'a0', type: 'assistant-text', role: 'assistant', content: 'a0', timestamp: 2 }),
      createMessage({ messageId: 'u1', type: 'user', role: 'user', content: 'u1', timestamp: 3 }),
      createMessage({ messageId: 'a2', type: 'assistant-text', role: 'assistant', content: 'a2', timestamp: 4 }),
      createMessage({ messageId: 'a3', type: 'assistant-text', role: 'assistant', content: 'a3', timestamp: 5 }),
    ];

    const result = splitMessages(messages, 1);
    expect(result.systemMessage?.messageId).toBe('s');
    expect(result.pending.map((m) => m.messageId)).toEqual(['a0']);
    expect(result.active.map((m) => m.messageId)).toEqual(['u1', 'a2', 'a3']);
  });

  it('processToolCallPairs keeps assistant/tool pairs together', () => {
    const assistantPending = createMessage({
      messageId: 'a_pending',
      role: 'assistant',
      type: 'tool-call',
      tool_calls: [{ id: 'c1', type: 'function', index: 0, function: { name: 'bash', arguments: '{}' } }],
    });
    const pendingTool = createMessage({
      messageId: 't_pending',
      role: 'tool',
      type: 'tool-result',
      tool_call_id: 'c1',
      content: 'pending',
    });
    const pendingUser = createMessage({ messageId: 'u_pending', role: 'user', type: 'user', content: 'u' });
    const activeTool = createMessage({
      messageId: 't_active',
      role: 'tool',
      type: 'tool-result',
      tool_call_id: 'c1',
      content: 'active',
    });
    const activeUser = createMessage({ messageId: 'u_active', role: 'user', type: 'user', content: 'u2' });

    const result = processToolCallPairs(
      [assistantPending, pendingTool, pendingUser],
      [activeTool, activeUser]
    );

    expect(result.pending.map((m) => m.messageId)).toEqual(['u_pending']);
    expect(result.active.map((m) => m.messageId)).toEqual(['a_pending', 't_active', 'u_active']);
  });

  it('processToolCallPairs returns original arrays when no active tools need pairing', () => {
    const pending = [createMessage({ messageId: 'p1', role: 'user', type: 'user', content: 'p1' })];
    const active = [createMessage({ messageId: 'a1', role: 'assistant', type: 'assistant-text', content: 'a1' })];
    const result = processToolCallPairs(pending, active);
    expect(result.pending).toBe(pending);
    expect(result.active).toBe(active);
  });

  it('rebuildMessages combines system, summary and active messages in order', () => {
    const system = createMessage({ messageId: 's', role: 'system', type: 'system', content: 'sys' });
    const summary = createMessage({ messageId: 'sum', role: 'assistant', type: 'summary', content: 'summary' });
    const active = [
      createMessage({ messageId: 'u1', role: 'user', type: 'user', content: 'u1' }),
      createMessage({ messageId: 'a1', role: 'assistant', type: 'assistant-text', content: 'a1' }),
    ];

    expect(rebuildMessages(system, summary, active).map((m) => m.messageId)).toEqual(['s', 'sum', 'u1', 'a1']);
    expect(rebuildMessages(undefined, null, active).map((m) => m.messageId)).toEqual(['u1', 'a1']);
  });
});


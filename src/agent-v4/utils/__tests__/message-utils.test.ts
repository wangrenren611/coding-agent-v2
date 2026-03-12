import { describe, expect, it } from 'vitest';
import {
  contentToText,
  stringifyContentPart,
  getAssistantToolCalls,
  getToolCallId,
  isSummaryMessage,
  splitMessages,
  processToolCallPairs,
  rebuildMessages,
} from '../message';
import type { Message } from '../../types';

const createMessage = (overrides: Partial<Message> = {}): Message => ({
  messageId: 'msg_1',
  type: 'user',
  role: 'user',
  content: '',
  timestamp: Date.now(),
  ...overrides,
});

describe('contentToText', () => {
  it('returns empty string for undefined content', () => {
    expect(contentToText(undefined)).toBe('');
  });

  it('returns string content as-is', () => {
    expect(contentToText('Hello')).toBe('Hello');
  });

  it('returns empty string for empty string', () => {
    expect(contentToText('')).toBe('');
  });

  it('converts array of content parts', () => {
    const content = [
      { type: 'text' as const, text: 'Hello' },
      { type: 'text' as const, text: 'World' },
    ];
    expect(contentToText(content)).toBe('Hello\nWorld');
  });

  it('filters out empty parts', () => {
    const content = [
      { type: 'text' as const, text: 'Hello' },
      { type: 'text' as const, text: '' },
      { type: 'text' as const, text: 'World' },
    ];
    expect(contentToText(content)).toBe('Hello\nWorld');
  });

  it('handles mixed content types', () => {
    const content = [
      { type: 'text' as const, text: 'Text' },
      { type: 'image_url' as const, image_url: { url: 'http://example.com/image.png' } },
    ];
    expect(contentToText(content)).toBe('Text\n[image] http://example.com/image.png');
  });

  it('returns empty string for non-string, non-array content', () => {
    expect(contentToText(123 as any)).toBe('');
    expect(contentToText({} as any)).toBe('');
    expect(contentToText(null as any)).toBe('');
  });

  it('handles empty array', () => {
    expect(contentToText([])).toBe('');
  });
});

describe('stringifyContentPart', () => {
  it('stringifies text part', () => {
    expect(stringifyContentPart({ type: 'text', text: 'Hello' })).toBe('Hello');
  });

  it('handles text part with empty text', () => {
    expect(stringifyContentPart({ type: 'text', text: '' })).toBe('');
  });

  it('handles text part with undefined text', () => {
    expect(stringifyContentPart({ type: 'text', text: undefined as any })).toBe('');
  });

  it('stringifies image_url part', () => {
    expect(
      stringifyContentPart({
        type: 'image_url',
        image_url: { url: 'http://example.com/image.png' },
      })
    ).toBe('[image] http://example.com/image.png');
  });

  it('handles image_url part with empty url', () => {
    expect(
      stringifyContentPart({
        type: 'image_url',
        image_url: { url: '' },
      })
    ).toBe('[image]');
  });

  it('handles image_url part with undefined url', () => {
    expect(
      stringifyContentPart({
        type: 'image_url',
        image_url: { url: undefined as any },
      })
    ).toBe('[image]');
  });

  it('handles image_url part with undefined image_url', () => {
    expect(
      stringifyContentPart({
        type: 'image_url',
        image_url: undefined as any,
      })
    ).toBe('[image]');
  });

  it('stringifies file part with filename', () => {
    expect(
      stringifyContentPart({
        type: 'file',
        file: { filename: 'document.pdf' },
      })
    ).toBe('[file] document.pdf');
  });

  it('stringifies file part with file_id', () => {
    expect(
      stringifyContentPart({
        type: 'file',
        file: { file_id: 'file_123' },
      })
    ).toBe('[file] file_123');
  });

  it('prefers filename over file_id', () => {
    expect(
      stringifyContentPart({
        type: 'file',
        file: { filename: 'document.pdf', file_id: 'file_123' },
      })
    ).toBe('[file] document.pdf');
  });

  it('handles file part with empty file', () => {
    expect(
      stringifyContentPart({
        type: 'file',
        file: {} as any,
      })
    ).toBe('[file]');
  });

  it('handles file part with undefined file', () => {
    expect(
      stringifyContentPart({
        type: 'file',
        file: undefined as any,
      })
    ).toBe('[file]');
  });

  it('stringifies input_audio part', () => {
    expect(
      stringifyContentPart({ type: 'input_audio', input_audio: { data: 'test', format: 'wav' } })
    ).toBe('[audio]');
  });

  it('stringifies input_video part with url', () => {
    expect(
      stringifyContentPart({
        type: 'input_video',
        input_video: { url: 'http://example.com/video.mp4' },
      })
    ).toBe('[video] http://example.com/video.mp4');
  });

  it('stringifies input_video part with file_id', () => {
    expect(
      stringifyContentPart({
        type: 'input_video',
        input_video: { file_id: 'video_123' },
      })
    ).toBe('[video] video_123');
  });

  it('prefers url over file_id for video', () => {
    expect(
      stringifyContentPart({
        type: 'input_video',
        input_video: { url: 'http://example.com/video.mp4', file_id: 'video_123' },
      })
    ).toBe('[video] http://example.com/video.mp4');
  });

  it('handles input_video part with empty input_video', () => {
    expect(
      stringifyContentPart({
        type: 'input_video',
        input_video: {} as any,
      })
    ).toBe('[video]');
  });

  it('handles input_video part with undefined input_video', () => {
    expect(
      stringifyContentPart({
        type: 'input_video',
        input_video: undefined as any,
      })
    ).toBe('[video]');
  });

  it('returns empty string for unknown type', () => {
    expect(stringifyContentPart({ type: 'unknown' } as any)).toBe('');
  });
});

describe('getAssistantToolCalls', () => {
  it('returns empty array for non-assistant messages', () => {
    expect(getAssistantToolCalls(createMessage({ role: 'user', content: 'Hello' }))).toEqual([]);
    expect(getAssistantToolCalls(createMessage({ role: 'system', content: 'System' }))).toEqual([]);
    expect(
      getAssistantToolCalls(
        createMessage({ role: 'tool', content: 'Result', tool_call_id: 'call_1' })
      )
    ).toEqual([]);
  });

  it('returns empty array for assistant message without tool_calls', () => {
    expect(getAssistantToolCalls(createMessage({ role: 'assistant', content: 'Hello' }))).toEqual(
      []
    );
  });

  it('returns empty array for assistant message with null tool_calls', () => {
    expect(
      getAssistantToolCalls(
        createMessage({ role: 'assistant', content: '', tool_calls: null as any })
      )
    ).toEqual([]);
  });

  it('returns empty array for assistant message with non-array tool_calls', () => {
    expect(
      getAssistantToolCalls(
        createMessage({ role: 'assistant', content: '', tool_calls: 'invalid' as any })
      )
    ).toEqual([]);
  });

  it('returns empty array for assistant message with empty tool_calls', () => {
    expect(
      getAssistantToolCalls(createMessage({ role: 'assistant', content: '', tool_calls: [] }))
    ).toEqual([]);
  });

  it('returns tool calls for assistant message', () => {
    const message = createMessage({
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'call_1', type: 'function', index: 0, function: { name: 'test', arguments: '{}' } },
        { id: 'call_2', type: 'function', index: 1, function: { name: 'test2', arguments: '{}' } },
      ],
    });

    const result = getAssistantToolCalls(message);
    expect(result).toEqual([{ id: 'call_1' }, { id: 'call_2' }]);
  });

  it('handles tool calls without id', () => {
    const message = createMessage({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: undefined as any,
          type: 'function',
          index: 0,
          function: { name: 'test', arguments: '{}' },
        },
      ],
    });

    const result = getAssistantToolCalls(message);
    expect(result).toEqual([{ id: undefined }]);
  });
});

describe('getToolCallId', () => {
  it('returns undefined for non-tool messages', () => {
    expect(getToolCallId(createMessage({ role: 'user', content: 'Hello' }))).toBeUndefined();
    expect(getToolCallId(createMessage({ role: 'assistant', content: 'Hello' }))).toBeUndefined();
    expect(getToolCallId(createMessage({ role: 'system', content: 'System' }))).toBeUndefined();
  });

  it('returns tool_call_id for tool message', () => {
    expect(
      getToolCallId(createMessage({ role: 'tool', content: 'Result', tool_call_id: 'call_1' }))
    ).toBe('call_1');
  });

  it('returns undefined for tool message with non-string tool_call_id', () => {
    expect(
      getToolCallId(createMessage({ role: 'tool', content: 'Result', tool_call_id: 123 as any }))
    ).toBeUndefined();
  });

  it('returns undefined for tool message with undefined tool_call_id', () => {
    expect(
      getToolCallId(createMessage({ role: 'tool', content: 'Result', tool_call_id: undefined }))
    ).toBeUndefined();
  });

  it('returns undefined for tool message with null tool_call_id', () => {
    expect(
      getToolCallId(createMessage({ role: 'tool', content: 'Result', tool_call_id: null as any }))
    ).toBeUndefined();
  });
});

describe('isSummaryMessage', () => {
  it('returns true for message starting with [Conversation Summary]', () => {
    expect(
      isSummaryMessage(
        createMessage({ role: 'assistant', content: '[Conversation Summary] This is a summary' })
      )
    ).toBe(true);
  });

  it('returns true for message starting with [对话摘要]', () => {
    expect(
      isSummaryMessage(createMessage({ role: 'assistant', content: '[对话摘要] 这是一个摘要' }))
    ).toBe(true);
  });

  it('returns false for regular message', () => {
    expect(isSummaryMessage(createMessage({ role: 'assistant', content: 'Hello' }))).toBe(false);
  });

  it('returns false for empty message', () => {
    expect(isSummaryMessage(createMessage({ role: 'assistant', content: '' }))).toBe(false);
  });

  it('returns false for message with summary text in the middle', () => {
    expect(
      isSummaryMessage(
        createMessage({ role: 'assistant', content: 'This is [Conversation Summary] text' })
      )
    ).toBe(false);
  });

  it('handles array content', () => {
    expect(
      isSummaryMessage(
        createMessage({
          role: 'assistant',
          content: [{ type: 'text', text: '[Conversation Summary] Summary' }],
        })
      )
    ).toBe(true);
  });

  it('handles undefined content', () => {
    expect(isSummaryMessage(createMessage({ role: 'assistant', content: undefined as any }))).toBe(
      false
    );
  });
});

describe('splitMessages', () => {
  it('splits messages correctly', () => {
    const messages = [
      createMessage({ role: 'system', content: 'System' }),
      createMessage({ role: 'user', content: 'User 1' }),
      createMessage({ role: 'assistant', content: 'Assistant 1' }),
      createMessage({ role: 'user', content: 'User 2' }),
      createMessage({ role: 'assistant', content: 'Assistant 2' }),
    ];

    const result = splitMessages(messages, 2);

    expect(result.systemMessage).toEqual(createMessage({ role: 'system', content: 'System' }));
    expect(result.pending).toHaveLength(2);
    expect(result.active).toHaveLength(2);
  });

  it('handles messages without system message', () => {
    const messages = [
      createMessage({ role: 'user', content: 'User 1' }),
      createMessage({ role: 'assistant', content: 'Assistant 1' }),
      createMessage({ role: 'user', content: 'User 2' }),
    ];

    const result = splitMessages(messages, 2);

    expect(result.systemMessage).toBeUndefined();
    expect(result.pending).toHaveLength(1);
    expect(result.active).toHaveLength(2);
  });

  it('handles empty messages', () => {
    const result = splitMessages([], 5);

    expect(result.systemMessage).toBeUndefined();
    expect(result.pending).toEqual([]);
    expect(result.active).toEqual([]);
  });

  it('handles keepMessagesNum larger than messages', () => {
    const messages = [
      createMessage({ role: 'user', content: 'User 1' }),
      createMessage({ role: 'assistant', content: 'Assistant 1' }),
    ];

    const result = splitMessages(messages, 10);

    expect(result.pending).toEqual([]);
    expect(result.active).toHaveLength(2);
  });

  it('handles keepMessagesNum of 0', () => {
    const messages = [
      createMessage({ role: 'user', content: 'User 1' }),
      createMessage({ role: 'assistant', content: 'Assistant 1' }),
    ];

    const result = splitMessages(messages, 0);

    expect(result.pending).toEqual([]);
    expect(result.active).toHaveLength(2);
  });

  it('adjusts split point to not split user message pairs', () => {
    const messages = [
      createMessage({ role: 'user', content: 'User 1' }),
      createMessage({ role: 'assistant', content: 'Assistant 1' }),
      createMessage({ role: 'user', content: 'User 2' }),
      createMessage({ role: 'assistant', content: 'Assistant 2' }),
    ];

    const result = splitMessages(messages, 1);

    // Should keep the last user-assistant pair together
    expect(result.active).toHaveLength(2);
    expect(result.active[0].content).toBe('User 2');
    expect(result.active[1].content).toBe('Assistant 2');
  });
});

describe('processToolCallPairs', () => {
  const createAssistantMessage = (_id: string, toolCallIds: string[]): Message =>
    createMessage({
      role: 'assistant',
      content: '',
      tool_calls: toolCallIds.map((callId, index) => ({
        id: callId,
        type: 'function',
        index,
        function: { name: 'test', arguments: '{}' },
      })),
    });

  const createToolMessage = (toolCallId: string): Message =>
    createMessage({
      role: 'tool',
      content: 'Result',
      tool_call_id: toolCallId,
    });

  it('returns unchanged when no tool calls need pairing', () => {
    const pending: Message[] = [];
    const active: Message[] = [
      createMessage({ role: 'user', content: 'Hello' }),
      createMessage({ role: 'assistant', content: 'Hi' }),
    ];

    const result = processToolCallPairs(pending, active);

    expect(result.pending).toEqual(pending);
    expect(result.active).toEqual(active);
  });

  it('moves assistant and tool messages together', () => {
    const assistant = createAssistantMessage('msg_1', ['call_1']);
    const tool = createToolMessage('call_1');

    const pending: Message[] = [assistant];
    const active: Message[] = [createMessage({ role: 'user', content: 'Hello' }), tool];

    const result = processToolCallPairs(pending, active);

    expect(result.pending).toHaveLength(0);
    expect(result.active).toContain(assistant);
    expect(result.active).toContain(tool);
  });

  it('handles multiple tool calls', () => {
    const assistant = createAssistantMessage('msg_1', ['call_1', 'call_2']);
    const tool1 = createToolMessage('call_1');
    const tool2 = createToolMessage('call_2');

    const pending: Message[] = [assistant];
    const active: Message[] = [tool1, tool2];

    const result = processToolCallPairs(pending, active);

    expect(result.pending).toHaveLength(0);
    expect(result.active).toContain(assistant);
    expect(result.active).toContain(tool1);
    expect(result.active).toContain(tool2);
  });

  it('handles tool message without matching assistant', () => {
    const pending: Message[] = [];
    const active: Message[] = [createToolMessage('call_1')];

    const result = processToolCallPairs(pending, active);

    expect(result.pending).toEqual([]);
    expect(result.active).toEqual(active);
  });

  it('handles empty arrays', () => {
    const result = processToolCallPairs([], []);

    expect(result.pending).toEqual([]);
    expect(result.active).toEqual([]);
  });
});

describe('rebuildMessages', () => {
  it('rebuilds messages with all components', () => {
    const systemMessage = createMessage({ role: 'system', content: 'System' });
    const summaryMessage = createMessage({
      role: 'assistant',
      content: '[Conversation Summary] Summary',
    });
    const active: Message[] = [
      createMessage({ role: 'user', content: 'Hello' }),
      createMessage({ role: 'assistant', content: 'Hi' }),
    ];

    const result = rebuildMessages(systemMessage, summaryMessage, active);

    expect(result).toHaveLength(4);
    expect(result[0]).toBe(systemMessage);
    expect(result[1]).toBe(summaryMessage);
    expect(result[2]).toBe(active[0]);
    expect(result[3]).toBe(active[1]);
  });

  it('rebuilds messages without system message', () => {
    const summaryMessage = createMessage({
      role: 'assistant',
      content: '[Conversation Summary] Summary',
    });
    const active: Message[] = [createMessage({ role: 'user', content: 'Hello' })];

    const result = rebuildMessages(undefined, summaryMessage, active);

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(summaryMessage);
    expect(result[1]).toBe(active[0]);
  });

  it('rebuilds messages without summary message', () => {
    const systemMessage = createMessage({ role: 'system', content: 'System' });
    const active: Message[] = [createMessage({ role: 'user', content: 'Hello' })];

    const result = rebuildMessages(systemMessage, null, active);

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(systemMessage);
    expect(result[1]).toBe(active[0]);
  });

  it('rebuilds messages with only active messages', () => {
    const active: Message[] = [createMessage({ role: 'user', content: 'Hello' })];

    const result = rebuildMessages(undefined, null, active);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(active[0]);
  });

  it('handles empty active messages', () => {
    const systemMessage = createMessage({ role: 'system', content: 'System' });
    const summaryMessage = createMessage({
      role: 'assistant',
      content: '[Conversation Summary] Summary',
    });

    const result = rebuildMessages(systemMessage, summaryMessage, []);

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(systemMessage);
    expect(result[1]).toBe(summaryMessage);
  });

  it('handles all undefined/null', () => {
    const result = rebuildMessages(undefined, null, []);

    expect(result).toEqual([]);
  });
});

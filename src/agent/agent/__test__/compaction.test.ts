import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LLMProvider } from '../../../providers';
import type { Message } from '../../types';

const encodeMock = vi.hoisted(() =>
  vi.fn((text: string) => Array.from(text).map((_ch, index) => index))
);

vi.mock('js-tiktoken', () => ({
  getEncoding: vi.fn(() => ({
    encode: encodeMock,
  })),
}));

import { compact, estimateMessagesTokens, estimateTokens } from '../compaction';

function createProvider(
  overrides?: Partial<{
    generate: LLMProvider['generate'];
    getTimeTimeout: LLMProvider['getTimeTimeout'];
    model: string;
  }>
): LLMProvider {
  return {
    config: { model: overrides?.model ?? 'mock-model' } as Record<string, unknown>,
    generate:
      overrides?.generate ||
      (vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'mock summary' } }],
      }) as unknown as LLMProvider['generate']),
    generateStream: vi.fn() as unknown as LLMProvider['generateStream'],
    getTimeTimeout: overrides?.getTimeTimeout || vi.fn(() => 50),
    getLLMMaxTokens: vi.fn(() => 1000),
    getMaxOutputTokens: vi.fn(() => 100),
  } as unknown as LLMProvider;
}

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

describe('renx compaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    encodeMock.mockImplementation((text: string) => Array.from(text).map((_ch, index) => index));
  });

  it('estimateTokens uses tiktoken encoder output length', () => {
    expect(estimateTokens('abc')).toBe(3);
    expect(estimateTokens('')).toBe(0);
    expect(encodeMock).toHaveBeenCalledWith('abc');
  });

  it('estimateTokens falls back to heuristic when encoder throws', () => {
    encodeMock.mockImplementationOnce(() => {
      throw new Error('encode failed');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(estimateTokens('中文ab')).toBe(5);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('estimateMessagesTokens applies different costs for low/high image detail', () => {
    const lowImageMessage = createMessage({
      role: 'user',
      type: 'user',
      content: [{ type: 'image_url', image_url: { url: 'u', detail: 'low' } }],
    });
    const highImageMessage = createMessage({
      role: 'user',
      type: 'user',
      content: [{ type: 'image_url', image_url: { url: 'u', detail: 'high' } }],
    });

    const low = estimateMessagesTokens([lowImageMessage]);
    const high = estimateMessagesTokens([highImageMessage]);

    expect(high - low).toBe(680);
  });

  it('estimateMessagesTokens includes tool_calls, tool_call_id and tools schema overhead', () => {
    const base = createMessage({
      role: 'assistant',
      type: 'assistant-text',
      content: 'hello',
    });
    const withToolMetadata = createMessage({
      role: 'assistant',
      type: 'tool-call',
      content: 'hello',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'bash', arguments: '{"cmd":"echo"}' },
        },
      ] as Message['tool_calls'],
      tool_call_id: 'call_1',
    });

    const withoutExtra = estimateMessagesTokens([base]);
    const withExtra = estimateMessagesTokens([withToolMetadata], [
      {
        type: 'function',
        function: { name: 'bash', description: 'run shell', parameters: { type: 'object' } },
      },
    ] as never);

    expect(withExtra).toBeGreaterThan(withoutExtra);
  });

  it('estimateMessagesTokens counts name field and array text parts', () => {
    const msg = createMessage({
      role: 'assistant',
      type: 'assistant-text',
      content: [{ type: 'text', text: 'chunk-text' }],
    }) as Message & { name?: string };
    msg.name = 'assistant_name';

    const baseline = createMessage({
      role: 'assistant',
      type: 'assistant-text',
      content: '',
    });

    const tokensWithNameAndParts = estimateMessagesTokens([msg]);
    const baselineTokens = estimateMessagesTokens([baseline]);
    expect(tokensWithNameAndParts).toBeGreaterThan(baselineTokens);
  });

  it('compact builds summary and returns removed message ids', async () => {
    const generateMock = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'Summary text' } }],
    });
    const provider = createProvider({
      generate: generateMock as unknown as LLMProvider['generate'],
    });
    const logger = { info: vi.fn(), warn: vi.fn() };
    const messages: Message[] = [
      createMessage({
        messageId: 's1',
        type: 'system',
        role: 'system',
        content: 'sys',
        timestamp: 1,
      }),
      createMessage({
        messageId: 'u1',
        type: 'user',
        role: 'user',
        content: 'old question',
        timestamp: 2,
      }),
      createMessage({
        messageId: 'a1',
        type: 'assistant-text',
        role: 'assistant',
        content: 'old answer',
        timestamp: 3,
      }),
      createMessage({
        messageId: 'u2',
        type: 'user',
        role: 'user',
        content: 'latest question',
        timestamp: 4,
      }),
    ];

    const result = await compact(messages, { provider, keepMessagesNum: 1, logger });

    expect(result.summaryMessage).toMatchObject({
      role: 'assistant',
      type: 'summary',
    });
    expect(String(result.summaryMessage?.content)).toContain('Summary text');
    expect(result.removedMessageIds.sort()).toEqual(['a1', 'u1']);
    expect(result.messages.map((m) => m.messageId)).toEqual([
      's1',
      result.summaryMessage!.messageId,
      'u2',
    ]);
    const secondArg = (generateMock as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]?.[1] as {
      model?: string;
      abortSignal?: AbortSignal;
    };
    expect(secondArg.model).toBe('mock-model');
    expect(secondArg.abortSignal).toBeDefined();
    expect(
      (logger.info as unknown as { mock: { calls: unknown[][] } }).mock.calls.length
    ).toBeGreaterThan(0);
  });

  it('compact handles invalid summary response and returns null summary', async () => {
    const provider = createProvider({
      generate: vi.fn().mockResolvedValue(null) as unknown as LLMProvider['generate'],
      getTimeTimeout: vi.fn(() => 0),
    });
    const logger = { info: vi.fn(), warn: vi.fn() };
    const messages = [
      createMessage({ messageId: 's1', type: 'system', role: 'system', content: 'sys' }),
      createMessage({ messageId: 'u1', type: 'user', role: 'user', content: 'u1' }),
      createMessage({ messageId: 'u2', type: 'user', role: 'user', content: 'u2' }),
    ];

    const result = await compact(messages, {
      provider,
      keepMessagesNum: 1,
      logger,
    });

    expect(result.summaryMessage).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('compact skips llm summary generation when pending is empty', async () => {
    const generateMock = vi.fn();
    const provider = createProvider({
      generate: generateMock as unknown as LLMProvider['generate'],
    });
    const messages = [
      createMessage({ messageId: 's1', type: 'system', role: 'system', content: 'sys' }),
      createMessage({ messageId: 'u1', type: 'user', role: 'user', content: 'u1' }),
    ];

    const result = await compact(messages, { provider, keepMessagesNum: 10 });

    expect(result.summaryMessage).toBeNull();
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('compact handles provider.generate throw and logs warning', async () => {
    const provider = createProvider({
      generate: vi
        .fn()
        .mockRejectedValue(new Error('network failed')) as unknown as LLMProvider['generate'],
    });
    const logger = { info: vi.fn(), warn: vi.fn() };
    const messages = [
      createMessage({ messageId: 's1', type: 'system', role: 'system', content: 'sys' }),
      createMessage({ messageId: 'a1', type: 'assistant-text', role: 'assistant', content: 'a1' }),
      createMessage({ messageId: 'u1', type: 'user', role: 'user', content: 'u1' }),
    ];

    const result = await compact(messages, {
      provider,
      keepMessagesNum: 1,
      logger,
    });

    expect(result.summaryMessage).toBeNull();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('compact passes previous summary block and handles empty choices response', async () => {
    const generateMock = vi.fn().mockResolvedValue({ choices: [] });
    const provider = createProvider({
      generate: generateMock as unknown as LLMProvider['generate'],
      model: '   ',
      getTimeTimeout: vi.fn(() => 0),
    });

    const messages = [
      createMessage({ messageId: 's1', type: 'system', role: 'system', content: 'sys' }),
      createMessage({
        messageId: 'sum_1',
        type: 'summary',
        role: 'assistant',
        content: '[Conversation Summary]\nold summary',
      }),
      createMessage({ messageId: 'u2', type: 'user', role: 'user', content: 'latest' }),
    ];

    const result = await compact(messages, { provider, keepMessagesNum: 1 });
    expect(result.summaryMessage).toBeNull();

    const callArgs = (generateMock as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const requestMessages = callArgs?.[0] as Array<{ role: string; content: string }>;
    const options = callArgs?.[1] as { model?: string; abortSignal?: AbortSignal };
    expect(requestMessages[1]?.content).toContain('<previous_summary>');
    expect(options.model).toBeUndefined();
    expect(options.abortSignal).toBeUndefined();
  });

  it('compact ignores AbortSignal.timeout failure and still requests summary', async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      throw new Error('timeout unsupported');
    });
    const generateMock = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'summary ok' } }],
    });

    const provider = createProvider({
      generate: generateMock as unknown as LLMProvider['generate'],
      getTimeTimeout: vi.fn(() => 10),
    });

    const messages = [
      createMessage({ messageId: 's1', type: 'system', role: 'system', content: 'sys' }),
      createMessage({ messageId: 'u1', type: 'user', role: 'user', content: 'old q' }),
      createMessage({ messageId: 'u2', type: 'user', role: 'user', content: 'latest q' }),
    ];

    const result = await compact(messages, { provider, keepMessagesNum: 1 });
    expect(result.summaryMessage?.content).toContain('summary ok');
    const options = (generateMock as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]?.[1] as {
      abortSignal?: AbortSignal;
    };
    expect(options.abortSignal).toBeUndefined();
    timeoutSpy.mockRestore();
  });
});

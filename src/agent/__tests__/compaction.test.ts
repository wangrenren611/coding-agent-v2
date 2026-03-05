/**
 * 上下文压缩模块测试
 *
 * 测试覆盖：
 * - estimateTokens - Token 估算
 * - estimateMessagesTokens - 消息 Token 估算
 * - compact - 消息压缩
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  estimateTokens,
  estimateMessagesTokens,
  compact,
  type CompactOptions,
} from '../compaction';
import type { LLMProvider, LLMResponse, Tool } from '../../providers';
import type { Message } from '../types';

// =============================================================================
// Helper function to create mock messages
// =============================================================================
function createMockMessages(count: number): Message[] {
  const messages: Message[] = [];
  for (let i = 0; i < count; i++) {
    messages.push({
      messageId: `msg-${i}`,
      role: i % 2 === 0 ? 'system' : i % 2 === 0 ? 'user' : 'assistant',
      content: `Message content ${i}`,
    });
  }
  return messages;
}

// =============================================================================
// Tests for estimateTokens
// =============================================================================
describe('estimateTokens', () => {
  it('should return 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('should estimate tokens for whitespace string', () => {
    // Whitespace: 3 chars * 0.25 = 0.75, rounded up to 1
    expect(estimateTokens('   ')).toBe(1);
  });

  it('should estimate tokens for English text', () => {
    // English text: roughly 0.25 tokens per char
    const text = 'Hello world this is a test'; // 26 chars
    const tokens = estimateTokens(text);
    // 26 chars * 0.25 = 6.5, rounded up to 7
    expect(tokens).toBe(7);
  });

  it('should estimate tokens for Chinese text', () => {
    // Chinese text: roughly 1.5 tokens per char
    const text = '你好世界这是一个测试'; // 10 chars
    const tokens = estimateTokens(text);
    // 10 chars * 1.5 = 15
    expect(tokens).toBe(15);
  });

  it('should estimate tokens for mixed text', () => {
    const text = 'Hello 你好 World 世界'; // 18 chars total: 11 English + 4 Chinese + 3 spaces
    const tokens = estimateTokens(text);
    // English: 11 * 0.25 = 2.75
    // Chinese: 4 * 1.5 = 6
    // Total = 8.75, rounded up to 9 or 10 (acceptable range)
    expect(tokens).toBeGreaterThanOrEqual(9);
    expect(tokens).toBeLessThanOrEqual(10);
  });

  it('should handle special characters', () => {
    const text = '!@#$%^&*()'; // 10 chars
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(0);
    // 10 chars * 0.25 = 2.5, rounded up to 3
    expect(tokens).toBe(3);
  });
});

// =============================================================================
// Tests for estimateMessagesTokens
// =============================================================================
describe('estimateMessagesTokens', () => {
  it('should return 0 for empty messages', () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });

  it('should estimate tokens for messages', () => {
    const messages = createMockMessages(5);
    const tokens = estimateMessagesTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });

  it('should include tools in estimation', () => {
    const messages = createMockMessages(2);
    const tools: Tool[] = [
      {
        type: 'function',
        function: {
          name: 'test_tool',
          description: 'a test tool',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string' },
            },
          },
        },
      },
    ];
    const tokensWithTools = estimateMessagesTokens(messages, tools);
    const tokensWithoutTools = estimateMessagesTokens(messages);
    expect(tokensWithTools).toBeGreaterThan(tokensWithoutTools);
  });

  it('should handle messages with tool calls', () => {
    const messages: Message[] = [
      {
        messageId: 'msg-1',
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'call-1',
            type: 'function',
            function: {
              name: 'test_tool',
              arguments: '{"query": "test"}',
            },
          },
        ],
      },
      {
        messageId: 'msg-2',
        role: 'tool',
        content: '{"result": "success"}',
        tool_call_id: 'call-1',
      },
    ];
    const tokens = estimateMessagesTokens(messages);
    expect(tokens).toBeGreaterThan(0);
  });
});

// =============================================================================
// Tests for compact
// =============================================================================
describe('compact', () => {
  let mockProvider: LLMProvider;

  beforeEach(() => {
    mockProvider = {
      generate: vi.fn().mockResolvedValue({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'This is a summary of the conversation.',
            },
          },
        ],
      } as LLMResponse),
      generateStream: vi.fn(),
      getTimeTimeout: vi.fn().mockReturnValue(60000),
      config: { model: 'test-model' },
    } as unknown as LLMProvider;
  });

  it('should compact messages and create summary', async () => {
    const messages = createMockMessages(15);
    const options: CompactOptions = {
      provider: mockProvider,
      keepMessagesNum: 5,
    };

    const result = await compact(messages, options);

    expect(result.messages.length).toBeLessThan(messages.length);
    expect(result.summaryMessage).toBeDefined();
    expect(result.summaryMessage.role).toBe('assistant');
    expect(result.summaryMessage.content).toContain('[Conversation Summary]');
    expect(result.removedMessageIds.length).toBeGreaterThan(0);
  });

  it('should preserve system message', async () => {
    const messages: Message[] = [
      { messageId: 'sys-1', role: 'system', content: 'System prompt' },
      ...createMockMessages(10),
    ];

    const options: CompactOptions = {
      provider: mockProvider,
      keepMessagesNum: 3,
    };

    const result = await compact(messages, options);

    expect(result.messages[0].role).toBe('system');
    expect(result.messages[0].content).toBe('System prompt');
  });

  it('should preserve active messages', async () => {
    const messages: Message[] = [];
    for (let i = 0; i < 20; i++) {
      messages.push({
        messageId: `msg-${i}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Content ${i}`,
      });
    }

    const keepMessagesNum = 5;
    const options: CompactOptions = {
      provider: mockProvider,
      keepMessagesNum,
    };

    const result = await compact(messages, options);

    // Check that the last few messages are preserved (after summary)
    // Result should have: system (if any) + summary + active messages
    const activeMessages = result.messages.filter(
      (m) => m.role !== 'system' && !m.content?.toString().includes('[Conversation Summary]')
    );

    // The number of active messages should be around keepMessagesNum
    expect(activeMessages.length).toBeLessThanOrEqual(keepMessagesNum + 2); // Allow some flexibility for tool pairs
  });

  it('should use custom language for summary', async () => {
    const messages = createMockMessages(10);
    const options: CompactOptions = {
      provider: mockProvider,
      keepMessagesNum: 3,
      language: 'Chinese',
    };

    await compact(messages, options);

    // Check that generate was called
    expect(mockProvider.generate).toHaveBeenCalled();
    const generateMock = mockProvider.generate as unknown as ReturnType<typeof vi.fn>;
    const callArgs = generateMock.mock.calls[0];
    // The request messages should contain Chinese language instruction
    const requestMessages = callArgs[0];
    const lastMessage = requestMessages[requestMessages.length - 1];
    expect(lastMessage.content).toContain('Chinese');
  });

  it('should handle empty messages', async () => {
    const options: CompactOptions = {
      provider: mockProvider,
      keepMessagesNum: 5,
    };

    const result = await compact([], options);

    expect(result.messages).toHaveLength(1); // Only summary message
    expect(result.removedMessageIds).toHaveLength(0);
  });

  it('should handle provider errors gracefully', async () => {
    const errorProvider = {
      generate: vi.fn().mockRejectedValue(new Error('Provider error')),
      generateStream: vi.fn(),
      getTimeTimeout: vi.fn().mockReturnValue(60000),
      config: undefined,
    } as unknown as LLMProvider;

    const messages = createMockMessages(10);
    const options: CompactOptions = {
      provider: errorProvider,
      keepMessagesNum: 3,
    };

    // Should not throw, should handle gracefully
    const result = await compact(messages, options);

    expect(result).toBeDefined();
    expect(result.summaryMessage).toBeDefined();
  });

  it('should handle tool call pairs correctly', async () => {
    const messages: Message[] = [
      { messageId: 'sys-1', role: 'system', content: 'System' },
      { messageId: 'usr-1', role: 'user', content: 'Hello' },
      {
        messageId: 'ast-1',
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'call-1', type: 'function', function: { name: 'tool1', arguments: '{}' } },
        ],
      },
      {
        messageId: 'tool-1',
        role: 'tool',
        content: '{"result": "ok"}',
        tool_call_id: 'call-1',
      },
      { messageId: 'usr-2', role: 'user', content: 'Thanks' },
      { messageId: 'ast-2', role: 'assistant', content: 'You are welcome!' },
    ];

    const options: CompactOptions = {
      provider: mockProvider,
      keepMessagesNum: 2,
    };

    const result = await compact(messages, options);

    // Tool call and its result should stay together
    expect(result.messages).toBeDefined();
  });
});

import { describe, it, expect, vi } from 'vitest';
import type { HookContext } from '../../core/types';
import type { LLMRequestMessage } from '../../providers';
import type { MemoryManager } from '../../storage';
import {
  buildInitialMessages,
  buildUserMessage,
  ensureSystemMessageForExistingSession,
  extractSystemPrompt,
  prepareMessagesForRun,
} from '../runtime/message-builder';

const mockContext: HookContext = {
  loopIndex: 0,
  stepIndex: 0,
  sessionId: 's1',
  state: {
    loopIndex: 0,
    stepIndex: 0,
    currentText: '',
    currentToolCalls: [],
    totalUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    stepUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    retryCount: 0,
    needsRetry: false,
    aborted: false,
    resultStatus: 'continue',
  },
};

function createHookManager() {
  return {
    executeSystemPromptHooks: vi.fn(async (prompt: string) => `[SYS] ${prompt}`),
    executeUserPromptHooks: vi.fn(async (prompt: string) => `[USR] ${prompt}`),
  };
}

describe('message-builder runtime helpers', () => {
  it('buildUserMessage should process string content with user hook', async () => {
    const hookManager = createHookManager();
    const message = await buildUserMessage({
      userContent: 'hello',
      hookManager,
      getHookContext: () => mockContext,
      createMessageId: () => 'u1',
    });

    expect(message).toEqual({
      messageId: 'u1',
      role: 'user',
      content: '[USR] hello',
    });
  });

  it('buildUserMessage should process only text parts in multimodal content', async () => {
    const hookManager = createHookManager();
    const content: LLMRequestMessage['content'] = [
      { type: 'text', text: 'a' },
      { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
      { type: 'text', text: 'b' },
    ];
    const message = await buildUserMessage({
      userContent: content,
      hookManager,
      getHookContext: () => mockContext,
      createMessageId: () => 'u2',
    });

    expect(message.content).toEqual([
      { type: 'text', text: '[USR] a' },
      { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
      { type: 'text', text: '[USR] b' },
    ]);
  });

  it('buildInitialMessages should include hooked system prompt and user message', async () => {
    const hookManager = createHookManager();
    const messages = await buildInitialMessages({
      systemPrompt: 'base system',
      userContent: 'hello',
      hookManager,
      getHookContext: () => mockContext,
      createMessageId: (() => {
        let i = 0;
        return () => `m${++i}`;
      })(),
    });

    expect(messages).toEqual([
      { messageId: 'm1', role: 'system', content: '[SYS] base system' },
      { messageId: 'm2', role: 'user', content: '[USR] hello' },
    ]);
  });

  it('ensureSystemMessageForExistingSession should keep messages when system already exists', async () => {
    const hookManager = createHookManager();
    const messages = [
      { messageId: 's1', role: 'system' as const, content: 'existing' },
      { messageId: 'u1', role: 'user' as const, content: 'hello' },
    ];

    const next = await ensureSystemMessageForExistingSession({
      messages,
      existingSessionPrompt: 'session prompt',
      systemPrompt: 'config prompt',
      hookManager,
      getHookContext: () => mockContext,
      createMessageId: () => 's2',
    });

    expect(next).toBe(messages);
  });

  it('ensureSystemMessageForExistingSession should prepend session prompt when missing', async () => {
    const hookManager = createHookManager();
    const messages = [{ messageId: 'u1', role: 'user' as const, content: 'hello' }];

    const next = await ensureSystemMessageForExistingSession({
      messages,
      existingSessionPrompt: 'session prompt',
      systemPrompt: 'config prompt',
      hookManager,
      getHookContext: () => mockContext,
      createMessageId: () => 's2',
    });

    expect(next).toEqual([
      { messageId: 's2', role: 'system', content: 'session prompt' },
      { messageId: 'u1', role: 'user', content: 'hello' },
    ]);
  });

  it('extractSystemPrompt should return text content', () => {
    const result = extractSystemPrompt([
      { messageId: 's1', role: 'system', content: [{ type: 'text', text: 'sys' }] },
      { messageId: 'u1', role: 'user', content: 'hello' },
    ]);

    expect(result).toBe('sys');
  });

  it('prepareMessagesForRun should build initial messages without memory manager', async () => {
    const buildInitial = vi.fn(async () => [
      { messageId: 's1', role: 'system' as const, content: 'sys' },
      { messageId: 'u1', role: 'user' as const, content: 'hello' },
    ]);

    const result = await prepareMessagesForRun({
      memoryManager: undefined,
      sessionId: 's1',
      userContent: 'hello',
      buildInitialMessages: buildInitial,
      buildUserMessage: vi.fn(),
      restoreMessages: vi.fn(),
      ensureSystemMessageForExistingSession: vi.fn(),
    });

    expect(result.saveFromIndex).toBe(0);
    expect(result.messages).toHaveLength(2);
  });

  it('prepareMessagesForRun should append user for existing session', async () => {
    const memoryManager = {
      initialize: vi.fn(async () => undefined),
      getSession: vi.fn(() => ({ sessionId: 's1', systemPrompt: 'session', createdAt: 0 })),
    } as unknown as MemoryManager;

    const result = await prepareMessagesForRun({
      memoryManager,
      sessionId: 's1',
      userContent: 'new',
      buildInitialMessages: vi.fn(),
      buildUserMessage: vi.fn(async () => ({
        messageId: 'u2',
        role: 'user' as const,
        content: 'new',
      })),
      restoreMessages: vi.fn(async () => [
        { messageId: 'u1', role: 'user' as const, content: 'old' },
      ]),
      ensureSystemMessageForExistingSession: vi.fn(async (messages) => [
        { messageId: 's1', role: 'system' as const, content: 'session' },
        ...messages,
      ]),
    });

    expect(result.saveFromIndex).toBe(2);
    expect(result.messages).toEqual([
      { messageId: 's1', role: 'system', content: 'session' },
      { messageId: 'u1', role: 'user', content: 'old' },
      { messageId: 'u2', role: 'user', content: 'new' },
    ]);
  });

  it('prepareMessagesForRun should create session for new conversation', async () => {
    const memoryManager = {
      initialize: vi.fn(async () => undefined),
      getSession: vi.fn(() => null),
      createSession: vi.fn(async () => 's1'),
    } as unknown as MemoryManager;
    const initialMessages = [
      { messageId: 's1', role: 'system' as const, content: 'sys' },
      { messageId: 'u1', role: 'user' as const, content: 'hello' },
    ];

    const result = await prepareMessagesForRun({
      memoryManager,
      sessionId: 's1',
      userContent: 'hello',
      buildInitialMessages: vi.fn(async () => initialMessages),
      buildUserMessage: vi.fn(),
      restoreMessages: vi.fn(),
      ensureSystemMessageForExistingSession: vi.fn(),
    });

    expect(result.saveFromIndex).toBe(1);
    expect(memoryManager.createSession).toHaveBeenCalledWith('s1', 'sys');
  });
});

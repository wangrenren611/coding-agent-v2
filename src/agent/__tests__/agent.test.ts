import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../agent';
import {
  LLMError,
  type Chunk,
  type LLMProvider,
  type LLMRequestMessage,
  type Tool,
} from '../../providers';
import type { ToolManager } from '../../tool';
import type { MemoryManager } from '../../storage';
import type { Plugin } from '../../hook';

function createSingleStepProvider(
  onCall?: (messages: LLMRequestMessage[], options?: Record<string, unknown>) => void
): LLMProvider {
  return {
    config: { model: 'test-model' },
    generate: vi.fn(),
    async *generateStream(messages: LLMRequestMessage[], options?: Record<string, unknown>) {
      onCall?.(messages, options);

      const chunk: Chunk = {
        index: 0,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: 'done' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
      yield chunk;
    },
    getTimeTimeout: () => 60_000,
    getLLMMaxTokens: () => 128_000,
    getMaxOutputTokens: () => 8_000,
  } as unknown as LLMProvider;
}

function createFailingProvider(error: Error = new Error('provider failed')): LLMProvider {
  return {
    config: { model: 'test-model' },
    generate: vi.fn(),
    async *generateStream() {
      if (process.env.__AGENT_TEST_FORCE_YIELD__ === '1') {
        yield {} as Chunk;
      }
      throw error;
    },
    getTimeTimeout: () => 60_000,
    getLLMMaxTokens: () => 128_000,
    getMaxOutputTokens: () => 8_000,
  } as unknown as LLMProvider;
}

function createToolManager(): ToolManager {
  return {
    toToolsSchema: vi.fn(() => []),
    executeTools: vi.fn(async () => []),
  } as unknown as ToolManager;
}

function createToolCallOnlyProvider(): LLMProvider {
  return {
    config: { model: 'test-model' },
    generate: vi.fn(),
    async *generateStream() {
      const chunk: Chunk = {
        index: 0,
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call_limit_1',
                  type: 'function',
                  index: 0,
                  function: { name: 'bash', arguments: '{"command":"ls"}' },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      };
      yield chunk;
    },
    getTimeTimeout: () => 60_000,
    getLLMMaxTokens: () => 128_000,
    getMaxOutputTokens: () => 8_000,
  } as unknown as LLMProvider;
}

function createInfiniteStopProvider(
  onCall?: (messages: LLMRequestMessage[], options?: Record<string, unknown>) => void
): LLMProvider {
  let callCount = 0;
  return {
    config: { model: 'test-model' },
    generate: vi.fn(),
    async *generateStream(messages: LLMRequestMessage[], options?: Record<string, unknown>) {
      callCount++;
      onCall?.(messages, options);
      yield {
        index: 0,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: `done-${callCount}` },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      } as Chunk;
    },
    getTimeTimeout: () => 60_000,
    getLLMMaxTokens: () => 128_000,
    getMaxOutputTokens: () => 8_000,
  } as unknown as LLMProvider;
}

function createUsageTailProvider(): LLMProvider {
  return {
    config: { model: 'test-model' },
    generate: vi.fn(),
    async *generateStream() {
      yield {
        index: 0,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: 'done' },
            finish_reason: 'stop',
          },
        ],
      } as Chunk;

      // OpenAI stream_options.include_usage 常见的结尾 chunk：choices 为空，仅包含 usage
      yield {
        index: 1,
        choices: [],
        usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
      } as Chunk;
    },
    getTimeTimeout: () => 60_000,
    getLLMMaxTokens: () => 128_000,
    getMaxOutputTokens: () => 8_000,
  } as unknown as LLMProvider;
}

describe('Agent run flow', () => {
  it('should restore existing session messages and only persist new messages', async () => {
    const restoredMessages = [
      { messageId: 'sys-1', role: 'system', content: 'System prompt' },
      { messageId: 'old-1', role: 'assistant', content: 'Old response', id: 'llm-msg-123' },
    ];

    const memoryManager = {
      initialize: vi.fn(async () => undefined),
      getSession: vi.fn(() => ({
        sessionId: 's1',
        systemPrompt: 'System prompt',
        currentContextId: 'ctx-1',
        totalMessages: 2,
        compactionCount: 0,
        totalUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })),
      getContextMessages: vi.fn(() => restoredMessages),
      createSession: vi.fn(async () => 's1'),
      addMessages: vi.fn(async () => undefined),
      updateMessageInContext: vi.fn(async () => undefined),
    } as unknown as MemoryManager;

    const observedCalls: Array<LLMRequestMessage[]> = [];
    const provider = createSingleStepProvider((messages) => observedCalls.push(messages));
    const agent = new Agent({
      provider,
      toolManager: createToolManager(),
      memoryManager,
      sessionId: 's1',
    });

    const result = await agent.run('new question');

    expect(result.text).toBe('done');
    expect(memoryManager.initialize).toHaveBeenCalledTimes(1);
    expect(memoryManager.getSession).toHaveBeenCalledWith('s1');
    expect(memoryManager.createSession).not.toHaveBeenCalled();
    expect(observedCalls[0]).toHaveLength(3);
    expect(observedCalls[0][1].id).toBe('llm-msg-123');
    expect(observedCalls[0][2].role).toBe('user');
    expect(memoryManager.addMessages).toHaveBeenCalledTimes(2);
    const calls = (memoryManager.addMessages as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][1]).toHaveLength(1);
    expect(calls[0][1][0].role).toBe('user');
    expect(calls[1][1]).toHaveLength(1);
    expect(calls[1][1][0].role).toBe('assistant');
  });

  it('should create session for first run and persist full run messages', async () => {
    const memoryManager = {
      initialize: vi.fn(async () => undefined),
      getSession: vi.fn(() => null),
      getContextMessages: vi.fn(() => []),
      createSession: vi.fn(async () => 's2'),
      addMessages: vi.fn(async () => undefined),
      updateMessageInContext: vi.fn(async () => undefined),
    } as unknown as MemoryManager;

    const provider = createSingleStepProvider();
    const agent = new Agent({
      provider,
      toolManager: createToolManager(),
      memoryManager,
      sessionId: 's2',
      systemPrompt: 'You are concise.',
    });

    await agent.run('hello');

    expect(memoryManager.createSession).toHaveBeenCalledTimes(1);
    expect(memoryManager.createSession).toHaveBeenCalledWith('s2', 'You are concise.');
    const calls = (memoryManager.addMessages as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toHaveLength(1);
    expect(calls[0][1][0].role).toBe('user');
    expect(calls[1][1]).toHaveLength(1);
    expect(calls[1][1][0].role).toBe('assistant');
  });

  it('should persist user message even when run fails', async () => {
    const memoryManager = {
      initialize: vi.fn(async () => undefined),
      getSession: vi.fn(() => ({
        sessionId: 's3',
        systemPrompt: 'System prompt',
        currentContextId: 'ctx-3',
        totalMessages: 1,
        compactionCount: 0,
        totalUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })),
      getContextMessages: vi.fn(() => [
        { messageId: 'sys-3', role: 'system', content: 'System prompt' },
      ]),
      createSession: vi.fn(async () => 's3'),
      addMessages: vi.fn(async () => undefined),
      updateMessageInContext: vi.fn(async () => undefined),
    } as unknown as MemoryManager;

    const agent = new Agent({
      provider: createFailingProvider(),
      toolManager: createToolManager(),
      memoryManager,
      sessionId: 's3',
    });

    await expect(agent.run('hello')).rejects.toThrow('provider failed');
    expect(memoryManager.addMessages).toHaveBeenCalledTimes(1);
    const persisted = (memoryManager.addMessages as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][1];
    expect(persisted).toHaveLength(1);
    expect(persisted[0].role).toBe('user');
  });

  it('should avoid persisting duplicated system message when session exists but context is empty', async () => {
    const observedCalls: Array<LLMRequestMessage[]> = [];
    const memoryManager = {
      initialize: vi.fn(async () => undefined),
      getSession: vi.fn(() => ({
        sessionId: 's4',
        systemPrompt: 'System prompt',
        currentContextId: 'ctx-4',
        totalMessages: 1,
        compactionCount: 0,
        totalUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })),
      getContextMessages: vi.fn(() => []),
      createSession: vi.fn(async () => 's4'),
      addMessages: vi.fn(async () => undefined),
      updateMessageInContext: vi.fn(async () => undefined),
    } as unknown as MemoryManager;

    const provider = createSingleStepProvider((messages) => observedCalls.push(messages));
    const agent = new Agent({
      provider,
      toolManager: createToolManager(),
      memoryManager,
      sessionId: 's4',
    });

    await agent.run('hello');
    expect(observedCalls[0]).toHaveLength(2);
    expect(observedCalls[0][0].role).toBe('system');
    expect(observedCalls[0][1].role).toBe('user');
    const calls = (memoryManager.addMessages as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][1]).toHaveLength(1);
    expect(calls[0][1][0].role).toBe('user');
    expect(calls[1][1]).toHaveLength(1);
    expect(calls[1][1][0].role).toBe('assistant');
  });

  it('should merge streamed tool_call chunks by index when later chunks miss id/name', async () => {
    let streamCount = 0;
    const provider: LLMProvider = {
      config: { model: 'test-model' },
      generate: vi.fn(),
      async *generateStream() {
        streamCount += 1;
        if (streamCount === 1) {
          yield {
            index: 0,
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      id: 'call_function_9nyt93q8i2bq_1',
                      type: 'function',
                      index: 0,
                      function: { name: 'bash', arguments: '{' },
                    },
                  ],
                },
              },
            ],
          } as Chunk;

          yield {
            index: 0,
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      index: 0,
                      function: {
                        name: '',
                        arguments: '"command": "ls -la", "description": "列出当前目录文件"}',
                      },
                    } as unknown as {
                      id: string;
                      type: string;
                      index: number;
                      function: { name: string; arguments: string };
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
          } as Chunk;
          return;
        }

        yield {
          index: 0,
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: 'done' },
              finish_reason: 'stop',
            },
          ],
        } as Chunk;
      },
      getTimeTimeout: () => 60_000,
      getLLMMaxTokens: () => 128_000,
      getMaxOutputTokens: () => 8_000,
    } as unknown as LLMProvider;

    const executeTools = vi.fn(async (toolCalls: Array<{ id: string }>) => {
      const id = toolCalls[0]?.id ?? 'missing-id';
      return [{ toolCallId: id, result: { success: true, data: 'ok' } }];
    });
    const toolManager = {
      toToolsSchema: vi.fn(() => []),
      executeTools,
    } as unknown as ToolManager;

    const agent = new Agent({
      provider,
      toolManager,
      maxSteps: 3,
    });

    const result = await agent.run('run tool');
    expect(result.completionReason).toBe('stop');
    expect(executeTools).toHaveBeenCalledTimes(1);
    const mergedToolCalls = executeTools.mock.calls[0][0] as Array<{
      id: string;
      function: { name: string; arguments: string };
      index: number;
    }>;
    expect(mergedToolCalls).toHaveLength(1);
    expect(mergedToolCalls[0].id).toBe('call_function_9nyt93q8i2bq_1');
    expect(mergedToolCalls[0].function.name).toBe('bash');
    expect(mergedToolCalls[0].function.arguments).toBe(
      '{"command": "ls -la", "description": "列出当前目录文件"}'
    );
  });

  it('should return limit_exceeded when maxSteps is reached before completion', async () => {
    const executeTools = vi.fn(async () => [
      { toolCallId: 'call_limit_1', result: { success: true, data: 'ok' } },
    ]);
    const toolManager = {
      toToolsSchema: vi.fn(() => []),
      executeTools,
    } as unknown as ToolManager;

    const agent = new Agent({
      provider: createToolCallOnlyProvider(),
      toolManager,
      maxSteps: 1,
    });

    const result = await agent.run('run until step limit');
    expect(result.loopCount).toBe(1);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].finishReason).toBe('tool_calls');
    expect(executeTools).toHaveBeenCalledTimes(1);
    expect(result.completionReason).toBe('limit_exceeded');
    expect(result.completionMessage).toContain('maxSteps');
  });

  it('should honor config hooks and run successfully with maxSteps=1', async () => {
    let observedOptions: Record<string, unknown> | undefined;
    const provider = createSingleStepProvider((_messages, options) => {
      observedOptions = options;
    });
    const configPlugin: Plugin = {
      name: 'config-overrides',
      config: (config) => ({
        ...(config as Record<string, unknown>),
        maxSteps: 1,
        generateOptions: { temperature: 0.42 },
      }),
    };

    const agent = new Agent({
      provider,
      toolManager: createToolManager(),
      plugins: [configPlugin],
      maxSteps: 100,
    });

    const result = await agent.run('test');

    expect(result.completionReason).toBe('stop');
    expect(result.loopCount).toBe(1);
    expect(observedOptions?.temperature).toBe(0.42);
  });

  it('should allow disabling default completion detector fallback', async () => {
    const completionDetector = vi.fn(() => ({ done: false, reason: 'stop' as const }));
    const agent = new Agent({
      provider: createSingleStepProvider(),
      toolManager: createToolManager(),
      completionDetector,
      useDefaultCompletionDetector: false,
    });

    const agentRef = agent as unknown as {
      state: { resultStatus: 'continue' | 'stop' };
      steps: Array<{
        text: string;
        toolCalls: unknown[];
        toolResults: unknown[];
        finishReason: 'stop';
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
        rawChunks: unknown[];
      }>;
      evaluateCompletion: () => Promise<{ done: boolean; reason: string }>;
    };
    agentRef.state.resultStatus = 'continue';
    agentRef.steps = [
      {
        text: 'done',
        toolCalls: [],
        toolResults: [],
        finishReason: 'stop',
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        rawChunks: [],
      },
    ];

    const result = await agentRef.evaluateCompletion();
    expect(completionDetector).toHaveBeenCalledTimes(1);
    expect(result.done).toBe(false);
  });

  it('should apply userPrompt hooks to text parts in multimodal user content', async () => {
    const observedCalls: Array<LLMRequestMessage[]> = [];
    const provider = createSingleStepProvider((messages) => observedCalls.push(messages));
    const plugin: Plugin = {
      name: 'multimodal-user-hook',
      userPrompt: (prompt) => `[HOOKED] ${prompt}`,
    };

    const agent = new Agent({
      provider,
      toolManager: createToolManager(),
      plugins: [plugin],
    });

    await agent.run({
      role: 'user',
      content: [
        { type: 'text', text: 'first' },
        { type: 'image_url', image_url: { url: 'https://example.com/image.png' } },
        { type: 'text', text: 'second' },
      ],
    });

    const userMessage = observedCalls[0].find((message) => message.role === 'user');
    const content = userMessage?.content as Array<
      { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
    >;
    expect(content[0]).toEqual({ type: 'text', text: '[HOOKED] first' });
    expect(content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'https://example.com/image.png' },
    });
    expect(content[2]).toEqual({ type: 'text', text: '[HOOKED] second' });
  });

  it('should retry on generic LLMError', async () => {
    const agent = new Agent({
      provider: createFailingProvider(new LLMError('generic llm failure')),
      toolManager: createToolManager(),
      maxRetries: 0,
    });

    await expect(agent.run('trigger llm error')).rejects.toThrow('Max retries exceeded');
  });

  it('should retry final persistence flush when run already failed', async () => {
    const agent = new Agent({
      provider: createSingleStepProvider(),
      toolManager: createToolManager(),
      completionDetector: () => {
        throw new Error('completion detector failed');
      },
    });

    const saveMessagesSpy = vi.spyOn(
      agent as unknown as { saveMessages: (startIndex: number) => Promise<void> },
      'saveMessages'
    );
    saveMessagesSpy
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('persist failed'))
      .mockResolvedValueOnce(undefined);

    await expect(agent.run('test persistence retry')).rejects.toThrow('completion detector failed');
    expect(saveMessagesSpy).toHaveBeenCalledTimes(3);
  });

  it('should refresh tools and increment loopIndex when compaction happens', async () => {
    const observedTools: Array<Tool[] | undefined> = [];
    const provider = createInfiniteStopProvider((_messages, options) => {
      observedTools.push(options?.tools as Tool[] | undefined);
    });
    const toolManager = {
      toToolsSchema: vi
        .fn()
        .mockReturnValueOnce([
          {
            type: 'function',
            function: { name: 'tool_v1', description: 'v1', parameters: {} },
          },
        ])
        .mockReturnValue([
          {
            type: 'function',
            function: { name: 'tool_v2', description: 'v2', parameters: {} },
          },
        ]),
      executeTools: vi.fn(async () => []),
    } as unknown as ToolManager;
    const agent = new Agent({
      provider,
      toolManager,
      maxSteps: 3,
    });

    vi.spyOn(
      agent as unknown as {
        needsCompaction: () => boolean;
      },
      'needsCompaction'
    )
      .mockReturnValueOnce(true)
      .mockReturnValue(false);
    vi.spyOn(
      agent as unknown as {
        performCompaction: () => Promise<void>;
      },
      'performCompaction'
    ).mockResolvedValue(undefined);

    const result = await agent.run('trigger compaction');
    expect(result.loopCount).toBe(2);
    expect(observedTools).toHaveLength(1);
    expect(observedTools[0]?.[0]?.function.name).toBe('tool_v2');
    expect(
      (toolManager.toToolsSchema as unknown as ReturnType<typeof vi.fn>).mock.calls
    ).toHaveLength(2);
  });

  it('should restore system prompt from config when existing session has empty prompt and empty context', async () => {
    const observedCalls: Array<LLMRequestMessage[]> = [];
    const provider = createSingleStepProvider((messages) => observedCalls.push(messages));
    const memoryManager = {
      initialize: vi.fn(async () => undefined),
      getSession: vi.fn(() => ({
        sessionId: 's5',
        systemPrompt: '',
        currentContextId: 'ctx-5',
        totalMessages: 0,
        compactionCount: 0,
        totalUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })),
      getContextMessages: vi.fn(() => []),
      createSession: vi.fn(async () => 's5'),
      addMessages: vi.fn(async () => undefined),
      updateMessageInContext: vi.fn(async () => undefined),
    } as unknown as MemoryManager;
    const plugin: Plugin = {
      name: 'system-prompt-hook',
      systemPrompt: (prompt) => `${prompt} [hooked]`,
    };

    const agent = new Agent({
      provider,
      toolManager: createToolManager(),
      memoryManager,
      sessionId: 's5',
      systemPrompt: 'Base system prompt',
      plugins: [plugin],
    });

    await agent.run('hello');
    expect(observedCalls[0][0].role).toBe('system');
    expect(observedCalls[0][0].content).toBe('Base system prompt [hooked]');
  });

  it('should throw when toolManager is missing at construction', () => {
    expect(
      () =>
        new Agent({
          provider: createSingleStepProvider(),
          toolManager: undefined as unknown as ToolManager,
        })
    ).toThrow('[Agent] toolManager is required');
  });

  it('should throw when config hook removes toolManager', async () => {
    const plugin: Plugin = {
      name: 'remove-tool-manager',
      config: (config) => ({
        ...(config as Record<string, unknown>),
        toolManager: undefined,
      }),
    };
    const agent = new Agent({
      provider: createSingleStepProvider(),
      toolManager: createToolManager(),
      plugins: [plugin],
    });

    await expect(agent.run('test')).rejects.toThrow('[Agent] toolManager is required');
  });

  it('should capture usage from usage-only tail chunk', async () => {
    const agent = new Agent({
      provider: createUsageTailProvider(),
      toolManager: createToolManager(),
    });

    const result = await agent.run('usage tail');
    const lastAssistant = [...agent.getMessages()]
      .reverse()
      .find((message) => message.role === 'assistant');
    expect(result.totalUsage).toEqual({
      prompt_tokens: 12,
      completion_tokens: 8,
      total_tokens: 20,
    });
    expect(result.steps[0].usage).toEqual({
      prompt_tokens: 12,
      completion_tokens: 8,
      total_tokens: 20,
    });
    expect(lastAssistant?.usage).toEqual({
      prompt_tokens: 12,
      completion_tokens: 8,
      total_tokens: 20,
    });
  });
});

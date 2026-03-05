import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../agent';
import type { Chunk, LLMProvider, LLMRequestMessage } from '../../providers';
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
});

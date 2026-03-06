import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '../agent';
import type { Chunk, LLMGenerateOptions, LLMProvider, LLMRequestMessage } from '../../providers';
import { MemoryManager, createFileStorageBundle } from '../../storage';
import type { ToolManager } from '../../tool';
import type { Plugin } from '../../hook';

function cloneMessages(messages: LLMRequestMessage[]): LLMRequestMessage[] {
  return JSON.parse(JSON.stringify(messages)) as LLMRequestMessage[];
}

function createStreamingAssemblyProvider(
  calls: Array<{ messages: LLMRequestMessage[]; options?: LLMGenerateOptions }>
): LLMProvider {
  let streamCallIndex = 0;

  return {
    config: { model: 'mock-stream-model' },
    async generate(): Promise<never> {
      throw new Error('Not used in this test');
    },
    async *generateStream(
      messages: LLMRequestMessage[],
      options?: LLMGenerateOptions
    ): AsyncGenerator<Chunk> {
      calls.push({ messages: cloneMessages(messages), options });

      if (streamCallIndex === 0) {
        streamCallIndex++;
        yield {
          index: 0,
          model: 'mock-stream-model',
          object: 'chat.completion.chunk',
          created: 1700000001,
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content: '先执行命令。',
                reasoning_content: '先确认目录结构。',
                tool_calls: [
                  {
                    id: 'call_function_stream_1',
                    type: 'function',
                    index: 0,
                    function: {
                      name: 'bash',
                      arguments: '{"command":"',
                    },
                  },
                ],
              },
            },
          ],
        };

        yield {
          index: 1,
          model: 'mock-stream-model',
          object: 'chat.completion.chunk',
          created: 1700000002,
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content: '',
                reasoning_content: '再补全命令参数。',
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      name: '',
                      arguments: 'ls -la"}',
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
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
        };
        return;
      }

      if (streamCallIndex === 1) {
        streamCallIndex++;
        yield {
          index: 0,
          model: 'mock-stream-model',
          object: 'chat.completion.chunk',
          created: 1700000003,
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content: '命令执行完成。',
                reasoning_content: '输出可用于下一步分析。',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 6,
            total_tokens: 11,
          },
        };
        return;
      }

      throw new Error(`Unexpected generateStream call index: ${streamCallIndex}`);
    },
    getTimeTimeout: () => 60_000,
    getLLMMaxTokens: () => 128_000,
    getMaxOutputTokens: () => 8_000,
  } as unknown as LLMProvider;
}

function createProviderWithChunkId(chunkId: string): LLMProvider {
  return {
    config: { model: 'mock-stream-model' },
    async generate(): Promise<never> {
      throw new Error('Not used in this test');
    },
    async *generateStream(): AsyncGenerator<Chunk> {
      yield {
        id: chunkId,
        index: 0,
        model: 'mock-stream-model',
        object: 'chat.completion.chunk',
        created: 1700000010,
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              content: 'hello from chunk id',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
        },
      };
    },
    getTimeTimeout: () => 60_000,
    getLLMMaxTokens: () => 128_000,
    getMaxOutputTokens: () => 8_000,
  } as unknown as LLMProvider;
}

describe('Agent streaming assembly', () => {
  let tempDir: string;
  let memoryManager: MemoryManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-stream-assembly-'));
    memoryManager = new MemoryManager(createFileStorageBundle(tempDir));
  });

  afterEach(async () => {
    await memoryManager.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should assemble streaming text/reasoning/tool_calls and persist complete fields', async () => {
    const providerCalls: Array<{ messages: LLMRequestMessage[]; options?: LLMGenerateOptions }> =
      [];
    const provider = createStreamingAssemblyProvider(providerCalls);
    const executeTools = vi.fn(async (toolCalls: Array<{ id: string }>) => [
      {
        toolCallId: toolCalls[0].id,
        result: { success: true, data: { stdout: 'total 0' } },
      },
    ]);
    const toolManager = {
      toToolsSchema: vi.fn(() => [
        {
          type: 'function',
          function: {
            name: 'bash',
            description: 'run shell command',
            parameters: {
              type: 'object',
              properties: {
                command: { type: 'string' },
              },
              required: ['command'],
            },
          },
        },
      ]),
      executeTools,
    } as unknown as ToolManager;

    const agent = new Agent({
      provider,
      toolManager,
      memoryManager,
      sessionId: 'stream-assembly-s1',
      systemPrompt: 'You are a practical coding assistant.',
      maxSteps: 4,
    });

    const result = await agent.run('请执行目录检查');

    expect(result.completionReason).toBe('stop');
    expect(result.steps).toHaveLength(2);
    expect(result.totalUsage).toEqual({
      prompt_tokens: 15,
      completion_tokens: 26,
      total_tokens: 41,
    });

    const firstStep = result.steps[0];
    expect(firstStep.text).toBe('先执行命令。');
    expect(firstStep.finishReason).toBe('tool_calls');
    expect(firstStep.usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    });
    expect(firstStep.toolCalls).toHaveLength(1);
    expect(firstStep.toolCalls[0].id).toBe('call_function_stream_1');
    expect(firstStep.toolCalls[0].function.name).toBe('bash');
    expect(firstStep.toolCalls[0].function.arguments).toBe('{"command":"ls -la"}');
    expect(firstStep.rawChunks).toHaveLength(2);
    expect(firstStep.rawChunks[0].object).toBe('chat.completion.chunk');
    expect(firstStep.rawChunks[0].model).toBe('mock-stream-model');
    expect(firstStep.rawChunks[0].created).toBe(1700000001);
    expect(firstStep.rawChunks[1].choices?.[0].finish_reason).toBe('tool_calls');
    expect(firstStep.rawChunks[1].usage).toEqual({
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    });

    const secondStep = result.steps[1];
    expect(secondStep.finishReason).toBe('stop');
    expect(secondStep.usage).toEqual({
      prompt_tokens: 5,
      completion_tokens: 6,
      total_tokens: 11,
    });
    expect(secondStep.rawChunks[0].choices?.[0].finish_reason).toBe('stop');

    expect(executeTools).toHaveBeenCalledTimes(1);
    const executedToolCalls = executeTools.mock.calls[0][0] as Array<{
      id: string;
      function: { name: string; arguments: string };
    }>;
    expect(executedToolCalls).toHaveLength(1);
    expect(executedToolCalls[0].id).toBe('call_function_stream_1');
    expect(executedToolCalls[0].function.name).toBe('bash');
    expect(executedToolCalls[0].function.arguments).toBe('{"command":"ls -la"}');

    const assistantMessages = result.messages.filter((m) => m.role === 'assistant');
    const firstAssistant = assistantMessages[0] as LLMRequestMessage & {
      tool_calls?: Array<{
        id: string;
        type: string;
        index: number;
        function: { name: string; arguments: string };
      }>;
    };
    const secondAssistant = assistantMessages[1] as LLMRequestMessage & {
      tool_calls?: Array<{
        id: string;
        type: string;
        index: number;
        function: { name: string; arguments: string };
      }>;
    };
    expect(assistantMessages).toHaveLength(2);
    expect(firstAssistant.content).toBe('先执行命令。');
    expect(firstAssistant.reasoning_content).toBe('先确认目录结构。再补全命令参数。');
    expect(firstAssistant.tool_calls?.[0]).toEqual({
      id: 'call_function_stream_1',
      type: 'function',
      index: 0,
      function: {
        name: 'bash',
        arguments: '{"command":"ls -la"}',
      },
    });
    expect(secondAssistant.content).toBe('命令执行完成。');
    expect(secondAssistant.reasoning_content).toBe('输出可用于下一步分析。');
    expect(secondAssistant.tool_calls).toBeUndefined();

    const history = memoryManager.getHistory({ sessionId: 'stream-assembly-s1' });
    const historyAssistants = history.filter((m) => m.role === 'assistant');
    expect(historyAssistants).toHaveLength(2);
    expect(history.every((m) => typeof m.messageId === 'string' && m.messageId.length > 0)).toBe(
      true
    );
    expect(historyAssistants[0].reasoning_content).toBe('先确认目录结构。再补全命令参数。');
    expect(historyAssistants[0].finish_reason).toBe('tool_calls');
    expect(historyAssistants[1].reasoning_content).toBe('输出可用于下一步分析。');
    expect(historyAssistants[1].finish_reason).toBe('stop');

    const historyTool = history.find((m) => m.role === 'tool');
    expect(historyTool).toBeDefined();
    expect(historyTool?.tool_call_id).toBe('call_function_stream_1');

    const restoredContextMessages = memoryManager.getContextMessages('stream-assembly-s1');
    const restoredAssistantWithReasoning = restoredContextMessages.find(
      (m) => m.role === 'assistant' && typeof m.reasoning_content === 'string'
    );
    expect(restoredAssistantWithReasoning).toBeDefined();
    expect(
      restoredContextMessages.some(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.tool_calls) &&
          m.tool_calls[0]?.function?.arguments === '{"command":"ls -la"}'
      )
    ).toBe(true);

    expect(providerCalls).toHaveLength(2);
    expect(providerCalls[0].messages[0].role).toBe('system');
    expect(
      providerCalls[1].messages.some((m) => m.role === 'assistant' && !!m.reasoning_content)
    ).toBe(true);
    expect(
      providerCalls[1].messages.some(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.tool_calls) &&
          m.tool_calls[0]?.id === 'call_function_stream_1'
      )
    ).toBe(true);
    expect(providerCalls[1].messages.some((m) => m.role === 'tool')).toBe(true);
  });

  it('should not use stream chunk id as persisted messageId', async () => {
    const chunkId = 'provider-chunk-id-1';
    const provider = createProviderWithChunkId(chunkId);
    const toolManager = {
      toToolsSchema: vi.fn(() => []),
      executeTools: vi.fn(async () => []),
    } as unknown as ToolManager;

    const agent = new Agent({
      provider,
      toolManager,
      memoryManager,
      sessionId: 'stream-chunk-id-s1',
      systemPrompt: 'You are a practical coding assistant.',
      maxSteps: 2,
    });

    const result = await agent.run('chunk id should not be message id');
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].rawChunks[0].id).toBe(chunkId);

    const history = memoryManager.getHistory({ sessionId: 'stream-chunk-id-s1' });
    const assistantMessage = history.find((item) => item.role === 'assistant');
    expect(assistantMessage).toBeDefined();
    expect(assistantMessage?.messageId).not.toBe(chunkId);
  });

  it('should include agent messageId in textDelta hook payload', async () => {
    const providerCalls: Array<{ messages: LLMRequestMessage[]; options?: LLMGenerateOptions }> =
      [];
    const provider = createStreamingAssemblyProvider(providerCalls);
    const executeTools = vi.fn(async (toolCalls: Array<{ id: string }>) => [
      {
        toolCallId: toolCalls[0].id,
        result: { success: true, data: { stdout: 'total 0' } },
      },
    ]);
    const toolManager = {
      toToolsSchema: vi.fn(() => [
        {
          type: 'function',
          function: {
            name: 'bash',
            description: 'run shell command',
            parameters: {
              type: 'object',
              properties: {
                command: { type: 'string' },
              },
              required: ['command'],
            },
          },
        },
      ]),
      executeTools,
    } as unknown as ToolManager;

    const observedDeltas: Array<{ text: string; isReasoning?: boolean; messageId?: string }> = [];
    const plugin: Plugin = {
      name: 'capture-text-delta-message-id',
      textDelta: (delta) => {
        observedDeltas.push(delta);
      },
    };

    const sessionId = 'stream-delta-message-id-s1';
    const agent = new Agent({
      provider,
      toolManager,
      memoryManager,
      sessionId,
      systemPrompt: 'You are a practical coding assistant.',
      maxSteps: 4,
      plugins: [plugin],
    });

    await agent.run('请执行目录检查');

    expect(observedDeltas.length).toBeGreaterThan(0);
    expect(observedDeltas.every((delta) => typeof delta.messageId === 'string')).toBe(true);

    const history = memoryManager.getHistory({ sessionId });
    const assistantMessageIds = history
      .filter((message) => message.role === 'assistant')
      .map((message) => message.messageId);
    const deltaMessageIds = Array.from(new Set(observedDeltas.map((delta) => delta.messageId)));

    expect(deltaMessageIds.length).toBeGreaterThan(0);
    expect(
      deltaMessageIds.every((messageId) => assistantMessageIds.includes(messageId ?? ''))
    ).toBe(true);
  });

  it('should include messageId in textDelta hook without memory manager', async () => {
    const provider = createProviderWithChunkId('provider-chunk-id-2');
    const toolManager = {
      toToolsSchema: vi.fn(() => []),
      executeTools: vi.fn(async () => []),
    } as unknown as ToolManager;

    const observedMessageIds: Array<string | undefined> = [];
    const plugin: Plugin = {
      name: 'capture-text-delta-message-id-without-memory',
      textDelta: (delta, ctx) => {
        observedMessageIds.push(delta.messageId);
        expect(delta.messageId).toBe(ctx.messageId);
      },
    };

    const agent = new Agent({
      provider,
      toolManager,
      sessionId: 'stream-delta-message-id-no-memory-s1',
      systemPrompt: 'You are a practical coding assistant.',
      maxSteps: 2,
      plugins: [plugin],
    });

    await agent.run('test');
    const assistantMessageIds = agent
      .getMessages()
      .filter((message) => message.role === 'assistant')
      .map((message) => message.messageId);

    expect(observedMessageIds.length).toBeGreaterThan(0);
    expect(observedMessageIds.every((messageId) => typeof messageId === 'string')).toBe(true);
    expect(
      observedMessageIds.every((messageId) => assistantMessageIds.includes(messageId ?? ''))
    ).toBe(true);
  });

  it('should propagate assistant messageId through message-related hook contexts', async () => {
    const provider = createStreamingAssemblyProvider([]);
    const executeTools = vi.fn(
      async (
        toolCalls: Array<{ id: string; function: { name: string; arguments: string } }>,
        _context: unknown,
        callbacks?: {
          onToolEvent?: (event: {
            toolCallId: string;
            toolName: string;
            type: 'start' | 'end';
            sequence: number;
            timestamp: number;
          }) => Promise<void> | void;
          onToolConfirm?: (request: {
            toolCallId: string;
            toolName: string;
            args: Record<string, unknown>;
            rawArgs: Record<string, unknown>;
          }) => Promise<'approve' | 'deny'> | 'approve' | 'deny';
        }
      ) => {
        const toolCall = toolCalls[0];
        await callbacks?.onToolConfirm?.({
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          args: { command: 'ls -la' },
          rawArgs: { command: 'ls -la' },
        });
        await callbacks?.onToolEvent?.({
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          type: 'start',
          sequence: 1,
          timestamp: Date.now(),
        });
        await callbacks?.onToolEvent?.({
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          type: 'end',
          sequence: 2,
          timestamp: Date.now(),
        });
        return [
          {
            toolCallId: toolCall.id,
            result: { success: true, data: { stdout: 'ok' } },
          },
        ];
      }
    );

    const toolManager = {
      toToolsSchema: vi.fn(() => [
        {
          type: 'function',
          function: {
            name: 'bash',
            description: 'run shell command',
            parameters: {
              type: 'object',
              properties: {
                command: { type: 'string' },
              },
              required: ['command'],
            },
          },
        },
      ]),
      executeTools,
    } as unknown as ToolManager;

    const observed = {
      textDelta: [] as Array<string | undefined>,
      textComplete: [] as Array<string | undefined>,
      toolUse: [] as Array<string | undefined>,
      toolResult: [] as Array<string | undefined>,
      toolConfirm: [] as Array<string | undefined>,
      toolStream: [] as Array<string | undefined>,
      step: [] as Array<string | undefined>,
    };

    const plugin: Plugin = {
      name: 'capture-message-hook-context-message-id',
      textDelta: (delta, ctx) => {
        observed.textDelta.push(ctx.messageId);
        expect(delta.messageId).toBe(ctx.messageId);
      },
      textComplete: (_text, ctx) => {
        observed.textComplete.push(ctx.messageId);
      },
      toolUse: (toolCall, ctx) => {
        observed.toolUse.push(ctx.messageId);
        return toolCall;
      },
      toolResult: (payload, ctx) => {
        observed.toolResult.push(ctx.messageId);
        return payload;
      },
      toolConfirm: (_request, ctx) => {
        observed.toolConfirm.push(ctx.messageId);
      },
      toolStream: (_event, ctx) => {
        observed.toolStream.push(ctx.messageId);
      },
      step: (_step, ctx) => {
        observed.step.push(ctx.messageId);
      },
    };

    const sessionId = 'stream-message-hook-context-s1';
    const agent = new Agent({
      provider,
      toolManager,
      memoryManager,
      sessionId,
      systemPrompt: 'You are a practical coding assistant.',
      maxSteps: 4,
      plugins: [plugin],
      onToolConfirm: () => 'approve',
    });

    await agent.run('请执行目录检查');

    const assistantMessageIds = memoryManager
      .getHistory({ sessionId })
      .filter((message) => message.role === 'assistant')
      .map((message) => message.messageId);
    const assertObservedIds = (ids: Array<string | undefined>): void => {
      expect(ids.length).toBeGreaterThan(0);
      expect(ids.every((messageId) => typeof messageId === 'string')).toBe(true);
      expect(ids.every((messageId) => assistantMessageIds.includes(messageId ?? ''))).toBe(true);
    };

    assertObservedIds(observed.textDelta);
    assertObservedIds(observed.textComplete);
    assertObservedIds(observed.toolUse);
    assertObservedIds(observed.toolResult);
    assertObservedIds(observed.toolConfirm);
    assertObservedIds(observed.toolStream);
    assertObservedIds(observed.step);
  });
});

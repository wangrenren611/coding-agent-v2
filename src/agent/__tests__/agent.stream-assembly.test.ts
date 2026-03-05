import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '../agent';
import type { Chunk, LLMGenerateOptions, LLMProvider, LLMRequestMessage } from '../../providers';
import { MemoryManager, createFileStorageBundle } from '../../storage';
import type { ToolManager } from '../../tool';

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
});

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '../agent';
import {
  LLMAbortedError,
  LLMRetryableError,
  type Chunk,
  type LLMGenerateOptions,
  type LLMProvider,
  type LLMRequestMessage,
} from '../../providers';
import { MemoryManager, createFileStorageBundle } from '../../storage';
import type { ToolManager } from '../../tool';

function cloneMessages(messages: LLMRequestMessage[]): LLMRequestMessage[] {
  return JSON.parse(JSON.stringify(messages)) as LLMRequestMessage[];
}

function createFailureStreamChunk(): Chunk {
  return {
    index: 0,
    choices: [
      {
        index: 0,
        delta: {
          role: 'assistant',
          content: '先执行命令',
          reasoning_content: '先构造命令参数',
          tool_calls: [
            {
              id: 'call_failure_1',
              type: 'function',
              index: 0,
              function: {
                name: 'bash',
                arguments: '{"command":"ls -la"}',
              },
            },
          ],
        },
      },
    ],
    usage: {
      prompt_tokens: 3,
      completion_tokens: 7,
      total_tokens: 10,
    },
  };
}

function createRetryFailureProvider(
  calls: Array<{ messages: LLMRequestMessage[]; options?: LLMGenerateOptions }>
): LLMProvider {
  return {
    config: { model: 'mock-failure-model' },
    async generate(): Promise<never> {
      throw new Error('Not used in this test');
    },
    async *generateStream(
      messages: LLMRequestMessage[],
      options?: LLMGenerateOptions
    ): AsyncGenerator<Chunk> {
      calls.push({ messages: cloneMessages(messages), options });
      yield createFailureStreamChunk();
      throw new LLMRetryableError('temporary network failure', 1);
    },
    getTimeTimeout: () => 60_000,
    getLLMMaxTokens: () => 128_000,
    getMaxOutputTokens: () => 8_000,
  } as unknown as LLMProvider;
}

function createAbortFailureProvider(
  calls: Array<{ messages: LLMRequestMessage[]; options?: LLMGenerateOptions }>
): LLMProvider {
  return {
    config: { model: 'mock-failure-model' },
    async generate(): Promise<never> {
      throw new Error('Not used in this test');
    },
    async *generateStream(
      messages: LLMRequestMessage[],
      options?: LLMGenerateOptions
    ): AsyncGenerator<Chunk> {
      calls.push({ messages: cloneMessages(messages), options });
      yield createFailureStreamChunk();
      throw new LLMAbortedError('stream cancelled');
    },
    getTimeTimeout: () => 60_000,
    getLLMMaxTokens: () => 128_000,
    getMaxOutputTokens: () => 8_000,
  } as unknown as LLMProvider;
}

describe('Agent streaming failure persistence', () => {
  let tempDir: string;
  let memoryManager: MemoryManager;
  let toolManager: ToolManager;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let executeTools: any;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-stream-failure-'));
    memoryManager = new MemoryManager(createFileStorageBundle(tempDir));
    executeTools = vi.fn(async (): Promise<unknown[]> => []);
    toolManager = {
      toToolsSchema: vi.fn(() => [
        {
          type: 'function',
          function: {
            name: 'bash',
            description: 'run shell',
            parameters: {
              type: 'object',
              properties: {
                command: { type: 'string' },
              },
            },
          },
        },
      ]),
      executeTools,
    } as unknown as ToolManager;
  });

  afterEach(async () => {
    await memoryManager.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should persist partial assistant fields when stream fails and retries are exhausted', async () => {
    const providerCalls: Array<{ messages: LLMRequestMessage[]; options?: LLMGenerateOptions }> =
      [];
    const agent = new Agent({
      provider: createRetryFailureProvider(providerCalls),
      toolManager,
      memoryManager,
      sessionId: 'stream-failure-retry',
      systemPrompt: 'You are a practical coding assistant.',
      maxSteps: 2,
      maxRetries: 0,
    });

    await expect(agent.run('执行失败重试测试')).rejects.toThrow('Max retries exceeded');
    expect(providerCalls).toHaveLength(1);
    expect(executeTools).not.toHaveBeenCalled();

    const history = memoryManager.getHistory({ sessionId: 'stream-failure-retry' });
    const assistant = history.find((m) => m.role === 'assistant');
    const assistantToolCalls = (assistant?.tool_calls ?? []) as Array<{
      id: string;
      function: { name: string; arguments: string };
    }>;
    expect(assistant).toBeDefined();
    expect(assistant?.content).toBe('先执行命令');
    expect(assistant?.reasoning_content).toBe('先构造命令参数');
    expect(assistant?.usage).toEqual({
      prompt_tokens: 3,
      completion_tokens: 7,
      total_tokens: 10,
    });
    expect(assistantToolCalls).toHaveLength(1);
    expect(assistantToolCalls[0].id).toBe('call_failure_1');
    expect(assistantToolCalls[0].function.name).toBe('bash');
    expect(assistantToolCalls[0].function.arguments).toBe('{"command":"ls -la"}');
    expect(assistant?.finish_reason).toBeUndefined();
    expect(history.some((m) => m.role === 'tool')).toBe(false);
  });

  it('should persist partial assistant fields when provider aborts stream', async () => {
    const providerCalls: Array<{ messages: LLMRequestMessage[]; options?: LLMGenerateOptions }> =
      [];
    const agent = new Agent({
      provider: createAbortFailureProvider(providerCalls),
      toolManager,
      memoryManager,
      sessionId: 'stream-failure-abort',
      systemPrompt: 'You are a practical coding assistant.',
      maxSteps: 2,
    });

    const result = await agent.run('执行中断测试');
    expect(result.completionReason).toBe('stop');
    expect(providerCalls).toHaveLength(1);
    expect(executeTools).not.toHaveBeenCalled();

    const history = memoryManager.getHistory({ sessionId: 'stream-failure-abort' });
    const assistant = history.find((m) => m.role === 'assistant');
    const assistantToolCalls = (assistant?.tool_calls ?? []) as Array<{ id: string }>;
    expect(assistant).toBeDefined();
    expect(assistant?.content).toBe('先执行命令');
    expect(assistant?.reasoning_content).toBe('先构造命令参数');
    expect(assistant?.usage).toEqual({
      prompt_tokens: 3,
      completion_tokens: 7,
      total_tokens: 10,
    });
    expect(assistantToolCalls).toHaveLength(1);
    expect(assistantToolCalls[0].id).toBe('call_failure_1');
    expect(assistant?.finish_reason).toBeUndefined();
    expect(history.some((m) => m.role === 'tool')).toBe(false);
  });
});

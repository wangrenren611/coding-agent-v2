import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { StatelessAgent } from '../index';
import type {
  AgentMetric,
  AgentTraceEvent,
  CompactionInfo,
  Message,
  StreamEvent,
  ToolPolicyCheckInfo,
  ToolPolicyDecision,
} from '../../types';
import type { ToolManager } from '../../tool/tool-manager';
import { DefaultToolManager } from '../../tool/tool-manager';
import { BashTool } from '../../tool/bash';
import { WriteFileTool } from '../../tool/write-file';
import type { Chunk, LLMProvider, ToolCall } from '../../../providers';
import {
  LLMAuthError,
  LLMBadRequestError,
  LLMError,
  LLMNotFoundError,
  LLMPermanentError,
  LLMRateLimitError,
  LLMRetryableError,
} from '../../../providers';
import { AgentError } from '../error';
import type { ToolConcurrencyPolicy } from '../../tool/types';
import * as compactionModule from '../compaction';
import { InMemoryToolExecutionLedger } from '../tool-execution-ledger';

type ChunkDelta = NonNullable<NonNullable<Chunk['choices']>[number]>['delta'];

type AgentPrivate = {
  executeTool: (
    toolCall: ToolCall,
    stepIndex: number,
    callbacks?: {
      onMessage?: (message: Message) => void | Promise<void>;
      onMetric?: (metric: AgentMetric) => void | Promise<void>;
      onTrace?: (event: AgentTraceEvent) => void | Promise<void>;
      onToolPolicy?: (
        info: ToolPolicyCheckInfo
      ) => ToolPolicyDecision | Promise<ToolPolicyDecision>;
    },
    abortSignal?: AbortSignal,
    executionId?: string
  ) => AsyncGenerator<StreamEvent>;
  processToolCalls: (
    calls: ToolCall[],
    messages: Message[],
    stepIndex: number,
    callbacks?: { onMessage?: (message: Message) => void | Promise<void> }
  ) => AsyncGenerator<StreamEvent>;
  convertMessageToLLMMessage: (msg: Message) => unknown;
  safeCallback: (cb: ((arg: string) => Promise<void>) | undefined, arg: string) => Promise<void>;
  safeErrorCallback: (
    cb: ((err: Error) => { retry: boolean }) | undefined,
    err: Error
  ) => Promise<{ retry: boolean } | undefined>;
  mergeToolCalls: (
    existing: Array<{ id: string; function: { arguments: string } }>,
    incoming: Array<{ id: string; function: { arguments: string } }>,
    messageId: string
  ) => Promise<
    Array<{
      id: string;
      function: { arguments: string };
    }>
  >;
  yieldCheckpoint: (
    executionId: string | undefined,
    step: number,
    last: Message | undefined,
    callbacks?: { onCheckpoint: (cp: unknown) => void }
  ) => AsyncGenerator<StreamEvent>;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  normalizeError: (error: unknown) => AgentError;
  throwIfAborted: (signal?: AbortSignal) => void;
  runWithConcurrencyAndLock: <T>(
    tasks: Array<{ lockKey?: string; run: () => Promise<T> }>,
    limit: number
  ) => Promise<T[]>;
  resolveToolConcurrencyPolicy: (toolCall: ToolCall) => ToolConcurrencyPolicy;
};

type TestDelta = Partial<ChunkDelta> & { finish_reason?: string };
type TestChunk = Omit<Chunk, 'choices'> & {
  choices?: Array<{
    index: number;
    delta: TestDelta;
  }>;
};

function toStream(chunks: TestChunk[]): AsyncGenerator<Chunk> {
  return (async function* () {
    for (const chunk of chunks) {
      yield chunk as Chunk;
    }
  })();
}

async function collectEvents(generator: AsyncGenerator<StreamEvent>): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of generator) {
    events.push(event);
  }
  return events;
}

function createProvider() {
  return {
    config: {} as Record<string, unknown>,
    generate: vi.fn(),
    generateStream: vi.fn(),
    getTimeTimeout: vi.fn(() => 1),
    getLLMMaxTokens: vi.fn(() => 1),
    getMaxOutputTokens: vi.fn(() => 1),
  } as unknown as LLMProvider;
}

function createToolManager() {
  return {
    execute: vi.fn(),
    registerTool: vi.fn(),
    getTools: vi.fn(() => []),
    getConcurrencyPolicy: vi.fn(() => ({ mode: 'exclusive' as const })),
  } as unknown as ToolManager;
}

function createInput() {
  const message: Message = {
    messageId: 'u1',
    type: 'user',
    role: 'user',
    content: 'hello',
    timestamp: Date.now(),
  };

  return {
    executionId: 'exec_1',
    conversationId: 'conv_1',
    messages: [message],
    maxSteps: 4,
  };
}

describe('StatelessAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('runs stream and yields chunk/reasoning/done without tool calls', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'Hello' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { reasoning_content: 'think' } }],
        },
        {
          index: 0,
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      toolExecutionLedger: new InMemoryToolExecutionLedger(),
    });
    const onMessage = vi.fn();
    const events = await collectEvents(
      agent.runStream(createInput(), { onMessage, onCheckpoint: vi.fn() })
    );

    expect(events.map((e) => e.type)).toEqual(['progress', 'chunk', 'reasoning_chunk', 'done']);
    expect(events[3]?.data).toMatchObject({ finishReason: 'stop', steps: 1 });
    expect(onMessage).toHaveBeenCalledOnce();
    expect(onMessage.mock.calls[0]?.[0]).toMatchObject({
      role: 'assistant',
      content: 'Hello',
      reasoning_content: 'think',
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    });
  });

  it('captures usage from a usage-only tail chunk after finish_reason', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'ok' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
        {
          index: 0,
          choices: [],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 8,
            total_tokens: 20,
          },
        },
      ])
    );

    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      toolExecutionLedger: new InMemoryToolExecutionLedger(),
    });
    const onMessage = vi.fn();

    await collectEvents(agent.runStream(createInput(), { onMessage, onCheckpoint: vi.fn() }));

    expect(onMessage).toHaveBeenCalledOnce();
    expect(onMessage.mock.calls[0]?.[0]).toMatchObject({
      role: 'assistant',
      content: 'ok',
      usage: {
        prompt_tokens: 12,
        completion_tokens: 8,
        total_tokens: 20,
      },
    });
  });

  it('filters empty assistant-text messages before calling generateStream', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'ok' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      toolExecutionLedger: new InMemoryToolExecutionLedger(),
    });
    await collectEvents(
      agent.runStream(
        {
          ...createInput(),
          messages: [
            createInput().messages[0]!,
            {
              messageId: 'empty_assistant',
              role: 'assistant',
              type: 'assistant-text',
              content: '',
              reasoning_content: '',
              timestamp: Date.now(),
            },
          ],
        },
        { onMessage: vi.fn(), onCheckpoint: vi.fn() }
      )
    );

    const generateStreamCalls = (
      provider.generateStream as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    expect(generateStreamCalls).toHaveLength(1);
    const llmMessages = generateStreamCalls[0]?.[0] as Array<{ role: string; content: unknown }>;
    expect(llmMessages).toHaveLength(1);
    expect(llmMessages[0]).toMatchObject({ role: 'user', content: 'hello' });
  });

  it('passes abortSignal to llm generateStream config', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'ok' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    const controller = new AbortController();
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      toolExecutionLedger: new InMemoryToolExecutionLedger(),
    });
    await collectEvents(
      agent.runStream(
        {
          ...createInput(),
          abortSignal: controller.signal,
          config: { temperature: 0.1 },
        },
        { onMessage: vi.fn(), onCheckpoint: vi.fn() }
      )
    );

    const generateStreamCalls = (
      provider.generateStream as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    expect(generateStreamCalls).toHaveLength(1);
    const callConfig = generateStreamCalls[0]?.[1] as {
      temperature?: number;
      abortSignal?: AbortSignal;
    };
    expect(callConfig.temperature).toBe(0.1);
    expect(callConfig.abortSignal).toBe(controller.signal);
  });

  it('passes top-level tools into llm generateStream config', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'ok' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    const tools = [
      {
        type: 'function',
        function: {
          name: 'bash',
          description: 'Execute shell command',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string' },
            },
            required: ['command'],
          },
        },
      },
    ];

    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      toolExecutionLedger: new InMemoryToolExecutionLedger(),
    });
    await collectEvents(
      agent.runStream(
        {
          ...createInput(),
          tools,
        },
        { onMessage: vi.fn(), onCheckpoint: vi.fn() }
      )
    );

    const generateStreamCalls = (
      provider.generateStream as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    expect(generateStreamCalls).toHaveLength(1);
    const callConfig = generateStreamCalls[0]?.[1] as { tools?: unknown[] };
    expect(callConfig.tools).toEqual(tools);
  });

  it('uses toolManager schemas when input.tools is omitted', async () => {
    const provider = createProvider();
    const manager = new DefaultToolManager();
    manager.registerTool(new BashTool());
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'ok' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      toolExecutionLedger: new InMemoryToolExecutionLedger(),
    });
    await collectEvents(
      agent.runStream(
        {
          ...createInput(),
        },
        { onMessage: vi.fn(), onCheckpoint: vi.fn() }
      )
    );

    const generateStreamCalls = (
      provider.generateStream as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    expect(generateStreamCalls).toHaveLength(1);
    const callConfig = generateStreamCalls[0]?.[1] as {
      tools?: Array<{ function?: { name?: string } }>;
    };
    expect(callConfig.tools?.some((tool) => tool.function?.name === 'bash')).toBe(true);
  });

  it('injects systemPrompt as system message when input has no system role message', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'ok' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      toolExecutionLedger: new InMemoryToolExecutionLedger(),
    });
    await collectEvents(
      agent.runStream(
        {
          ...createInput(),
          systemPrompt: 'You are a strict code assistant',
        },
        { onMessage: vi.fn(), onCheckpoint: vi.fn() }
      )
    );

    const generateStreamCalls = (
      provider.generateStream as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    const llmMessages = generateStreamCalls[0]?.[0] as Array<{ role: string; content: unknown }>;
    expect(llmMessages[0]).toMatchObject({
      role: 'system',
      content: 'You are a strict code assistant',
    });
  });

  it('emits max_steps done event when loop exits by step budget', async () => {
    const provider = createProvider();
    const manager = createToolManager();

    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    id: 'tool_max_steps_1',
                    type: 'function',
                    index: 0,
                    function: { name: 'bash', arguments: '{"command":"echo hi"}' },
                  },
                ],
                finish_reason: 'tool_calls',
              } as unknown as ChunkDelta,
            },
          ],
        },
      ])
    );
    manager.execute = vi.fn().mockResolvedValue({ success: true, output: 'ok' });

    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      toolExecutionLedger: new InMemoryToolExecutionLedger(),
    });
    const events = await collectEvents(
      agent.runStream(
        {
          ...createInput(),
          maxSteps: 1,
        },
        { onMessage: vi.fn(), onCheckpoint: vi.fn() }
      )
    );

    const doneEvent = events.find((event) => event.type === 'done');
    expect(doneEvent).toMatchObject({
      type: 'done',
      data: {
        finishReason: 'max_steps',
        steps: 1,
      },
    });
  });

  it('emits executionId on all progress events including per-tool progress', async () => {
    const provider = createProvider();
    const manager = createToolManager();

    provider.generateStream = vi
      .fn()
      .mockReturnValueOnce(
        toStream([
          {
            index: 0,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      id: 'tool_progress_1',
                      type: 'function',
                      index: 0,
                      function: { name: 'bash', arguments: '{"command":"echo 1"}' },
                    },
                    {
                      id: 'tool_progress_2',
                      type: 'function',
                      index: 1,
                      function: { name: 'bash', arguments: '{"command":"echo 2"}' },
                    },
                  ],
                  finish_reason: 'tool_calls',
                } as unknown as ChunkDelta,
              },
            ],
          },
        ])
      )
      .mockReturnValueOnce(
        toStream([
          {
            index: 0,
            choices: [{ index: 0, delta: { content: 'done' } }],
          },
          {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          },
        ])
      );
    manager.execute = vi.fn().mockResolvedValue({ success: true, output: 'ok' });

    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const events = await collectEvents(
      agent.runStream(
        {
          ...createInput(),
          executionId: 'exec_progress_1',
          maxSteps: 3,
        },
        { onMessage: vi.fn(), onCheckpoint: vi.fn() }
      )
    );
    const progressEvents = events.filter((event) => event.type === 'progress');
    expect(progressEvents.length).toBeGreaterThan(0);
    for (const progressEvent of progressEvents) {
      expect(progressEvent.data).toMatchObject({
        executionId: 'exec_progress_1',
      });
    }
  });

  it('merges tool call fragments by index when follow-up chunk omits id/name', async () => {
    const provider = createProvider();
    const manager = createToolManager();

    provider.generateStream = vi
      .fn()
      .mockReturnValueOnce(
        toStream([
          {
            index: 0,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      id: 'call_fragment_1',
                      type: 'function',
                      index: 0,
                      function: { name: 'bash', arguments: '{' },
                    },
                  ],
                },
              },
            ],
          },
          {
            index: 0,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      function: { arguments: '"command":"ls -la"}' },
                    },
                  ],
                  finish_reason: 'tool_calls',
                } as unknown as ChunkDelta,
              },
            ],
          },
        ])
      )
      .mockReturnValueOnce(
        toStream([
          {
            index: 0,
            choices: [{ index: 0, delta: { content: 'done' } }],
          },
          {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          },
        ])
      );
    manager.execute = vi.fn().mockResolvedValue({ success: true, output: 'ok' });

    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const events = await collectEvents(
      agent.runStream(createInput(), { onMessage: vi.fn(), onCheckpoint: vi.fn() })
    );

    expect(manager.execute).toHaveBeenCalledTimes(1);
    expect(
      (manager.execute as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]?.[0]
    ).toMatchObject({
      id: 'call_fragment_1',
      function: {
        name: 'bash',
        arguments: '{"command":"ls -la"}',
      },
    });
    expect(events.filter((event) => event.type === 'tool_result')).toHaveLength(1);
  });

  it('returns invalid tool arguments back to llm without replaying broken arguments upstream', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    const toolCallId = 'call_invalid_args_1';
    const invalidToolOutput =
      'Invalid arguments format for tool glob: JSON Parse error: Unexpected EOF';

    provider.generateStream = vi
      .fn()
      .mockReturnValueOnce(
        toStream([
          {
            index: 0,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      id: toolCallId,
                      type: 'function',
                      index: 0,
                      function: { name: 'glob', arguments: '' },
                    },
                  ],
                  finish_reason: 'tool_calls',
                } as unknown as ChunkDelta,
              },
            ],
          },
        ])
      )
      .mockImplementationOnce(
        (
          messages: Array<{
            role: string;
            content?: unknown;
            tool_call_id?: string;
            tool_calls?: ToolCall[];
          }>
        ) => {
          const assistantToolCallMessage = messages.find(
            (message) => message.role === 'assistant' && Array.isArray(message.tool_calls)
          );
          const invalidToolCall = assistantToolCallMessage?.tool_calls?.find(
            (toolCall) => toolCall.id === toolCallId
          );
          const toolResultMessage = messages.find(
            (message) => message.role === 'tool' && message.tool_call_id === toolCallId
          );

          expect(toolResultMessage).toMatchObject({
            content: invalidToolOutput,
            tool_call_id: toolCallId,
          });

          if (invalidToolCall?.function.arguments === '') {
            throw new LLMBadRequestError(
              `400 Bad Request - invalid params, invalid function arguments json string, tool_call_id: ${toolCallId} (2013)`
            );
          }

          expect(invalidToolCall).toMatchObject({
            id: toolCallId,
            function: {
              name: 'glob',
              arguments: '{}',
            },
          });

          return toStream([
            {
              index: 0,
              choices: [{ index: 0, delta: { content: 'retry with valid args' } }],
            },
            {
              index: 0,
              choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
            },
          ]);
        }
      );
    manager.execute = vi.fn().mockResolvedValue({
      success: false,
      output: invalidToolOutput,
    });

    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      toolExecutionLedger: new InMemoryToolExecutionLedger(),
    });

    const events = await collectEvents(
      agent.runStream(createInput(), { onMessage: vi.fn(), onCheckpoint: vi.fn() })
    );

    expect(provider.generateStream).toHaveBeenCalledTimes(2);
    expect(events.some((event) => event.type === 'error')).toBe(false);
    expect(events.filter((event) => event.type === 'tool_result')).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      data: {
        finishReason: 'stop',
        steps: 2,
      },
    });
  });

  it('enforces llm timeout budget and emits timeout error event', async () => {
    vi.useFakeTimers();
    const provider = createProvider();
    const manager = createToolManager();

    provider.generateStream = vi
      .fn()
      .mockImplementation((_messages: unknown, _options?: { abortSignal?: AbortSignal }) =>
        (async function* () {
          await new Promise<void>((resolve) => setTimeout(resolve, 30));
          yield {
            index: 0,
            choices: [{ index: 0, delta: { content: 'late chunk' } }],
          } as Chunk;
          yield {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          } as Chunk;
        })()
      );

    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 1,
      timeoutBudgetMs: 20,
      llmTimeoutRatio: 1,
    });
    const eventsPromise = collectEvents(
      agent.runStream(
        {
          ...createInput(),
          maxSteps: 2,
        },
        { onMessage: vi.fn(), onCheckpoint: vi.fn() }
      )
    );

    await vi.advanceTimersByTimeAsync(40);
    const events = await eventsPromise;
    const errorEvent = events.find((event) => event.type === 'error');
    expect(errorEvent).toMatchObject({
      type: 'error',
      data: {
        errorCode: 'AGENT_TIMEOUT_BUDGET_EXCEEDED',
        category: 'timeout',
      },
    });

    const generateStreamCalls = (
      provider.generateStream as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls;
    const callConfig = generateStreamCalls[0]?.[1] as { abortSignal?: AbortSignal };
    expect(callConfig.abortSignal).toBeDefined();
  });

  it('applies tool timeout budget through toolAbortSignal', async () => {
    vi.useFakeTimers();
    const provider = createProvider();
    const manager = createToolManager();

    provider.generateStream = vi
      .fn()
      .mockReturnValueOnce(
        toStream([
          {
            index: 0,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      id: 'tool_budget_1',
                      type: 'function',
                      index: 0,
                      function: { name: 'bash', arguments: '{"command":"sleep 1"}' },
                    },
                  ],
                  finish_reason: 'tool_calls',
                } as unknown as ChunkDelta,
              },
            ],
          },
        ])
      )
      .mockReturnValueOnce(
        toStream([
          {
            index: 0,
            choices: [{ index: 0, delta: { content: 'done' } }],
          },
          {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          },
        ])
      );

    manager.execute = vi.fn().mockImplementation(async (_toolCall, options) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      if (options.toolAbortSignal?.aborted) {
        return {
          success: false,
          error: { message: 'tool stage budget exceeded' },
        };
      }
      return { success: true, output: 'ok' };
    });

    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 1,
      timeoutBudgetMs: 30,
      llmTimeoutRatio: 0.9,
    });

    const eventsPromise = collectEvents(
      agent.runStream(
        {
          ...createInput(),
          maxSteps: 4,
        },
        { onMessage: vi.fn(), onCheckpoint: vi.fn() }
      )
    );
    await vi.advanceTimersByTimeAsync(50);
    const events = await eventsPromise;

    const toolResult = events.find((event) => event.type === 'tool_result');
    expect(toolResult).toMatchObject({
      type: 'tool_result',
      data: {
        tool_call_id: 'tool_budget_1',
        content: 'tool stage budget exceeded',
      },
    });
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      data: { finishReason: 'stop' },
    });
  });

  it('emits structured metrics, trace events, and log contexts for successful run', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'telemetry-ok' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const onMetric = vi.fn(async (_metric: AgentMetric) => undefined);
    const onTrace = vi.fn(async (_event: AgentTraceEvent) => undefined);
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3, logger });

    await collectEvents(
      agent.runStream(createInput(), {
        onMessage: vi.fn(),
        onCheckpoint: vi.fn(),
        onMetric,
        onTrace,
      })
    );

    expect(onMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'agent.llm.duration_ms',
        unit: 'ms',
        tags: expect.objectContaining({ executionId: 'exec_1', stepIndex: 1 }),
      })
    );
    expect(onMetric).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'agent.run.duration_ms',
        unit: 'ms',
        tags: expect.objectContaining({ executionId: 'exec_1', outcome: 'done' }),
      })
    );

    const traceEvents = onTrace.mock.calls.map((call) => call[0] as AgentTraceEvent);
    expect(
      traceEvents.some(
        (event) =>
          event.name === 'agent.run' && event.phase === 'start' && event.traceId === 'exec_1'
      )
    ).toBe(true);
    expect(traceEvents.some((event) => event.name === 'agent.run' && event.phase === 'end')).toBe(
      true
    );

    const infoCalls = logger.info.mock.calls as Array<[string, Record<string, unknown>]>;
    expect(
      infoCalls.some(
        ([message, context]) => message === '[Agent] run.start' && context.executionId === 'exec_1'
      )
    ).toBe(true);
    expect(
      infoCalls.some(
        ([message, context]) =>
          message === '[Agent] run.finish' &&
          context.executionId === 'exec_1' &&
          typeof context.latencyMs === 'number'
      )
    ).toBe(true);
  });

  it('marks llm step metric success=false when llm stream throws unknown error', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockImplementation(() =>
      (async function* () {
        yield* [] as Chunk[];
        throw new Error('network interrupted');
      })()
    );

    const onMetric = vi.fn(async (_metric: AgentMetric) => undefined);
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const events = await collectEvents(
      agent.runStream(createInput(), {
        onMessage: vi.fn(),
        onCheckpoint: vi.fn(),
        onError: async () => ({ retry: false }),
        onMetric,
      })
    );

    expect(events.at(-1)).toMatchObject({
      type: 'error',
      data: { message: 'network interrupted' },
    });

    const llmMetric = onMetric.mock.calls
      .map((call) => call[0] as AgentMetric)
      .find((metric) => metric.name === 'agent.llm.duration_ms');
    expect(llmMetric).toBeDefined();
    expect(llmMetric?.tags?.success).toBe('false');
  });

  it('marks tool stage metric success=false when tool execution throws unknown error', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    id: 'tool_chaos_1',
                    type: 'function',
                    index: 0,
                    function: { name: 'bash', arguments: '{"command":"echo chaos"}' },
                  },
                ],
                finish_reason: 'tool_calls',
              } as unknown as ChunkDelta,
            },
          ],
        },
      ])
    );
    manager.execute = vi.fn().mockRejectedValue(new Error('tool crashed'));

    const onMetric = vi.fn(async (_metric: AgentMetric) => undefined);
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const events = await collectEvents(
      agent.runStream(createInput(), {
        onMessage: vi.fn(),
        onCheckpoint: vi.fn(),
        onError: async () => ({ retry: false }),
        onMetric,
      })
    );

    expect(events.at(-1)).toMatchObject({
      type: 'error',
      data: { message: 'tool crashed' },
    });

    const toolStageMetric = onMetric.mock.calls
      .map((call) => call[0] as AgentMetric)
      .find((metric) => metric.name === 'agent.tool.stage.duration_ms');
    expect(toolStageMetric).toBeDefined();
    expect(toolStageMetric?.tags?.success).toBe('false');
  });

  it('stops immediately when abortSignal is already aborted', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn();

    const controller = new AbortController();
    controller.abort();

    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const events = await collectEvents(
      agent.runStream(
        {
          ...createInput(),
          abortSignal: controller.signal,
        },
        { onMessage: vi.fn(), onCheckpoint: vi.fn() }
      )
    );

    expect(events.map((event) => event.type)).toEqual(['error']);
    expect(events[0]).toMatchObject({
      type: 'error',
      data: {
        name: 'AgentAbortedError',
        code: 1002,
        errorCode: 'AGENT_ABORTED',
        category: 'abort',
        retryable: false,
        httpStatus: 499,
        message: 'Operation aborted',
      },
    });
    expect(provider.generateStream).not.toHaveBeenCalled();
  });

  it('isolates message state across concurrent runs on the same instance', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockImplementation((messages: Array<{ content: string }>) => {
      const marker = messages[0]?.content || 'unknown';
      return toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: `reply:${marker}` } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ]);
    });

    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const onMessageA = vi.fn();
    const onMessageB = vi.fn();

    await Promise.all([
      collectEvents(
        agent.runStream(
          {
            ...createInput(),
            executionId: 'exec_A',
            messages: [
              {
                messageId: 'a1',
                type: 'user',
                role: 'user',
                content: 'A',
                timestamp: 1,
              },
            ],
          },
          { onMessage: onMessageA, onCheckpoint: vi.fn() }
        )
      ),
      collectEvents(
        agent.runStream(
          {
            ...createInput(),
            executionId: 'exec_B',
            messages: [
              {
                messageId: 'b1',
                type: 'user',
                role: 'user',
                content: 'B',
                timestamp: 2,
              },
            ],
          },
          { onMessage: onMessageB, onCheckpoint: vi.fn() }
        )
      ),
    ]);

    const calledUserContents = (
      provider.generateStream as unknown as { mock: { calls: unknown[][] } }
    ).mock.calls
      .map((call) => (call[0] as Array<{ content: string }>)?.[0]?.content ?? '')
      .sort();
    expect(calledUserContents).toEqual(['A', 'B']);
    expect(onMessageA.mock.calls[0]?.[0]).toMatchObject({ content: 'reply:A' });
    expect(onMessageB.mock.calls[0]?.[0]).toMatchObject({ content: 'reply:B' });
  });

  it('calls compact when needsCompaction is true and uses compacted messages for llm', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'ok' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    const compactSpy = vi.spyOn(compactionModule, 'compact').mockResolvedValue({
      messages: [
        {
          messageId: 'cmp_1',
          type: 'user',
          role: 'user',
          content: 'compacted input',
          timestamp: 1,
        },
      ],
      summaryMessage: null,
      removedMessageIds: ['u1'],
    });

    const onCompaction = vi.fn();
    const agent = new StatelessAgent(provider, manager, {
      enableCompaction: true,
      compactionTriggerRatio: 0,
    });
    const events = await collectEvents(
      agent.runStream(createInput(), { onMessage: vi.fn(), onCheckpoint: vi.fn(), onCompaction })
    );

    expect(compactSpy).toHaveBeenCalledOnce();
    const firstCallArgs = (provider.generateStream as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0];
    const llmMessages = firstCallArgs?.[0] as Array<{ content: string }>;
    expect(llmMessages[0]?.content).toBe('compacted input');
    expect(events.some((event) => event.type === 'compaction')).toBe(true);
    expect(onCompaction).toHaveBeenCalledOnce();
    expect(onCompaction.mock.calls[0]?.[0] as CompactionInfo).toMatchObject({
      executionId: 'exec_1',
      stepIndex: 1,
      removedMessageIds: ['u1'],
      messageCountBefore: 1,
      messageCountAfter: 1,
    });
    compactSpy.mockRestore();
  });

  it('continues execution when compaction throws error', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'still works' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    const compactSpy = vi
      .spyOn(compactionModule, 'compact')
      .mockRejectedValue(new Error('compact failed'));
    const logger = { error: vi.fn() };

    const agent = new StatelessAgent(provider, manager, {
      enableCompaction: true,
      compactionTriggerRatio: 0,
      logger,
    });
    const events = await collectEvents(
      agent.runStream(createInput(), { onMessage: vi.fn(), onCheckpoint: vi.fn() })
    );

    expect(compactSpy).toHaveBeenCalledOnce();
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      data: { finishReason: 'stop', steps: 1 },
    });
    expect(logger.error).toHaveBeenCalled();
    compactSpy.mockRestore();
  });

  it('processes tool calls, emits checkpoint, and continues to next step', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi
      .fn()
      .mockReturnValueOnce(
        toStream([
          {
            index: 0,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      id: 'call_1',
                      type: 'function',
                      index: 0,
                      function: { name: 'bash', arguments: '{"a":' },
                    },
                  ],
                },
              },
            ],
          },
          {
            index: 0,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      id: 'call_1',
                      type: 'function',
                      index: 0,
                      function: { name: 'bash', arguments: '1}' },
                    },
                  ],
                  finish_reason: 'tool_calls',
                } as unknown as ChunkDelta,
              },
            ],
          },
        ])
      )
      .mockReturnValueOnce(
        toStream([
          {
            index: 0,
            choices: [{ index: 0, delta: { content: 'final' } }],
          },
          {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          },
        ])
      );

    manager.execute = vi.fn().mockImplementation(async (_toolCall, options) => {
      options.onChunk?.({ type: 'stdout', data: 'streamed' });
      const decision = await options.onConfirm?.({
        toolCallId: 'call_1',
        toolName: 'bash',
        arguments: '{"a":1}',
      });
      expect(decision).toEqual({ approved: true, message: 'ok' });
      return { success: true, output: 'tool-output' };
    });

    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const onMessage = vi.fn();
    const onCheckpoint = vi.fn();
    const toolChunkSpy = vi.fn();
    agent.on('tool_chunk', toolChunkSpy);
    agent.on(
      'tool_confirm',
      (info: { resolve: (decision: { approved: boolean; message?: string }) => void }) => {
        info.resolve({ approved: true, message: 'ok' });
      }
    );

    const events = await collectEvents(agent.runStream(createInput(), { onMessage, onCheckpoint }));

    expect(events.some((event) => event.type === 'tool_call')).toBe(true);
    expect(events.some((event) => event.type === 'tool_result')).toBe(true);
    expect(events.some((event) => event.type === 'checkpoint')).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      data: { finishReason: 'stop', steps: 2 },
    });
    expect(onMessage).toHaveBeenCalledTimes(3);
    expect(onCheckpoint).toHaveBeenCalledTimes(1);
    expect(toolChunkSpy).toHaveBeenCalledTimes(1);
    expect(manager.execute).toHaveBeenCalledTimes(1);
  });

  it('adds write buffer info to tool result when write_file arguments are truncated', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    id: 'wf_call_1',
                    type: 'function',
                    index: 0,
                    function: {
                      name: 'write_file',
                      arguments: '{"path":"a.txt","content":"partial',
                    },
                  },
                ],
                finish_reason: 'tool_calls',
              } as unknown as ChunkDelta,
            },
          ],
        },
      ])
    );

    manager.execute = vi.fn().mockResolvedValue({
      success: false,
      error: {
        name: 'InvalidArgumentsError',
        message: 'Invalid arguments format for tool write_file',
      },
    });

    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const events = await collectEvents(
      agent.runStream(
        {
          ...createInput(),
          maxSteps: 1,
        },
        { onMessage: vi.fn(), onCheckpoint: vi.fn() }
      )
    );

    const toolResultEvent = events.find((event) => event.type === 'tool_result');
    expect(toolResultEvent).toBeDefined();
    const toolResultContent = (toolResultEvent?.data as Message).content as string;
    const payload = JSON.parse(toolResultContent) as {
      ok: boolean;
      code: string;
      message: string;
      buffer?: { bufferId: string };
      nextAction: string;
    };
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe('WRITE_FILE_PARTIAL_BUFFERED');
    expect(payload.message).toContain('Invalid arguments format for tool write_file');
    expect(payload.buffer?.bufferId).toBe('wf_call_1');
    expect(payload.nextAction).toBe('finalize');

    const writeBufferCacheDir = path.resolve(process.cwd(), '.renx', 'write-file');
    const cacheEntries = await fs.readdir(writeBufferCacheDir).catch(() => []);
    await Promise.all(
      cacheEntries
        .filter((entry) => entry.includes('_wf_call_1_'))
        .map((entry) => fs.rm(path.join(writeBufferCacheDir, entry), { force: true }))
    );
  });

  it('supports streamed write_file direct/finalize across multiple llm turns', async () => {
    const provider = createProvider();

    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-index-write-e2e-'));
    const bufferDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-index-write-buffer-'));
    const targetPath = path.join(allowedDir, 'streamed-write.txt');
    const fullContent = 'abcdefghijklmnop';

    try {
      const manager = new DefaultToolManager();
      manager.registerTool(
        new WriteFileTool({
          allowedDirectories: [allowedDir],
          bufferBaseDir: bufferDir,
          maxChunkBytes: 8,
        })
      );

      const buildToolCallStream = (toolCallId: string, args: Record<string, unknown>) => {
        const raw = JSON.stringify(args);
        const cut = Math.max(1, Math.floor(raw.length / 2));
        return toStream([
          {
            index: 0,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      id: toolCallId,
                      type: 'function',
                      index: 0,
                      function: { name: 'write_file', arguments: raw.slice(0, cut) },
                    },
                  ],
                },
              },
            ],
          },
          {
            index: 0,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      id: toolCallId,
                      type: 'function',
                      index: 0,
                      function: { name: 'write_file', arguments: raw.slice(cut) },
                    },
                  ],
                  finish_reason: 'tool_calls',
                } as unknown as ChunkDelta,
              },
            ],
          },
        ]);
      };

      provider.generateStream = vi
        .fn()
        .mockReturnValueOnce(
          buildToolCallStream('wf_direct_1', {
            path: targetPath,
            mode: 'direct',
            content: fullContent,
          })
        )
        .mockReturnValueOnce(
          buildToolCallStream('wf_finalize_2', {
            path: targetPath,
            mode: 'finalize',
            bufferId: 'wf_direct_1',
          })
        )
        .mockReturnValueOnce(
          toStream([
            {
              index: 0,
              choices: [{ index: 0, delta: { content: 'done' } }],
            },
            {
              index: 0,
              choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
            },
          ])
        );

      const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
      const events = await collectEvents(
        agent.runStream(
          {
            ...createInput(),
            maxSteps: 6,
          },
          { onMessage: vi.fn(), onCheckpoint: vi.fn() }
        )
      );

      const toolResults = events.filter((event) => event.type === 'tool_result');
      expect(toolResults).toHaveLength(2);

      const payloads = toolResults.map(
        (event) =>
          JSON.parse((event.data as Message).content as string) as {
            code: string;
            nextAction: string;
          }
      );
      expect(payloads.map((payload) => payload.code)).toEqual([
        'WRITE_FILE_PARTIAL_BUFFERED',
        'WRITE_FILE_FINALIZE_OK',
      ]);
      expect(payloads.map((payload) => payload.nextAction)).toEqual(['finalize', 'none']);
      expect(events.at(-1)).toMatchObject({
        type: 'done',
        data: { finishReason: 'stop' },
      });

      expect(await fs.readFile(targetPath, 'utf8')).toBe(fullContent);
    } finally {
      await fs.rm(allowedDir, { recursive: true, force: true });
      await fs.rm(bufferDir, { recursive: true, force: true });
    }
  });

  it('supports streamed write_file finalize by bufferId without path after an oversized direct write', async () => {
    const provider = createProvider();

    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-index-finalize-id-'));
    const bufferDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-index-finalize-buffer-'));
    const targetPath = path.join(allowedDir, 'streamed-finalize-by-id.txt');
    const fullContent = 'abcdefghijklmnop';

    try {
      const manager = new DefaultToolManager();
      manager.registerTool(
        new WriteFileTool({
          allowedDirectories: [allowedDir],
          bufferBaseDir: bufferDir,
          maxChunkBytes: 8,
        })
      );

      const buildToolCallStream = (toolCallId: string, args: Record<string, unknown>) => {
        const raw = JSON.stringify(args);
        const cut = Math.max(1, Math.floor(raw.length / 2));
        return toStream([
          {
            index: 0,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      id: toolCallId,
                      type: 'function',
                      index: 0,
                      function: { name: 'write_file', arguments: raw.slice(0, cut) },
                    },
                  ],
                },
              },
            ],
          },
          {
            index: 0,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      id: toolCallId,
                      type: 'function',
                      index: 0,
                      function: { name: 'write_file', arguments: raw.slice(cut) },
                    },
                  ],
                  finish_reason: 'tool_calls',
                } as unknown as ChunkDelta,
              },
            ],
          },
        ]);
      };

      provider.generateStream = vi
        .fn()
        .mockReturnValueOnce(
          buildToolCallStream('wf_direct_finalize_id_1', {
            path: targetPath,
            mode: 'direct',
            content: fullContent,
          })
        )
        .mockReturnValueOnce(
          buildToolCallStream('wf_finalize_by_id_2', {
            mode: 'finalize',
            bufferId: 'wf_direct_finalize_id_1',
          })
        )
        .mockReturnValueOnce(
          toStream([
            {
              index: 0,
              choices: [{ index: 0, delta: { content: 'done' } }],
            },
            {
              index: 0,
              choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
            },
          ])
        );

      const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
      const events = await collectEvents(
        agent.runStream(
          {
            ...createInput(),
            maxSteps: 5,
          },
          { onMessage: vi.fn(), onCheckpoint: vi.fn() }
        )
      );

      const toolResults = events.filter((event) => event.type === 'tool_result');
      expect(toolResults).toHaveLength(2);

      const payloads = toolResults.map(
        (event) =>
          JSON.parse((event.data as Message).content as string) as {
            code: string;
            nextAction: string;
          }
      );
      expect(payloads.map((payload) => payload.code)).toEqual([
        'WRITE_FILE_PARTIAL_BUFFERED',
        'WRITE_FILE_FINALIZE_OK',
      ]);
      expect(payloads.map((payload) => payload.nextAction)).toEqual(['finalize', 'none']);
      expect(await fs.readFile(targetPath, 'utf8')).toBe(fullContent);
    } finally {
      await fs.rm(allowedDir, { recursive: true, force: true });
      await fs.rm(bufferDir, { recursive: true, force: true });
    }
  });

  it('executeTool uses UnknownError message when tool fails without explicit error object', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    manager.execute = vi.fn().mockImplementation(async (_toolCall, options) => {
      options.onChunk?.({ type: 'stdout', data: 'chunk-1' });
      const decision = await options.onConfirm?.({
        toolCallId: 'call_2',
        toolName: 'bash',
        arguments: '{}',
      });
      expect(decision).toEqual({ approved: true, message: 'approved' });
      return { success: false };
    });

    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const onMessage = vi.fn();
    const toolChunkSpy = vi.fn();
    agent.on('tool_chunk', toolChunkSpy);
    agent.on(
      'tool_confirm',
      (info: { resolve: (decision: { approved: boolean; message?: string }) => void }) => {
        info.resolve({ approved: true, message: 'approved' });
      }
    );

    const toolEvents = await collectEvents(
      (agent as unknown as AgentPrivate).executeTool(
        {
          id: 'call_2',
          type: 'function',
          index: 0,
          function: { name: 'bash', arguments: '{}' },
        },
        2,
        { onMessage }
      )
    );

    expect(toolEvents).toHaveLength(1);
    expect(toolEvents[0]).toMatchObject({
      type: 'tool_result',
      data: { role: 'tool', content: 'Unknown error', tool_call_id: 'call_2' },
    });
    expect(onMessage).toHaveBeenCalledOnce();
    expect(toolChunkSpy).toHaveBeenCalledOnce();
  });

  it('executeTool forwards onToolPolicy hook to tool executor context', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    manager.execute = vi.fn().mockImplementation(async (_toolCall, options) => {
      const policyDecision = await options.onPolicyCheck?.({
        toolCallId: 'call_policy',
        toolName: 'bash',
        arguments: '{"command":"rm -rf /"}',
        parsedArguments: { command: 'rm -rf /' },
      });
      expect(policyDecision).toEqual({
        allowed: false,
        code: 'DANGEROUS_COMMAND',
        message: 'rm blocked',
      });
      return {
        success: false,
        error: {
          name: 'ToolPolicyDeniedError',
          message: 'Tool bash blocked by policy [DANGEROUS_COMMAND]: rm blocked',
        },
      };
    });

    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const onToolPolicy = vi.fn().mockResolvedValue({
      allowed: false,
      code: 'DANGEROUS_COMMAND',
      message: 'rm blocked',
    });

    const events = await collectEvents(
      (agent as unknown as AgentPrivate).executeTool(
        {
          id: 'call_policy',
          type: 'function',
          index: 0,
          function: { name: 'bash', arguments: '{"command":"rm -rf /"}' },
        },
        1,
        { onMessage: vi.fn(), onToolPolicy }
      )
    );

    expect(onToolPolicy).toHaveBeenCalledWith({
      toolCallId: 'call_policy',
      toolName: 'bash',
      arguments: '{"command":"rm -rf /"}',
      parsedArguments: { command: 'rm -rf /' },
    });
    expect(events[0]).toMatchObject({
      type: 'tool_result',
      data: { content: 'Tool bash blocked by policy [DANGEROUS_COMMAND]: rm blocked' },
    });
  });

  it('executeTool resolves confirmation through tool_confirm event', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    manager.execute = vi.fn().mockImplementation(async (_toolCall, options) => {
      options.onChunk?.({ type: 'stdout', data: 'chunk-2' });
      const decision = await options.onConfirm?.({
        toolCallId: 'call_3',
        toolName: 'bash',
        arguments: '{}',
      });
      return decision?.approved ? { success: true, output: 'approved-output' } : { success: false };
    });

    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const onMessage = vi.fn();
    const toolChunkSpy = vi.fn();
    agent.on('tool_chunk', toolChunkSpy);
    agent.on(
      'tool_confirm',
      (info: { resolve: (decision: { approved: boolean; message?: string }) => void }) => {
        info.resolve({ approved: true, message: 'approved' });
      }
    );

    const toolEvents = await collectEvents(
      (agent as unknown as AgentPrivate).executeTool(
        {
          id: 'call_3',
          type: 'function',
          index: 0,
          function: { name: 'bash', arguments: '{}' },
        },
        3,
        { onMessage }
      )
    );

    expect(toolEvents[0]).toMatchObject({
      type: 'tool_result',
      data: { content: 'approved-output', tool_call_id: 'call_3' },
    });
    expect(onMessage).toHaveBeenCalledOnce();
    expect(toolChunkSpy).toHaveBeenCalledOnce();
  });

  it('executeTool handles pre-aborted signal at confirmation stage', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    const abortController = new AbortController();
    manager.execute = vi.fn().mockImplementation(async (_toolCall, options) => {
      abortController.abort();
      const decision = await options.onConfirm?.({
        toolCallId: 'call_abort_confirm',
        toolName: 'bash',
        arguments: '{}',
      });
      expect(decision).toEqual({ approved: false, message: 'Operation aborted' });
      return {
        success: false,
        error: { message: decision?.message || 'Operation aborted' },
      };
    });

    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const toolEvents = await collectEvents(
      (agent as unknown as AgentPrivate).executeTool(
        {
          id: 'call_abort_confirm',
          type: 'function',
          index: 0,
          function: { name: 'bash', arguments: '{}' },
        },
        1,
        { onMessage: vi.fn() },
        abortController.signal
      )
    );

    expect(toolEvents[0]).toMatchObject({
      type: 'tool_result',
      data: { content: 'Operation aborted', tool_call_id: 'call_abort_confirm' },
    });
  });

  it('processToolCalls executes tools and appends tool message', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    manager.execute = vi.fn().mockResolvedValue({ success: true, output: 'tool-ok' });
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const messages: Message[] = [
      {
        messageId: 'm0',
        type: 'assistant-text',
        role: 'assistant',
        content: 'before',
        timestamp: 1,
      },
    ];

    const events = await collectEvents(
      (agent as unknown as AgentPrivate).processToolCalls(
        [
          {
            id: 'tool_1',
            type: 'function',
            index: 0,
            function: { name: 'bash', arguments: '{"command":"echo ok"}' },
          },
        ],
        messages,
        1,
        { onMessage: vi.fn() }
      )
    );

    expect(events.map((e) => e.type)).toEqual(['progress', 'tool_result']);
    expect(messages.at(-1)).toMatchObject({
      role: 'tool',
      content: 'tool-ok',
      tool_call_id: 'tool_1',
    });
  });

  it('reuses cached tool result for duplicate executionId + toolCallId across reruns', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    const toolCallId = 'tool_idempotent_1';
    manager.execute = vi.fn().mockResolvedValue({ success: true, output: 'tool-once' });

    const toolCallStream = () =>
      toStream([
        {
          index: 0,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    id: toolCallId,
                    type: 'function',
                    index: 0,
                    function: { name: 'bash', arguments: '{"command":"echo once"}' },
                  },
                ],
                finish_reason: 'tool_calls',
              } as unknown as ChunkDelta,
            },
          ],
        },
      ]);

    const doneStream = () =>
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'done' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ]);

    provider.generateStream = vi
      .fn()
      .mockReturnValueOnce(toolCallStream())
      .mockReturnValueOnce(doneStream())
      .mockReturnValueOnce(toolCallStream())
      .mockReturnValueOnce(doneStream());

    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      toolExecutionLedger: new InMemoryToolExecutionLedger(),
    });

    const runInput = () => ({
      ...createInput(),
      executionId: 'exec_idempotent_1',
      maxSteps: 3,
    });

    const firstEvents = await collectEvents(
      agent.runStream(runInput(), { onMessage: vi.fn(), onCheckpoint: vi.fn() })
    );
    const secondEvents = await collectEvents(
      agent.runStream(runInput(), { onMessage: vi.fn(), onCheckpoint: vi.fn() })
    );

    const firstToolResult = firstEvents.find((event) => event.type === 'tool_result');
    const secondToolResult = secondEvents.find((event) => event.type === 'tool_result');
    expect(firstToolResult).toMatchObject({
      type: 'tool_result',
      data: { content: 'tool-once', tool_call_id: toolCallId },
    });
    expect(secondToolResult).toMatchObject({
      type: 'tool_result',
      data: { content: 'tool-once', tool_call_id: toolCallId },
    });
    expect(manager.execute).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent duplicate tool execution for same executionId + toolCallId', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    const toolCallId = 'tool_idempotent_race_1';

    manager.execute = vi.fn().mockImplementation(
      async () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ success: true, output: 'tool-race-once' }), 20);
        })
    );

    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      toolExecutionLedger: new InMemoryToolExecutionLedger(),
    });
    const agentPrivate = agent as unknown as AgentPrivate;
    const toolCall: ToolCall = {
      id: toolCallId,
      type: 'function',
      index: 0,
      function: { name: 'bash', arguments: '{"command":"echo race"}' },
    };

    const [eventsA, eventsB] = await Promise.all([
      collectEvents(
        agentPrivate.executeTool(
          toolCall,
          1,
          { onMessage: vi.fn() },
          undefined,
          'exec_idempotent_race_1'
        )
      ),
      collectEvents(
        agentPrivate.executeTool(
          toolCall,
          1,
          { onMessage: vi.fn() },
          undefined,
          'exec_idempotent_race_1'
        )
      ),
    ]);
    const toolResultA = eventsA.find((event) => event.type === 'tool_result');
    const toolResultB = eventsB.find((event) => event.type === 'tool_result');

    expect(toolResultA).toMatchObject({
      type: 'tool_result',
      data: { content: 'tool-race-once', tool_call_id: toolCallId },
    });
    expect(toolResultB).toMatchObject({
      type: 'tool_result',
      data: { content: 'tool-race-once', tool_call_id: toolCallId },
    });
    expect(manager.execute).toHaveBeenCalledTimes(1);
  });

  it('does not cache tool result by default without external ledger', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    manager.execute = vi.fn().mockResolvedValue({ success: true, output: 'tool-no-cache' });

    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const agentPrivate = agent as unknown as AgentPrivate;
    const toolCall: ToolCall = {
      id: 'tool_no_cache_1',
      type: 'function',
      index: 0,
      function: { name: 'bash', arguments: '{"command":"echo nc"}' },
    };

    await collectEvents(
      agentPrivate.executeTool(toolCall, 1, { onMessage: vi.fn() }, undefined, 'exec_no_cache_1')
    );
    await collectEvents(
      agentPrivate.executeTool(toolCall, 1, { onMessage: vi.fn() }, undefined, 'exec_no_cache_1')
    );

    expect(manager.execute).toHaveBeenCalledTimes(2);
  });

  it('processToolCalls supports bounded concurrency when configured', async () => {
    vi.useFakeTimers();
    const provider = createProvider();
    const manager = createToolManager();
    (
      manager as unknown as { getConcurrencyPolicy: (toolCall: ToolCall) => ToolConcurrencyPolicy }
    ).getConcurrencyPolicy = vi.fn(() => ({ mode: 'parallel-safe' }));
    let inFlight = 0;
    let maxInFlight = 0;
    manager.execute = vi.fn().mockImplementation(async (toolCall: ToolCall) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return { success: true, output: `ok-${toolCall.id}` };
    });
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      maxConcurrentToolCalls: 2,
    });
    const messages: Message[] = [
      {
        messageId: 'm0',
        type: 'assistant-text',
        role: 'assistant',
        content: 'before',
        timestamp: 1,
      },
    ];

    const eventsPromise = collectEvents(
      (agent as unknown as AgentPrivate).processToolCalls(
        [
          {
            id: 'tool_1',
            type: 'function',
            index: 0,
            function: { name: 'bash', arguments: '{"command":"echo 1"}' },
          },
          {
            id: 'tool_2',
            type: 'function',
            index: 1,
            function: { name: 'bash', arguments: '{"command":"echo 2"}' },
          },
        ],
        messages,
        1,
        { onMessage: vi.fn() }
      )
    );

    await vi.advanceTimersByTimeAsync(20);
    const events = await eventsPromise;

    expect(maxInFlight).toBe(2);
    expect(events.map((e) => e.type)).toEqual([
      'progress',
      'progress',
      'tool_result',
      'tool_result',
    ]);
    expect(messages.at(-2)).toMatchObject({ tool_call_id: 'tool_1' });
    expect(messages.at(-1)).toMatchObject({ tool_call_id: 'tool_2' });
  });

  it('processToolCalls enforces lockKey to avoid conflicting concurrent tools', async () => {
    vi.useFakeTimers();
    const provider = createProvider();
    const manager = createToolManager();
    (
      manager as unknown as { getConcurrencyPolicy: (toolCall: ToolCall) => ToolConcurrencyPolicy }
    ).getConcurrencyPolicy = vi.fn((toolCall: ToolCall) => ({
      mode: 'parallel-safe',
      lockKey: toolCall.id === 'tool_3' ? 'other-file' : 'same-file',
    }));

    let inFlight = 0;
    let maxInFlight = 0;
    manager.execute = vi.fn().mockImplementation(async (_toolCall: ToolCall) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return { success: true, output: 'ok' };
    });

    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      maxConcurrentToolCalls: 3,
    });
    const messages: Message[] = [
      {
        messageId: 'm0',
        type: 'assistant-text',
        role: 'assistant',
        content: 'before',
        timestamp: 1,
      },
    ];

    const eventsPromise = collectEvents(
      (agent as unknown as AgentPrivate).processToolCalls(
        [
          {
            id: 'tool_1',
            type: 'function',
            index: 0,
            function: { name: 'bash', arguments: '{"command":"echo 1"}' },
          },
          {
            id: 'tool_2',
            type: 'function',
            index: 1,
            function: { name: 'bash', arguments: '{"command":"echo 2"}' },
          },
          {
            id: 'tool_3',
            type: 'function',
            index: 2,
            function: { name: 'bash', arguments: '{"command":"echo 3"}' },
          },
        ],
        messages,
        1,
        { onMessage: vi.fn() }
      )
    );

    await vi.advanceTimersByTimeAsync(20);
    await vi.advanceTimersByTimeAsync(20);
    await eventsPromise;

    expect(maxInFlight).toBe(2);
    expect(manager.execute).toHaveBeenCalledTimes(3);
  });

  it('processToolCalls builds mixed exclusive/parallel execution waves', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    manager.execute = vi.fn().mockImplementation(async (toolCall: ToolCall) => {
      return { success: true, output: `ok-${toolCall.id}` };
    });

    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      maxConcurrentToolCalls: 3,
      toolConcurrencyPolicyResolver: (toolCall: ToolCall) =>
        toolCall.id === 'tool_exclusive' ? { mode: 'exclusive' } : { mode: 'parallel-safe' },
    });

    const messages: Message[] = [
      {
        messageId: 'm0',
        type: 'assistant-text',
        role: 'assistant',
        content: 'before',
        timestamp: 1,
      },
    ];

    const events = await collectEvents(
      (agent as unknown as AgentPrivate).processToolCalls(
        [
          {
            id: 'tool_exclusive',
            type: 'function',
            index: 0,
            function: { name: 'bash', arguments: '{"command":"echo e"}' },
          },
          {
            id: 'tool_parallel',
            type: 'function',
            index: 1,
            function: { name: 'bash', arguments: '{"command":"echo p"}' },
          },
        ],
        messages,
        1,
        { onMessage: vi.fn() }
      )
    );

    expect(events.map((e) => e.type)).toEqual([
      'progress',
      'progress',
      'tool_result',
      'tool_result',
    ]);
    expect(messages.at(-2)).toMatchObject({ tool_call_id: 'tool_exclusive' });
    expect(messages.at(-1)).toMatchObject({ tool_call_id: 'tool_parallel' });
  });

  it('executeTool maps success without output to summary content', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    manager.execute = vi.fn().mockResolvedValue({ success: true });
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });

    const events = await collectEvents(
      (agent as unknown as AgentPrivate).executeTool(
        {
          id: 'call_no_output',
          type: 'function',
          index: 0,
          function: { name: 'bash', arguments: '{}' },
        },
        1
      )
    );

    expect(events[0]).toMatchObject({
      type: 'tool_result',
      data: {
        content: 'Command completed successfully with no output.',
        tool_call_id: 'call_no_output',
        metadata: {
          toolResult: {
            summary: 'Command completed successfully with no output.',
            success: true,
          },
        },
      },
    });
  });

  it('executeTool uses explicit tool error message when provided', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    manager.execute = vi.fn().mockResolvedValue({
      success: false,
      error: { message: 'tool failed explicitly' } as { message: string },
    });
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });

    const events = await collectEvents(
      (agent as unknown as AgentPrivate).executeTool(
        {
          id: 'call_err_message',
          type: 'function',
          index: 0,
          function: { name: 'bash', arguments: '{}' },
        },
        1
      )
    );

    expect(events[0]).toMatchObject({
      type: 'tool_result',
      data: { content: 'tool failed explicitly', tool_call_id: 'call_err_message' },
    });
  });

  it('marks tool metric success=false when tool returns failed result without errorCode', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    manager.execute = vi.fn().mockResolvedValue({
      success: false,
      error: { message: 'tool failed without code' },
    });
    const onMetric = vi.fn(async (_metric: AgentMetric) => undefined);
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });

    const events = await collectEvents(
      (agent as unknown as AgentPrivate).executeTool(
        {
          id: 'call_err_no_code',
          type: 'function',
          index: 0,
          function: { name: 'bash', arguments: '{}' },
        },
        1,
        { onMessage: vi.fn(), onMetric }
      )
    );

    expect(events[0]).toMatchObject({
      type: 'tool_result',
      data: { content: 'tool failed without code', tool_call_id: 'call_err_no_code' },
    });

    const toolMetric = onMetric.mock.calls
      .map((call) => call[0] as AgentMetric)
      .find((metric) => metric.name === 'agent.tool.duration_ms');
    expect(toolMetric).toBeDefined();
    expect(toolMetric?.tags?.success).toBe('false');
  });

  it('marks tool metric success=false when tool execution throws', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    manager.execute = vi.fn().mockRejectedValue(new Error('chaos tool crash'));
    const onMetric = vi.fn(async (_metric: AgentMetric) => undefined);
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });

    await expect(
      collectEvents(
        (agent as unknown as AgentPrivate).executeTool(
          {
            id: 'call_throw',
            type: 'function',
            index: 0,
            function: { name: 'bash', arguments: '{}' },
          },
          1,
          { onMessage: vi.fn(), onMetric }
        )
      )
    ).rejects.toThrow('chaos tool crash');

    const toolMetric = onMetric.mock.calls
      .map((call) => call[0] as AgentMetric)
      .find((metric) => metric.name === 'agent.tool.duration_ms');
    expect(toolMetric).toBeDefined();
    expect(toolMetric?.tags?.success).toBe('false');
  });

  it('yields error and stops when retry decision is false', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockImplementation(() =>
      (async function* () {
        for (const chunk of [] as Chunk[]) {
          yield chunk;
        }
        throw new Error('llm failed');
      })()
    );

    const onError = vi.fn().mockResolvedValue({ retry: false });
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const events = await collectEvents(
      agent.runStream(createInput(), { onMessage: vi.fn(), onCheckpoint: vi.fn(), onError })
    );

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(AgentError);
    expect(events.map((e) => e.type)).toEqual(['progress', 'error']);
    expect(events[1]).toMatchObject({
      type: 'error',
      data: {
        name: 'UnknownError',
        code: 1005,
        errorCode: 'AGENT_UNKNOWN_ERROR',
        category: 'internal',
        retryable: false,
        httpStatus: 500,
        message: 'llm failed',
      },
    });
  });

  it('retries after onError decision and succeeds on later attempt', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi
      .fn()
      .mockImplementationOnce(() =>
        (async function* () {
          for (const chunk of [] as Chunk[]) {
            yield chunk;
          }
          throw new Error('temporary');
        })()
      )
      .mockReturnValueOnce(
        toStream([
          {
            index: 0,
            choices: [{ index: 0, delta: { content: 'ok' } }],
          },
          {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          },
        ])
      );

    const onError = vi.fn().mockResolvedValue({ retry: true });
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      backoffConfig: { initialDelayMs: 1, maxDelayMs: 1, base: 2, jitter: false },
    });
    const events = await collectEvents(
      agent.runStream(createInput(), { onMessage: vi.fn(), onCheckpoint: vi.fn(), onError })
    );

    expect(onError).toHaveBeenCalledOnce();
    expect(events.map((e) => e.type)).toEqual(['progress', 'error', 'progress', 'chunk', 'done']);
  });

  it('retries retryable upstream errors by default when onError does not provide a decision', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi
      .fn()
      .mockImplementationOnce(() =>
        (async function* () {
          for (const chunk of [] as Chunk[]) {
            yield chunk;
          }
          throw new LLMRetryableError(
            '500 Internal Server Error - 操作失败',
            undefined,
            'SERVER_500'
          );
        })()
      )
      .mockReturnValueOnce(
        toStream([
          {
            index: 0,
            choices: [{ index: 0, delta: { content: 'ok-after-retry' } }],
          },
          {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          },
        ])
      );

    const onError = vi.fn().mockResolvedValue(undefined);
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      backoffConfig: { initialDelayMs: 1, maxDelayMs: 1, base: 2, jitter: false },
    });
    const events = await collectEvents(
      agent.runStream(createInput(), { onMessage: vi.fn(), onCheckpoint: vi.fn(), onError })
    );

    expect(onError).toHaveBeenCalledOnce();
    expect(events.map((e) => e.type)).toEqual(['progress', 'error', 'progress', 'chunk', 'done']);
    expect(events[1]).toMatchObject({
      type: 'error',
      data: {
        name: 'AgentUpstreamServerError',
        errorCode: 'AGENT_UPSTREAM_SERVER',
        retryable: true,
      },
    });
  });

  it('stops with max-retries when retryable upstream errors keep failing', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockImplementation(() =>
      (async function* () {
        for (const chunk of [] as Chunk[]) {
          yield chunk;
        }
        throw new LLMRetryableError('upstream 500', undefined, 'SERVER_500');
      })()
    );

    const onError = vi.fn().mockResolvedValue(undefined);
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 2,
      backoffConfig: { initialDelayMs: 1, maxDelayMs: 1, base: 2, jitter: false },
    });
    const events = await collectEvents(
      agent.runStream(createInput(), { onMessage: vi.fn(), onCheckpoint: vi.fn(), onError })
    );

    expect(onError).toHaveBeenCalledTimes(2);
    expect(provider.generateStream).toHaveBeenCalledTimes(2);
    expect(events.map((event) => event.type)).toEqual([
      'progress',
      'error',
      'progress',
      'error',
      'error',
    ]);
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      data: {
        name: 'MaxRetriesError',
        errorCode: 'AGENT_MAX_RETRIES_REACHED',
      },
    });
  });

  it('stops immediately for non-retryable upstream errors when onError has no decision', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockImplementation(() =>
      (async function* () {
        for (const chunk of [] as Chunk[]) {
          yield chunk;
        }
        throw new LLMAuthError('Invalid API key');
      })()
    );

    const onError = vi.fn().mockResolvedValue(undefined);
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const events = await collectEvents(
      agent.runStream(createInput(), { onMessage: vi.fn(), onCheckpoint: vi.fn(), onError })
    );

    expect(onError).toHaveBeenCalledOnce();
    expect(provider.generateStream).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.type)).toEqual(['progress', 'error']);
    expect(events[1]).toMatchObject({
      type: 'error',
      data: {
        name: 'AgentUpstreamAuthError',
        errorCode: 'AGENT_UPSTREAM_AUTH',
        retryable: false,
      },
    });
  });

  it('does not leak retry state across separate executions on the same instance', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi
      .fn()
      .mockImplementationOnce(() =>
        (async function* () {
          for (const chunk of [] as Chunk[]) {
            yield chunk;
          }
          throw new Error('first run fail');
        })()
      )
      .mockReturnValueOnce(
        toStream([
          {
            index: 0,
            choices: [{ index: 0, delta: { content: 'second run ok' } }],
          },
          {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          },
        ])
      );

    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 1,
      backoffConfig: { initialDelayMs: 1, maxDelayMs: 1, base: 2, jitter: false },
    });
    const run1Events = await collectEvents(
      agent.runStream(createInput(), {
        onMessage: vi.fn(),
        onCheckpoint: vi.fn(),
        onError: async () => ({ retry: true }),
      })
    );
    const run2Events = await collectEvents(
      agent.runStream(createInput(), {
        onMessage: vi.fn(),
        onCheckpoint: vi.fn(),
      })
    );

    expect(run1Events.map((event) => event.type)).toEqual(['progress', 'error', 'error']);
    expect(run2Events.at(-1)).toMatchObject({
      type: 'done',
      data: { finishReason: 'stop', steps: 1 },
    });
    expect(provider.generateStream).toHaveBeenCalledTimes(2);
  });

  it('stops when local retry attempts reach maxRetryCount', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockImplementation(() =>
      (async function* () {
        for (const chunk of [] as Chunk[]) {
          yield chunk;
        }
        throw new Error('always fail');
      })()
    );
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 1 });
    const events = await collectEvents(
      agent.runStream(createInput(), {
        onMessage: vi.fn(),
        onCheckpoint: vi.fn(),
        onError: async () => ({ retry: true }),
      })
    );

    expect(events.map((event) => event.type)).toEqual(['progress', 'error', 'error']);
    expect(events.at(-1)).toMatchObject({
      type: 'error',
      data: { message: 'Max retries reached' },
    });
    expect(provider.generateStream).toHaveBeenCalledTimes(1);
  });

  it('waits for backoff delay before retrying llm call', async () => {
    vi.useFakeTimers();
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi
      .fn()
      .mockImplementationOnce(() =>
        (async function* () {
          for (const chunk of [] as Chunk[]) {
            yield chunk;
          }
          throw new Error('temporary');
        })()
      )
      .mockReturnValueOnce(
        toStream([
          {
            index: 0,
            choices: [{ index: 0, delta: { content: 'ok' } }],
          },
          {
            index: 0,
            choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
          },
        ])
      );

    const onError = vi.fn().mockResolvedValue({ retry: true });
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      backoffConfig: { initialDelayMs: 20, maxDelayMs: 20, base: 2, jitter: false },
    });

    const eventsPromise = collectEvents(
      agent.runStream(createInput(), { onMessage: vi.fn(), onCheckpoint: vi.fn(), onError })
    );

    await vi.advanceTimersByTimeAsync(19);
    expect(provider.generateStream).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    const events = await eventsPromise;

    expect(provider.generateStream).toHaveBeenCalledTimes(2);
    expect(events.map((e) => e.type)).toEqual(['progress', 'error', 'progress', 'chunk', 'done']);
  });

  it('yields aborted error when llm stream throws AbortError', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockImplementation(() =>
      (async function* () {
        for (const chunk of [] as Chunk[]) {
          yield chunk;
        }
        throw Object.assign(new Error('Operation aborted'), { name: 'AbortError' });
      })()
    );

    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const events = await collectEvents(
      agent.runStream(createInput(), {
        onMessage: vi.fn(),
        onCheckpoint: vi.fn(),
        onError: vi.fn(),
      })
    );

    expect(events.map((event) => event.type)).toEqual(['progress', 'error']);
    expect(events[1]).toMatchObject({
      type: 'error',
      data: { name: 'AgentAbortedError', message: 'Operation aborted' },
    });
  });

  it('stops retry sleep with aborted error when signal aborts during backoff', async () => {
    vi.useFakeTimers();
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockImplementation(() =>
      (async function* () {
        for (const chunk of [] as Chunk[]) {
          yield chunk;
        }
        throw new Error('temporary');
      })()
    );

    const controller = new AbortController();
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 3,
      backoffConfig: { initialDelayMs: 100, maxDelayMs: 100, base: 2, jitter: false },
    });

    const eventsPromise = collectEvents(
      agent.runStream(
        { ...createInput(), abortSignal: controller.signal },
        { onMessage: vi.fn(), onCheckpoint: vi.fn(), onError: async () => ({ retry: true }) }
      )
    );

    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    const events = await eventsPromise;

    expect(events.at(-1)).toMatchObject({
      type: 'error',
      data: { name: 'AgentAbortedError', message: 'Operation aborted' },
    });
  });

  it('rethrows non-abort sleep errors during retry delay', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockImplementation(() =>
      (async function* () {
        for (const chunk of [] as Chunk[]) {
          yield chunk;
        }
        throw new Error('temporary');
      })()
    );

    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    (agent as unknown as { sleep: (ms: number, signal?: AbortSignal) => Promise<void> }).sleep = vi
      .fn()
      .mockRejectedValue(new Error('sleep crash'));

    await expect(
      collectEvents(
        agent.runStream(createInput(), {
          onMessage: vi.fn(),
          onCheckpoint: vi.fn(),
          onError: async () => ({ retry: true }),
        })
      )
    ).rejects.toThrow('sleep crash');
  });

  it('private helpers handle callback errors and message conversion', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    const logger = { error: vi.fn() };
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 2, logger });
    const defaultConfigAgent = new StatelessAgent(provider, manager, {});
    const agentPrivate = agent as unknown as AgentPrivate;

    const message: Message = {
      messageId: 'm1',
      type: 'assistant-text',
      id: 'legacy-id',
      role: 'assistant',
      content: 'text',
      reasoning_content: 'reason',
      tool_call_id: 'tool-1',
      tool_calls: [
        {
          id: 'tool-1',
          type: 'function',
          index: 0,
          function: { name: 'bash', arguments: '{}' },
        },
      ],
      timestamp: 1,
    };

    const llmMessage = agentPrivate.convertMessageToLLMMessage(message);
    expect(llmMessage).toMatchObject({
      role: 'assistant',
      content: 'text',
      id: 'legacy-id',
      reasoning_content: 'reason',
      tool_call_id: 'tool-1',
      tool_calls: [
        {
          id: 'tool-1',
          function: {
            arguments: '{}',
          },
        },
      ],
    });

    const invalidToolArgsMessage: Message = {
      ...message,
      tool_calls: [
        {
          id: 'tool-invalid',
          type: 'function',
          index: 0,
          function: { name: 'glob', arguments: '' },
        },
      ],
    };
    const sanitizedLlmMessage = agentPrivate.convertMessageToLLMMessage(invalidToolArgsMessage) as {
      tool_calls?: ToolCall[];
    };
    expect(sanitizedLlmMessage.tool_calls?.[0]?.function.arguments).toBe('{}');
    expect(invalidToolArgsMessage.tool_calls?.[0]?.function.arguments).toBe('');

    await agentPrivate.safeCallback(async () => {
      throw new Error('callback failed');
    }, 'x');
    await agentPrivate.safeCallback(undefined, 'x');

    const okDecision = await agentPrivate.safeErrorCallback(
      (err) => ({ retry: err.message === 'e1' }),
      new Error('e1')
    );
    expect(okDecision).toEqual({ retry: true });

    const undefinedDecision = await agentPrivate.safeErrorCallback(
      undefined,
      new Error('no callback')
    );
    expect(undefinedDecision).toBeUndefined();

    const errorDecision = await agentPrivate.safeErrorCallback(() => {
      throw new Error('error callback failed');
    }, new Error('e2'));
    expect(errorDecision).toBeUndefined();

    const merged = await agentPrivate.mergeToolCalls(
      [{ id: 'x', function: { arguments: '{"a":' } }],
      [
        { id: 'x', function: { arguments: '1}' } },
        { id: 'y', function: { arguments: '{}' } },
      ],
      'msg_test'
    );
    expect(merged).toEqual([
      { id: 'x', function: { arguments: '{"a":1}' } },
      { id: 'y', function: { arguments: '{}' } },
    ]);

    const checkpointEvents = await collectEvents(
      agentPrivate.yieldCheckpoint(undefined, 3, undefined, {
        onCheckpoint: () => {
          throw new Error('checkpoint failed');
        },
      } as { onCheckpoint: (cp: unknown) => void })
    );
    expect(checkpointEvents[0]).toMatchObject({
      type: 'checkpoint',
      data: {
        executionId: '',
        stepIndex: 3,
        lastMessageId: '',
        canResume: true,
      },
    });
    expect(defaultConfigAgent).toBeDefined();

    expect(logger.error).toHaveBeenCalled();
  });

  it('sleep rejects when signal is already aborted', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 2 });
    const agentPrivate = agent as unknown as AgentPrivate;
    const controller = new AbortController();
    controller.abort();

    await expect(agentPrivate.sleep(20, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Operation aborted',
    });
  });

  it('sleep rejects when signal aborts during waiting', async () => {
    vi.useFakeTimers();
    const provider = createProvider();
    const manager = createToolManager();
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 2 });
    const agentPrivate = agent as unknown as AgentPrivate;
    const controller = new AbortController();

    const sleepPromise = agentPrivate.sleep(100, controller.signal);
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();

    await expect(sleepPromise).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Operation aborted',
    });
  });

  it('sleep resolves immediately when delay is non-positive', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 2 });
    const agentPrivate = agent as unknown as AgentPrivate;

    await expect(agentPrivate.sleep(0)).resolves.toBeUndefined();
    await expect(agentPrivate.sleep(-1)).resolves.toBeUndefined();
  });

  it('normalizeError maps non-Error values to UnknownError default', () => {
    const provider = createProvider();
    const manager = createToolManager();
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 2 });
    const agentPrivate = agent as unknown as AgentPrivate;

    const normalized = agentPrivate.normalizeError('plain string error');
    expect(normalized).toBeInstanceOf(AgentError);
    expect(normalized).toMatchObject({
      name: 'UnknownError',
      message: 'Unknown error',
    });
  });

  it('normalizeError maps abort-like and confirmation-timeout errors', () => {
    const provider = createProvider();
    const manager = createToolManager();
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 2 });
    const agentPrivate = agent as unknown as AgentPrivate;

    const abortNormalized = agentPrivate.normalizeError({
      name: 'AbortError',
      message: 'Operation aborted',
    });
    expect(abortNormalized).toMatchObject({
      name: 'AgentAbortedError',
      message: 'Operation aborted',
    });

    const timeoutNormalized = agentPrivate.normalizeError(
      Object.assign(new Error('Confirmation timeout'), { name: 'ConfirmationTimeoutError' })
    );
    expect(timeoutNormalized).toMatchObject({
      name: 'ConfirmationTimeoutError',
      message: 'Confirmation timeout',
    });
  });

  it('normalizeError maps provider error types from providers/errors.ts', () => {
    const provider = createProvider();
    const manager = createToolManager();
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 2 });
    const agentPrivate = agent as unknown as AgentPrivate;

    expect(agentPrivate.normalizeError(new LLMRateLimitError('rate limited'))).toMatchObject({
      name: 'AgentUpstreamRateLimitError',
      errorCode: 'AGENT_UPSTREAM_RATE_LIMIT',
      retryable: true,
    });
    expect(
      agentPrivate.normalizeError(new LLMRetryableError('timeout', undefined, 'TIMEOUT'))
    ).toMatchObject({
      name: 'AgentUpstreamTimeoutError',
      errorCode: 'AGENT_UPSTREAM_TIMEOUT',
      retryable: true,
    });
    expect(
      agentPrivate.normalizeError(new LLMRetryableError('network', undefined, 'NETWORK_ERROR'))
    ).toMatchObject({
      name: 'AgentUpstreamNetworkError',
      errorCode: 'AGENT_UPSTREAM_NETWORK',
      retryable: true,
    });
    expect(
      agentPrivate.normalizeError(new LLMRetryableError('server error', undefined, 'SERVER_503'))
    ).toMatchObject({
      name: 'AgentUpstreamServerError',
      errorCode: 'AGENT_UPSTREAM_SERVER',
      retryable: true,
    });
    expect(agentPrivate.normalizeError(new LLMAuthError('bad key'))).toMatchObject({
      name: 'AgentUpstreamAuthError',
      errorCode: 'AGENT_UPSTREAM_AUTH',
      retryable: false,
    });
    expect(agentPrivate.normalizeError(new LLMNotFoundError('missing'))).toMatchObject({
      name: 'AgentUpstreamNotFoundError',
      errorCode: 'AGENT_UPSTREAM_NOT_FOUND',
      retryable: false,
    });
    expect(agentPrivate.normalizeError(new LLMBadRequestError('invalid'))).toMatchObject({
      name: 'AgentUpstreamBadRequestError',
      errorCode: 'AGENT_UPSTREAM_BAD_REQUEST',
      retryable: false,
    });
    expect(agentPrivate.normalizeError(new LLMPermanentError('blocked', 501))).toMatchObject({
      name: 'AgentUpstreamPermanentError',
      errorCode: 'AGENT_UPSTREAM_PERMANENT',
      retryable: false,
    });
    expect(agentPrivate.normalizeError(new LLMError('provider boom', 'HTTP_418'))).toMatchObject({
      name: 'AgentUpstreamError',
      errorCode: 'AGENT_UPSTREAM_ERROR',
      retryable: false,
    });
    expect(
      agentPrivate.normalizeError(new LLMRetryableError('provider retry', undefined, 'TRANSIENT_X'))
    ).toMatchObject({
      name: 'AgentUpstreamRetryableError',
      errorCode: 'AGENT_UPSTREAM_RETRYABLE',
      retryable: true,
    });
  });

  it('throwIfAborted throws AbortError and normalizeError returns AgentError as-is', () => {
    const provider = createProvider();
    const manager = createToolManager();
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 2 });
    const agentPrivate = agent as unknown as AgentPrivate;

    const controller = new AbortController();
    controller.abort();
    expect(() => agentPrivate.throwIfAborted(controller.signal)).toThrowError('Operation aborted');

    const existing = new AgentError('custom', 1999);
    const normalized = agentPrivate.normalizeError(existing);
    expect(normalized).toBe(existing);
  });

  it('runWithConcurrencyAndLock rejects on task failure and keeps settled guard path safe', async () => {
    vi.useFakeTimers();
    const provider = createProvider();
    const manager = createToolManager();
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 2 });
    const agentPrivate = agent as unknown as AgentPrivate;

    const tasks = [
      {
        run: async () => {
          throw new Error('parallel boom');
        },
      },
      {
        run: async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 10));
          return 'late';
        },
      },
    ];

    const promise = agentPrivate.runWithConcurrencyAndLock(tasks, 2);
    await expect(promise).rejects.toThrow('parallel boom');
    await vi.advanceTimersByTimeAsync(10);
  });

  it('runWithConcurrencyAndLock returns empty result for empty tasks', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 2 });
    const agentPrivate = agent as unknown as AgentPrivate;

    const result = await agentPrivate.runWithConcurrencyAndLock([], 2);
    expect(result).toEqual([]);
  });

  it('resolveToolConcurrencyPolicy falls back to exclusive when manager has no policy method', () => {
    const provider = createProvider();
    const manager = createToolManager();
    (manager as unknown as { getConcurrencyPolicy?: unknown }).getConcurrencyPolicy = undefined;
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 2 });
    const agentPrivate = agent as unknown as AgentPrivate;

    const policy = agentPrivate.resolveToolConcurrencyPolicy({
      id: 'no_policy_tool',
      type: 'function',
      index: 0,
      function: { name: 'bash', arguments: '{}' },
    });

    expect(policy).toEqual({ mode: 'exclusive' });
  });
});

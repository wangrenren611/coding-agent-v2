import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { StatelessAgent } from '../index';
import type { CompactionInfo, Message, StreamEvent } from '../../types';
import type { ToolManager } from '../../tool/tool-manager';
import { DefaultToolManager } from '../../tool/tool-manager';
import { WriteFileTool } from '../../tool/write-file';
import type { Chunk, LLMProvider, ToolCall } from '../../../providers';
import { AgentError } from '../error';
import type { ToolConcurrencyPolicy } from '../../tool/types';
import * as compactionModule from '../compaction';
import { cleanupWriteBufferSessionFiles } from '../write-buffer';

type ChunkDelta = NonNullable<NonNullable<Chunk['choices']>[number]>['delta'];

type AgentPrivate = {
  executeTool: (
    toolCall: ToolCall,
    stepIndex: number,
    callbacks?: { onMessage?: (message: Message) => void | Promise<void> },
    abortSignal?: AbortSignal
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
  ) => Promise<Array<{
    id: string;
    function: { arguments: string };
  }>>;
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

    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const onMessage = vi.fn();
    const events = await collectEvents(agent.runStream(createInput(), { onMessage, onCheckpoint: vi.fn() }));

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
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
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

    const generateStreamCalls = (provider.generateStream as unknown as { mock: { calls: unknown[][] } })
      .mock.calls;
    expect(generateStreamCalls).toHaveLength(1);
    const callConfig = generateStreamCalls[0]?.[1] as { temperature?: number; abortSignal?: AbortSignal };
    expect(callConfig.temperature).toBe(0.1);
    expect(callConfig.abortSignal).toBe(controller.signal);
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
      data: { name: 'AgentAbortedError', code: 1002, message: 'Operation aborted' },
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
      (provider.generateStream as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
        (call) => ((call[0] as Array<{ content: string }>)?.[0]?.content ?? '')
      )
    ).sort();
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
    const firstCallArgs = (provider.generateStream as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
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

    const compactSpy = vi.spyOn(compactionModule, 'compact').mockRejectedValue(new Error('compact failed'));
    const logger = { error: vi.fn() };

    const agent = new StatelessAgent(provider, manager, {
      enableCompaction: true,
      compactionTriggerRatio: 0,
      logger,
    });
    const events = await collectEvents(agent.runStream(createInput(), { onMessage: vi.fn(), onCheckpoint: vi.fn() }));

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
    agent.on('tool_confirm', (info: { resolve: (decision: { approved: boolean; message?: string }) => void }) => {
      info.resolve({ approved: true, message: 'ok' });
    });

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
                    function: { name: 'write_file', arguments: '{"path":"a.txt","content":"partial' },
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
    expect(payload.nextAction).toBe('resume');

    const sessions = (agent as unknown as {
      writeBufferSessions: Map<
        string,
        { session: { rawArgsPath: string; contentPath: string; metaPath: string } }
      >;
    }).writeBufferSessions;
    for (const runtime of sessions.values()) {
      await cleanupWriteBufferSessionFiles(runtime.session);
    }
    sessions.clear();
  });

  it('supports streamed write_file direct/resume/finalize across multiple llm turns', async () => {
    const provider = createProvider();

    const allowedDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-v4-index-write-e2e-'));
    const bufferDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-v4-index-write-buffer-'));
    const targetPath = path.join(allowedDir, 'streamed-write.txt');
    const fullContent = 'abcdefghijklmnop';
    const expectedSha256 = createHash('sha256').update(fullContent).digest('hex');

    try {
      const manager = new DefaultToolManager();
      manager.registerTool(
        {
          name: 'write_file',
          description: 'write file',
          parameters: {},
        },
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
          buildToolCallStream('wf_resume_2', {
            path: targetPath,
            mode: 'resume',
            bufferId: 'wf_direct_1',
            content: 'ijklmnop',
            expectedSize: Buffer.byteLength(fullContent, 'utf8'),
          })
        )
        .mockReturnValueOnce(
          buildToolCallStream('wf_finalize_3', {
            path: targetPath,
            mode: 'finalize',
            bufferId: 'wf_direct_1',
            expectedSize: Buffer.byteLength(fullContent, 'utf8'),
            expectedSha256,
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
      expect(toolResults).toHaveLength(3);

      const payloads = toolResults.map((event) =>
        JSON.parse((event.data as Message).content as string) as {
          code: string;
          nextAction: string;
        }
      );
      expect(payloads.map((payload) => payload.code)).toEqual([
        'WRITE_FILE_PARTIAL_BUFFERED',
        'WRITE_FILE_NEED_RESUME',
        'WRITE_FILE_FINALIZE_OK',
      ]);
      expect(payloads.map((payload) => payload.nextAction)).toEqual(['resume', 'finalize', 'none']);
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

  it('executeTool uses UnknownError message when tool fails without explicit error object', async () => {
    vi.useFakeTimers();
    const provider = createProvider();
    const manager = createToolManager();
    manager.execute = vi.fn().mockImplementation(async (_toolCall, options) => {
      options.onChunk?.({ type: 'stdout', data: 'chunk-1' });
      const decisionPromise = options.onConfirm?.({
        toolCallId: 'call_2',
        toolName: 'bash',
        arguments: '{}',
      });
      await vi.advanceTimersByTimeAsync(30000);
      const decision = await decisionPromise;
      expect(decision).toEqual({ approved: false, message: 'Confirmation timeout' });
      return { success: false };
    });

    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3 });
    const onMessage = vi.fn();
    const toolChunkSpy = vi.fn();
    agent.on('tool_chunk', toolChunkSpy);

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
    agent.on('tool_confirm', (info: { resolve: (decision: { approved: boolean; message?: string }) => void }) => {
      info.resolve({ approved: true, message: 'approved' });
    });

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

  it('processToolCalls supports bounded concurrency when configured', async () => {
    vi.useFakeTimers();
    const provider = createProvider();
    const manager = createToolManager();
    (manager as unknown as { getConcurrencyPolicy: (toolCall: ToolCall) => ToolConcurrencyPolicy }).getConcurrencyPolicy =
      vi.fn(() => ({ mode: 'parallel-safe' }));
    let inFlight = 0;
    let maxInFlight = 0;
    manager.execute = vi.fn().mockImplementation(async (toolCall: ToolCall) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return { success: true, output: `ok-${toolCall.id}` };
    });
    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3, maxConcurrentToolCalls: 2 });
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
    expect(events.map((e) => e.type)).toEqual(['progress', 'progress', 'tool_result', 'tool_result']);
    expect(messages.at(-2)).toMatchObject({ tool_call_id: 'tool_1' });
    expect(messages.at(-1)).toMatchObject({ tool_call_id: 'tool_2' });
  });

  it('processToolCalls enforces lockKey to avoid conflicting concurrent tools', async () => {
    vi.useFakeTimers();
    const provider = createProvider();
    const manager = createToolManager();
    (manager as unknown as { getConcurrencyPolicy: (toolCall: ToolCall) => ToolConcurrencyPolicy }).getConcurrencyPolicy =
      vi.fn((toolCall: ToolCall) => ({
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

    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 3, maxConcurrentToolCalls: 3 });
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
        toolCall.id === 'tool_exclusive'
          ? { mode: 'exclusive' }
          : { mode: 'parallel-safe' },
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

    expect(events.map((e) => e.type)).toEqual(['progress', 'progress', 'tool_result', 'tool_result']);
    expect(messages.at(-2)).toMatchObject({ tool_call_id: 'tool_exclusive' });
    expect(messages.at(-1)).toMatchObject({ tool_call_id: 'tool_parallel' });
  });

  it('executeTool maps success without output to empty string content', async () => {
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
      data: { content: '', tool_call_id: 'call_no_output' },
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
    const events = await collectEvents(agent.runStream(createInput(), { onMessage: vi.fn(), onCheckpoint: vi.fn(), onError }));

    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(AgentError);
    expect(events.map((e) => e.type)).toEqual(['progress', 'error']);
    expect(events[1]).toMatchObject({
      type: 'error',
      data: {
        name: 'UnknownError',
        code: 1005,
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
    const events = await collectEvents(agent.runStream(createInput(), { onMessage: vi.fn(), onCheckpoint: vi.fn(), onError }));

    expect(onError).toHaveBeenCalledOnce();
    expect(events.map((e) => e.type)).toEqual(['progress', 'error', 'progress', 'chunk', 'done']);
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
      agent.runStream(createInput(), { onMessage: vi.fn(), onCheckpoint: vi.fn(), onError: vi.fn() })
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
    });

    await agentPrivate.safeCallback(
      async () => {
        throw new Error('callback failed');
      },
      'x'
    );
    await agentPrivate.safeCallback(undefined, 'x');

    const okDecision = await agentPrivate.safeErrorCallback(
      (err) => ({ retry: err.message === 'e1' }),
      new Error('e1')
    );
    expect(okDecision).toEqual({ retry: true });

    const undefinedDecision = await agentPrivate.safeErrorCallback(undefined, new Error('no callback'));
    expect(undefinedDecision).toBeUndefined();

    const errorDecision = await agentPrivate.safeErrorCallback(
      () => {
        throw new Error('error callback failed');
      },
      new Error('e2')
    );
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
      agentPrivate.yieldCheckpoint(
        undefined,
        3,
        undefined,
        {
          onCheckpoint: () => {
            throw new Error('checkpoint failed');
          },
        } as { onCheckpoint: (cp: unknown) => void },
      )
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


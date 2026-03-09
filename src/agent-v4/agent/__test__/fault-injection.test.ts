import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getEventListeners } from 'node:events';
import { StatelessAgent } from '../index';
import type { AgentMetric, Message, StreamEvent } from '../../types';
import type { ToolManager } from '../../tool/tool-manager';
import type { Chunk, LLMProvider } from '../../../providers';

type ChunkDelta = NonNullable<NonNullable<Chunk['choices']>[number]>['delta'];
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

function createInput(executionId = 'exec_fault_1') {
  const message: Message = {
    messageId: 'u1',
    type: 'user',
    role: 'user',
    content: 'hello',
    timestamp: Date.now(),
  };
  return {
    executionId,
    conversationId: 'conv_fault_1',
    messages: [message],
    maxSteps: 4,
  };
}

describe('StatelessAgent fault injection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('recovers from transient llm network failures and eventually completes', async () => {
    vi.useFakeTimers();
    const provider = createProvider();
    const manager = createToolManager();
    let attempt = 0;
    provider.generateStream = vi.fn().mockImplementation(() => {
      attempt += 1;
      if (attempt <= 2) {
        return (async function* () {
          yield* [] as Chunk[];
          throw new Error('transient network');
        })();
      }
      return toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'recovered' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ]);
    });

    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 5,
      backoffConfig: { initialDelayMs: 5, maxDelayMs: 5, base: 2, jitter: false },
    });

    const eventsPromise = collectEvents(
      agent.runStream(createInput(), {
        onMessage: vi.fn(),
        onCheckpoint: vi.fn(),
        onError: async () => ({ retry: true }),
      })
    );
    await vi.advanceTimersByTimeAsync(20);
    const events = await eventsPromise;

    expect(provider.generateStream).toHaveBeenCalledTimes(3);
    expect(events.filter((event) => event.type === 'error')).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({
      type: 'done',
      data: { finishReason: 'stop' },
    });
  });

  it('does not leak abort listeners after repeated timeout-budgeted runs', async () => {
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
      maxRetryCount: 2,
      timeoutBudgetMs: 100,
      llmTimeoutRatio: 0.7,
    });

    for (let i = 0; i < 20; i++) {
      const events = await collectEvents(
        agent.runStream(
          {
            ...createInput(`exec_soak_${i}`),
            abortSignal: controller.signal,
          },
          { onMessage: vi.fn(), onCheckpoint: vi.fn() }
        )
      );
      expect(events.at(-1)).toMatchObject({
        type: 'done',
        data: { finishReason: 'stop' },
      });
    }

    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  it('marks tool stage metrics as failed when chaos tool crash happens', async () => {
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
                    id: 'tool_fault_1',
                    type: 'function',
                    index: 0,
                    function: { name: 'bash', arguments: '{"command":"echo fault"}' },
                  },
                ],
                finish_reason: 'tool_calls',
              } as unknown as ChunkDelta,
            },
          ],
        },
      ])
    );
    manager.execute = vi.fn().mockRejectedValue(new Error('chaos tool crash'));
    const onMetric = vi.fn(async (_metric: AgentMetric) => undefined);

    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 2 });
    const events = await collectEvents(
      agent.runStream(createInput('exec_fault_tool'), {
        onMessage: vi.fn(),
        onCheckpoint: vi.fn(),
        onError: async () => ({ retry: false }),
        onMetric,
      })
    );

    expect(events.at(-1)).toMatchObject({
      type: 'error',
      data: { message: 'chaos tool crash' },
    });

    const metrics = onMetric.mock.calls.map((call) => call[0] as AgentMetric);
    const toolStageMetric = metrics.find((metric) => metric.name === 'agent.tool.stage.duration_ms');
    const toolMetric = metrics.find((metric) => metric.name === 'agent.tool.duration_ms');

    expect(toolStageMetric?.tags?.success).toBe('false');
    expect(toolMetric?.tags?.success).toBe('false');
  });
});

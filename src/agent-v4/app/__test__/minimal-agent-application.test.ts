import { describe, expect, it, vi } from 'vitest';
import type { ToolManager } from '../../tool/tool-manager';
import { StatelessAgent } from '../../agent';
import { MinimalStatelessAgentApplication } from '../minimal-agent-application';
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

function createProvider() {
  return {
    config: {} as Record<string, unknown>,
    generate: vi.fn(),
    generateStream: vi.fn(),
    getTimeTimeout: vi.fn(() => 1000),
    getLLMMaxTokens: vi.fn(() => 32000),
    getMaxOutputTokens: vi.fn(() => 4096),
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

describe('MinimalStatelessAgentApplication', () => {
  it('runs agent and returns events/messages', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'Hello from agent' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 2 });
    const app = new MinimalStatelessAgentApplication(agent);
    const onEvent = vi.fn();

    const result = await app.runForeground(
      {
        conversationId: 'conv_simple',
        userInput: 'Say hello',
        executionId: 'exec_simple',
        maxSteps: 3,
      },
      { onEvent }
    );

    expect(result.executionId).toBe('exec_simple');
    expect(result.conversationId).toBe('conv_simple');
    expect(result.finishReason).toBe('stop');
    expect(result.steps).toBe(1);
    expect(result.messages[0]).toMatchObject({
      role: 'user',
      content: 'Say hello',
    });
    expect(result.messages[1]).toMatchObject({
      role: 'assistant',
      content: 'Hello from agent',
    });
    expect(result.events.some((event) => event.type === 'done')).toBe(true);
    expect(onEvent).toHaveBeenCalled();
    expect(onEvent.mock.calls.some(([event]) => event.type === 'chunk')).toBe(true);
  });

  it('bridges tool_chunk into tool_stream events', async () => {
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
                      id: 'tool_call_1',
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
      options.onChunk?.({ type: 'stdout', data: 'streamed-output' });
      return { success: true, output: 'ok' };
    });

    const agent = new StatelessAgent(provider, manager, { maxRetryCount: 2 });
    const app = new MinimalStatelessAgentApplication(agent);
    const onToolStream = vi.fn();
    const onEvent = vi.fn();

    const result = await app.runForeground(
      {
        conversationId: 'conv_tool',
        userInput: 'Run tool',
        executionId: 'exec_tool',
      },
      { onToolStream, onEvent }
    );

    expect(onToolStream).toHaveBeenCalled();
    expect(result.events.some((event) => event.type === 'tool_stream')).toBe(true);
    expect(result.events.some((event) => event.type === 'tool_result')).toBe(true);
    expect(onEvent.mock.calls.some(([event]) => event.type === 'tool_stream')).toBe(true);
  });
});

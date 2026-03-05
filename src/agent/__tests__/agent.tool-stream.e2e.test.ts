import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Agent } from '../agent';
import type { Chunk, LLMGenerateOptions, LLMProvider, LLMRequestMessage } from '../../providers';
import { BaseTool, ToolManager } from '../../tool';
import type { ToolExecutionContext, ToolResult, ToolStreamEvent } from '../../core/types';
import type { Plugin } from '../../hook';

const streamToolSchema = z.object({});

class StreamingMockTool extends BaseTool<typeof streamToolSchema> {
  get meta() {
    return {
      name: 'streaming_mock_tool',
      description: 'tool that emits progress events',
      parameters: streamToolSchema,
      category: 'test',
    };
  }

  async execute(
    _args: z.infer<typeof streamToolSchema>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const emit = context.agentContext?.emitToolEvent ?? context.emitToolEvent;
    for (let i = 1; i <= 3; i++) {
      await emit?.({
        type: 'progress',
        content: `progress ${i}/3`,
        data: { current: i, total: 3 },
      });
    }

    return { success: true, data: { ok: true } };
  }
}

function createToolStreamProvider(): LLMProvider {
  let callIndex = 0;

  return {
    config: { model: 'mock-tool-stream-model' },
    generate: vi.fn(),
    async *generateStream(
      _messages: LLMRequestMessage[],
      _options?: LLMGenerateOptions
    ): AsyncGenerator<Chunk> {
      if (callIndex === 0) {
        callIndex += 1;
        yield {
          index: 0,
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: 'call_stream_1',
                    type: 'function',
                    index: 0,
                    function: {
                      name: 'streaming_mock_tool',
                      arguments: '{}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        };
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
      };
    },
    getTimeTimeout: () => 60_000,
    getLLMMaxTokens: () => 128_000,
    getMaxOutputTokens: () => 8_000,
  } as unknown as LLMProvider;
}

describe('Agent tool stream e2e', () => {
  it('should deliver tool stream events to hook pipeline in order', async () => {
    const events: ToolStreamEvent[] = [];
    const plugin: Plugin = {
      name: 'capture-tool-stream',
      toolStream: (event) => {
        events.push(event);
      },
    };

    const toolManager = new ToolManager();
    toolManager.register(new StreamingMockTool());

    const agent = new Agent({
      provider: createToolStreamProvider(),
      toolManager,
      plugins: [plugin],
      maxSteps: 4,
    });

    const result = await agent.run('run tool stream test');

    expect(result.completionReason).toBe('stop');
    expect(events.length).toBeGreaterThanOrEqual(5);
    expect(events[0].type).toBe('start');
    expect(events.some((event) => event.type === 'progress')).toBe(true);
    expect(events[events.length - 1].type).toBe('end');
    expect(events.every((event) => event.toolCallId === 'call_stream_1')).toBe(true);

    const sequences = events.map((event) => event.sequence);
    expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);
    expect(new Set(sequences).size).toBe(sequences.length);
  });
});

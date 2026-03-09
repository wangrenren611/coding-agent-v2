import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolManager } from '../../tool/tool-manager';
import type { Chunk, LLMProvider } from '../../../providers';
import { StatelessAgent } from '../../agent';
import { AgentAppService } from '../agent-app-service';
import { SqliteAgentAppStore } from '../sqlite-agent-app-store';

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

function createProvider(): LLMProvider {
  return {
    config: {} as Record<string, unknown>,
    generate: vi.fn(),
    generateStream: vi.fn(),
    getTimeTimeout: vi.fn(() => 1000),
    getLLMMaxTokens: vi.fn(() => 32000),
    getMaxOutputTokens: vi.fn(() => 4096),
  } as unknown as LLMProvider;
}

function createToolManager(): ToolManager {
  return {
    execute: vi.fn(),
    registerTool: vi.fn(),
    getTools: vi.fn(() => []),
    getConcurrencyPolicy: vi.fn(() => ({ mode: 'exclusive' as const })),
  } as unknown as ToolManager;
}

describe('AgentAppService', () => {
  let tempDir: string | null = null;
  let store: SqliteAgentAppStore | null = null;

  afterEach(async () => {
    if (store) {
      await store.close();
      store = null;
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('persists run/events and supports getRun/listRuns queries', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(
      toStream([
        {
          index: 0,
          choices: [{ index: 0, delta: { content: 'Hello from app service' } }],
        },
        {
          index: 0,
          choices: [{ index: 0, delta: { finish_reason: 'stop' } as unknown as ChunkDelta }],
        },
      ])
    );

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-v4-app-service-'));
    store = new SqliteAgentAppStore(path.join(tempDir, 'agent.db'));
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 2,
      backoffConfig: { initialDelayMs: 1, maxDelayMs: 1, base: 2, jitter: false },
    });
    const app = new AgentAppService({
      agent,
      executionStore: store,
      eventStore: store,
      messageStore: store,
    });

    const result = await app.runForeground({
      conversationId: 'conv_service',
      executionId: 'exec_service',
      userInput: 'Say hello',
      maxSteps: 3,
    });

    expect(result.executionId).toBe('exec_service');
    expect(result.finishReason).toBe('stop');
    expect(result.run.status).toBe('COMPLETED');
    expect(result.run.terminalReason).toBe('stop');
    expect(result.events.some((event) => event.eventType === 'user_message')).toBe(true);
    expect(result.events.some((event) => event.eventType === 'assistant_message')).toBe(true);
    expect(result.events.some((event) => event.eventType === 'done')).toBe(true);

    const run = await app.getRun('exec_service');
    expect(run?.status).toBe('COMPLETED');

    const list = await app.listRuns('conv_service', { limit: 10 });
    expect(list.items).toHaveLength(1);
    expect(list.items[0].executionId).toBe('exec_service');

    const messages = await store.list('conv_service');
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);

    const contextMessages = await app.listContextMessages('conv_service');
    expect(contextMessages.map((message) => message.role)).toEqual(['user', 'assistant']);

    const dropped = await app.listDroppedMessages('exec_service');
    expect(dropped).toHaveLength(0);
  });

  it('maps aborted execution to CANCELLED terminal state', async () => {
    const provider = createProvider();
    const manager = createToolManager();
    provider.generateStream = vi.fn().mockReturnValue(toStream([]));

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-v4-app-service-abort-'));
    store = new SqliteAgentAppStore(path.join(tempDir, 'agent.db'));
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 1,
      backoffConfig: { initialDelayMs: 1, maxDelayMs: 1, base: 2, jitter: false },
    });
    const app = new AgentAppService({
      agent,
      executionStore: store,
      eventStore: store,
      messageStore: store,
    });

    const controller = new AbortController();
    controller.abort();

    const result = await app.runForeground({
      conversationId: 'conv_abort',
      executionId: 'exec_abort',
      userInput: 'Abort me',
      abortSignal: controller.signal,
    });

    expect(result.finishReason).toBe('error');
    expect(result.run.status).toBe('CANCELLED');
    expect(result.run.terminalReason).toBe('aborted');
    expect(result.run.errorCode).toBe('AGENT_ABORTED');
  });

  it('bridges tool chunk as tool_stream and keeps run completed', async () => {
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
                      function: {
                        name: 'bash',
                        arguments: '{"command":"echo hi"}',
                      },
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

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-v4-app-service-tool-'));
    store = new SqliteAgentAppStore(path.join(tempDir, 'agent.db'));
    const agent = new StatelessAgent(provider, manager, {
      maxRetryCount: 2,
      backoffConfig: { initialDelayMs: 1, maxDelayMs: 1, base: 2, jitter: false },
    });
    const app = new AgentAppService({
      agent,
      executionStore: store,
      eventStore: store,
      messageStore: store,
    });

    const result = await app.runForeground({
      conversationId: 'conv_tool',
      executionId: 'exec_tool',
      userInput: 'run tool',
      maxSteps: 3,
    });

    expect(result.run.status).toBe('COMPLETED');
    expect(result.events.some((event) => event.eventType === 'tool_stream')).toBe(true);

    const persistedEvents = await app.listRunEvents('exec_tool');
    expect(persistedEvents.some((event) => event.eventType === 'tool_stream')).toBe(true);
  });
});

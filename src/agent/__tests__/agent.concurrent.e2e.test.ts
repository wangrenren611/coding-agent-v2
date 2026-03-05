import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { Agent } from '../agent';
import type { LLMGenerateOptions, LLMProvider, LLMRequestMessage, Chunk } from '../../providers';
import { ToolManager } from '../../tool';
import { MemoryManager, createFileStorageBundle } from '../../storage';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createStopProvider(reply: string, delayMs = 0): LLMProvider {
  return {
    config: { model: 'mock-model' },
    async generate(): Promise<never> {
      throw new Error('Not used in this test');
    },
    async *generateStream(
      _messages: LLMRequestMessage[],
      _options?: LLMGenerateOptions
    ): AsyncGenerator<Chunk> {
      if (delayMs > 0) {
        await sleep(delayMs);
      }

      yield {
        index: 0,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: reply },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };
    },
    getTimeTimeout: () => 60_000,
    getLLMMaxTokens: () => 128_000,
    getMaxOutputTokens: () => 8_000,
  } as unknown as LLMProvider;
}

describe('Agent concurrent run e2e', () => {
  const CONCURRENCY = 100;

  let tempDir: string;
  let memoryManager: MemoryManager;
  let toolManager: ToolManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-concurrent-e2e-'));
    memoryManager = new MemoryManager(createFileStorageBundle(tempDir));
    toolManager = new ToolManager();
  });

  afterEach(async () => {
    await memoryManager.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should keep history consistent when 100 agents run concurrently on same session', async () => {
    const sessionId = 'agent-concurrent-1111';
    const systemPrompt = 'You are QPSCode, an interactive CLI coding agent.';

    // warm-up run: create session and baseline history
    const warmupAgent = new Agent({
      provider: createStopProvider('warmup-complete'),
      toolManager,
      memoryManager,
      sessionId,
      systemPrompt,
    });
    await warmupAgent.run('warmup task');
    const baselineHistory = memoryManager.getHistory({ sessionId });
    const baselineSystemCount = baselineHistory.filter((m) => m.role === 'system').length;

    const tasks = Array.from({ length: CONCURRENCY }, (_, i) => ({
      prompt: `task-${i}`,
      reply: `reply-${i}`,
      delayMs: (i % 7) * 3,
    }));

    await Promise.all(
      tasks.map(async ({ prompt, reply, delayMs }) => {
        const agent = new Agent({
          provider: createStopProvider(reply, delayMs),
          toolManager,
          memoryManager,
          sessionId,
          systemPrompt,
        });
        await agent.run(prompt);
      })
    );

    const history = memoryManager.getHistory({ sessionId });
    expect(history).toHaveLength(baselineHistory.length + CONCURRENCY * 2);

    const systemMessages = history.filter((m) => m.role === 'system');
    expect(systemMessages).toHaveLength(baselineSystemCount);

    for (const { prompt, reply } of tasks) {
      expect(
        history.some(
          (m) => m.role === 'user' && typeof m.content === 'string' && m.content === prompt
        )
      ).toBe(true);
      expect(
        history.some(
          (m) => m.role === 'assistant' && typeof m.content === 'string' && m.content === reply
        )
      ).toBe(true);
    }

    const sequences = history.map((m) => m.sequence);
    expect(new Set(sequences).size).toBe(history.length);

    const session = memoryManager.getSession(sessionId);
    expect(session).not.toBeNull();
    expect(session?.totalMessages).toBe(history.length);
  });
});

import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskStore } from '../task-store';
import { RealSubagentRunnerAdapter } from '../task-runner-adapter';
import type { RunRecord } from '../../app/contracts';
import type { RunForegroundRequest, RunForegroundResult } from '../../app/agent-app-service';
import type { Message } from '../../types';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeRunRecord(
  executionId: string,
  conversationId: string,
  status: RunRecord['status']
): RunRecord {
  const now = Date.now();
  return {
    executionId,
    runId: executionId,
    conversationId,
    status,
    createdAt: now,
    updatedAt: now,
    stepIndex: status === 'COMPLETED' ? 2 : 1,
    startedAt: now,
    completedAt: status === 'COMPLETED' || status === 'CANCELLED' ? now : undefined,
    terminalReason:
      status === 'COMPLETED' ? 'stop' : status === 'CANCELLED' ? 'aborted' : undefined,
  };
}

class FakeSubagentExecutionService {
  readonly runs = new Map<string, RunRecord>();
  readonly contextMessages = new Map<string, Message[]>();
  delayMs = 30;
  completionText = 'subagent final answer';

  async runForeground(request: RunForegroundRequest): Promise<RunForegroundResult> {
    const executionId = request.executionId as string;
    const conversationId = request.conversationId;
    const running = makeRunRecord(executionId, conversationId, 'RUNNING');
    this.runs.set(executionId, running);

    const abortSignal = request.abortSignal;
    if (abortSignal?.aborted) {
      const cancelled = makeRunRecord(executionId, conversationId, 'CANCELLED');
      this.runs.set(executionId, cancelled);
      return {
        executionId,
        conversationId,
        messages: [],
        events: [],
        finishReason: 'error',
        steps: 1,
        run: cancelled,
      };
    }

    await sleep(this.delayMs);

    if (abortSignal?.aborted) {
      const cancelled = makeRunRecord(executionId, conversationId, 'CANCELLED');
      this.runs.set(executionId, cancelled);
      return {
        executionId,
        conversationId,
        messages: [],
        events: [],
        finishReason: 'error',
        steps: 1,
        run: cancelled,
      };
    }

    const assistantMessage: Message = {
      messageId: `msg_${Date.now()}`,
      role: 'assistant',
      type: 'assistant-text',
      content: this.completionText,
      timestamp: Date.now(),
    };
    this.contextMessages.set(conversationId, [assistantMessage]);

    const completed = makeRunRecord(executionId, conversationId, 'COMPLETED');
    this.runs.set(executionId, completed);
    return {
      executionId,
      conversationId,
      messages: [assistantMessage],
      events: [],
      finishReason: 'stop',
      steps: 2,
      run: completed,
    };
  }

  async getRun(executionId: string): Promise<RunRecord | null> {
    return this.runs.get(executionId) || null;
  }

  async listContextMessages(conversationId: string): Promise<Message[]> {
    return this.contextMessages.get(conversationId) || [];
  }
}

describe('real subagent runner adapter', () => {
  let baseDir: string;
  let store: TaskStore;
  let appService: FakeSubagentExecutionService;
  let runner: RealSubagentRunnerAdapter;

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-v4-task-real-runner-'));
    store = new TaskStore({ baseDir });
    appService = new FakeSubagentExecutionService();
    runner = new RealSubagentRunnerAdapter({
      store,
      appService,
      resolveTools: (allowedTools) =>
        (allowedTools || []).map((name) => ({
          type: 'function',
          function: {
            name,
            description: name,
            parameters: {},
          },
        })),
      resolveModelId: () => 'glm-5',
    });
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('returns real foreground output instead of mock prompt echo', async () => {
    const run = await runner.start('ns1', {
      subagentType: 'Plan',
      prompt: 'analyze codebase deeply',
      runInBackground: false,
      allowedTools: ['glob', 'grep'],
    });

    expect(run.status).toBe('completed');
    expect(run.output).toBe('subagent final answer');
    expect(run.output).not.toContain('completed: analyze codebase deeply');
  });

  it('does not expose partial output before completion in background mode', async () => {
    appService.delayMs = 80;
    const started = await runner.start('ns2', {
      subagentType: 'Explore',
      prompt: 'background investigation',
      runInBackground: true,
      allowedTools: ['glob'],
    });
    expect(started.status).toBe('running');

    const inProgress = await runner.poll('ns2', started.agentId);
    expect(inProgress?.status).toBe('running');
    expect(inProgress?.output).toBeUndefined();

    await sleep(120);
    const completed = await runner.poll('ns2', started.agentId);
    expect(completed?.status).toBe('completed');
    expect(completed?.output).toBe('subagent final answer');
  });

  it('cancels live background run and reports cancelled status', async () => {
    appService.delayMs = 200;
    const started = await runner.start('ns3', {
      subagentType: 'general-purpose',
      prompt: 'long running operation',
      runInBackground: true,
      allowedTools: ['bash'],
    });

    const cancelled = await runner.cancel('ns3', started.agentId, 'stop now');
    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.error).toBe('stop now');

    await sleep(30);
    const polled = await runner.poll('ns3', started.agentId);
    expect(polled?.status).toBe('cancelled');
  });
});

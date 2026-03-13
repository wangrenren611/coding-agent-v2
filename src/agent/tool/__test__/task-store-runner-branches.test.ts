import * as os from 'node:os';
import * as path from 'node:path';
import * as fsPromises from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InProcessMockRunnerAdapter } from '../task-runner-adapter';
import { TaskStore, getTaskStore, resetTaskStoreSingleton } from '../task-store';
import type { AgentRunEntity } from '../task-types';
import type { ToolExecutionContext } from '../types';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function makeRun(overrides: Partial<AgentRunEntity> = {}): AgentRunEntity {
  const now = Date.now();
  return {
    agentId: overrides.agentId || 'agent_x',
    status: overrides.status || 'queued',
    subagentType: overrides.subagentType || 'Plan',
    prompt: overrides.prompt || 'prompt',
    description: overrides.description,
    model: overrides.model,
    maxTurns: overrides.maxTurns,
    allowedTools: overrides.allowedTools,
    linkedTaskId: overrides.linkedTaskId,
    output: overrides.output,
    error: overrides.error,
    progress: overrides.progress,
    createdAt: overrides.createdAt || now,
    startedAt: overrides.startedAt,
    endedAt: overrides.endedAt,
    updatedAt: overrides.updatedAt || now,
    outputFile: overrides.outputFile,
    metadata: overrides.metadata || {},
    version: overrides.version || 1,
  };
}

describe('task-store branches', () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    resetTaskStoreSingleton();
    for (const dir of cleanupDirs.splice(0)) {
      await fsPromises.rm(dir, { recursive: true, force: true });
    }
  });

  it('covers namespace normalization and singleton branches', async () => {
    const baseDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'renx-task-store-a-'));
    cleanupDirs.push(baseDir);
    const store = new TaskStore({ baseDir });
    const defaultStore = new TaskStore();
    expect(defaultStore.baseDir).toContain(path.join('.renx', 'task'));

    expect(store.normalizeNamespace(undefined)).toBe('default');
    expect(store.normalizeNamespace('   ')).toBe('default');
    expect(() => store.normalizeNamespace('bad namespace')).toThrow('TASK_INVALID_NAMESPACE');
    expect(store.getNamespaceFilePath('ns1')).toContain('ns1.json');

    resetTaskStoreSingleton();
    const s1 = getTaskStore({ baseDir: path.join(baseDir, 's1') });
    const s2 = getTaskStore({ baseDir: path.join(baseDir, 's1') });
    const s3 = getTaskStore({ baseDir: path.join(baseDir, 's2') });
    const sDefault = getTaskStore();
    expect(s1).toBe(s2);
    expect(s3).not.toBe(s1);
    expect(sDefault).toBeInstanceOf(TaskStore);
    resetTaskStoreSingleton();
  });

  it('covers read/hydrate/cache/io error branches', async () => {
    const baseDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'renx-task-store-b-'));
    cleanupDirs.push(baseDir);
    const store = new TaskStore({ baseDir });

    const created = await store.getState('ns1');
    expect(created.namespace).toBe('ns1');
    const cached = await store.getState('ns1');
    expect(cached.namespace).toBe('ns1');

    const hydFile = path.join(baseDir, 'hydr.json');
    await fsPromises.writeFile(
      hydFile,
      `${JSON.stringify(
        {
          namespace: 'hydr',
          tasks: {
            task_a: {
              id: 'task_a',
              subject: 'a',
              description: 'd',
              activeForm: 'a',
              status: 'pending',
              priority: 'normal',
              owner: null,
              blockedBy: [],
              blocks: [],
              progress: 0,
              checkpoints: [],
              retryConfig: {
                maxRetries: 1,
                retryDelayMs: 1,
                backoffMultiplier: 1,
                retryOn: ['x'],
              },
              retryCount: 0,
              tags: [],
              metadata: {},
              history: [],
              createdAt: 1,
              updatedAt: 1,
              version: 1,
            },
          },
          agentRuns: {},
          graph: {
            adjacency: {},
            reverse: {},
          },
          updatedAt: 1,
          schemaVersion: 1,
        },
        null,
        2
      )}\n`,
      'utf8'
    );

    const store2 = new TaskStore({ baseDir });
    const hydrated = await store2.getState('hydr');
    expect(hydrated.graph.adjacency.task_a).toEqual([]);
    expect(hydrated.graph.reverse.task_a).toEqual([]);
    const hydratedFallback = (
      store2 as unknown as {
        hydrateState: (
          namespace: string,
          partial: Record<string, unknown>
        ) => {
          tasks: Record<string, unknown>;
          agentRuns: Record<string, unknown>;
          graph: { adjacency: Record<string, unknown>; reverse: Record<string, unknown> };
          updatedAt: number;
        };
      }
    ).hydrateState('fallback', {});
    expect(hydratedFallback.tasks).toEqual({});
    expect(hydratedFallback.agentRuns).toEqual({});
    expect(hydratedFallback.graph.adjacency).toEqual({});
    expect(hydratedFallback.graph.reverse).toEqual({});
    const hydratedNumeric = (
      store2 as unknown as {
        hydrateState: (
          namespace: string,
          partial: Record<string, unknown>
        ) => { updatedAt: number };
      }
    ).hydrateState('numeric', {
      updatedAt: 123,
      tasks: {},
      agentRuns: {},
      graph: { adjacency: {}, reverse: {} },
    });
    expect(hydratedNumeric.updatedAt).toBe(123);

    const badPath = path.join(baseDir, 'bad.json');
    await fsPromises.mkdir(badPath, { recursive: true });
    await expect(store2.getState('bad')).rejects.toThrow('TASK_STORE_IO_ERROR');
  });

  it('covers namespace lock waiting and release-without-lock branch', async () => {
    const baseDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'renx-task-store-c-'));
    cleanupDirs.push(baseDir);
    const store = new TaskStore({ baseDir });
    const executionOrder: string[] = [];

    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    let releaseFirst!: () => void;
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = store.updateState('ns-lock', async () => {
      executionOrder.push('first-start');
      markFirstStarted();
      await firstDone;
      executionOrder.push('first-end');
      return 'first';
    });

    await firstStarted;

    const second = store.updateState('ns-lock', async () => {
      executionOrder.push('second');
      return 'second';
    });

    await sleep(20);
    expect(executionOrder).toEqual(['first-start']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(executionOrder).toEqual(['first-start', 'first-end', 'second']);

    (store as unknown as { releaseNamespaceLock: (ns: string) => void }).releaseNamespaceLock(
      'missing-lock'
    );
  });
});

describe('task-runner-adapter branches', () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const dir of cleanupDirs.splice(0)) {
      await fsPromises.rm(dir, { recursive: true, force: true });
    }
  });

  it('covers start callback, empty-preview output and resume-not-found error', async () => {
    const baseDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'renx-runner-a-'));
    cleanupDirs.push(baseDir);
    const store = new TaskStore({ baseDir });
    const runner = new InProcessMockRunnerAdapter(store, { completionDelayMs: 5 });

    const events: string[] = [];
    const context: ToolExecutionContext = {
      toolCallId: 'tc',
      loopIndex: 1,
      agent: {},
      onChunk: async (event) => {
        events.push(String(event.content || ''));
      },
    };

    const foreground = await runner.start(
      'ns',
      {
        subagentType: 'Plan',
        prompt: '   ',
      },
      context
    );
    expect(foreground.status).toBe('completed');
    expect(foreground.output).toContain('completed');
    expect(events.join(' ')).toContain('subagent started:');

    await expect(
      runner.start('ns', {
        subagentType: 'Plan',
        prompt: 'x',
        resume: 'missing-agent',
      })
    ).rejects.toThrow('AGENT_RUN_NOT_FOUND');
  });

  it('covers resume, cancel, schedule, completion status tokens, and persist failure path', async () => {
    const baseDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'renx-runner-b-'));
    cleanupDirs.push(baseDir);
    const store = new TaskStore({ baseDir });
    const runner = new InProcessMockRunnerAdapter(store, { completionDelayMs: 50 });

    await store.updateState('ns', (state) => {
      state.agentRuns.resume_queued = makeRun({
        agentId: 'resume_queued',
        status: 'queued',
        prompt: 'resume queued',
      });
      state.agentRuns.resume_done = makeRun({
        agentId: 'resume_done',
        status: 'completed',
        prompt: 'resume done',
        output: 'done',
        endedAt: Date.now(),
      });
      state.agentRuns.resume_running = makeRun({
        agentId: 'resume_running',
        status: 'running',
        prompt: 'resume running',
      });
      state.agentRuns.terminal_cancelled = makeRun({
        agentId: 'terminal_cancelled',
        status: 'cancelled',
        prompt: 'terminal',
        endedAt: Date.now(),
      });
      return null;
    });

    const resumedQueued = await runner.start('ns', {
      subagentType: 'Plan',
      prompt: 'ignored',
      resume: 'resume_queued',
    });
    expect(resumedQueued.status).toBe('running');

    const resumedRunning = await runner.start('ns', {
      subagentType: 'Plan',
      prompt: 'ignored',
      resume: 'resume_running',
    });
    expect(resumedRunning.status).toBe('running');

    const resumedDone = await runner.start('ns', {
      subagentType: 'Plan',
      prompt: 'ignored',
      resume: 'resume_done',
    });
    expect(resumedDone.status).toBe('completed');

    const cancelledMissing = await runner.cancel('ns', 'missing');
    expect(cancelledMissing).toBeNull();

    const cancelledTerminal = await runner.cancel('ns', 'terminal_cancelled');
    expect(cancelledTerminal?.status).toBe('cancelled');

    const background = await runner.start('ns', {
      subagentType: 'general-purpose',
      prompt: 'background',
      runInBackground: true,
    });
    expect(background.status).toBe('running');

    const runnerAny = runner as unknown as {
      scheduleCompletion: (ns: string, id: string) => void;
      completeRun: (ns: string, id: string) => Promise<AgentRunEntity | null>;
      persistOutputFile: (file: string, run: AgentRunEntity) => Promise<void>;
    };
    runnerAny.scheduleCompletion('ns', background.agentId);
    runnerAny.scheduleCompletion('ns', background.agentId);

    const cancelledBackground = await runner.cancel('ns', background.agentId);
    expect(cancelledBackground?.status).toBe('cancelled');
    expect(cancelledBackground?.error).toContain('Cancelled by task_stop');

    const completeMissing = await runnerAny.completeRun('ns', 'missing');
    expect(completeMissing).toBeNull();

    const completeTerminal = await runnerAny.completeRun('ns', 'terminal_cancelled');
    expect(completeTerminal?.status).toBe('cancelled');

    const paused = await runner.start('ns', {
      subagentType: 'Plan',
      prompt: 'Please do [TASK_PAUSE]',
      runInBackground: false,
    });
    expect(paused.status).toBe('paused');

    const timedOut = await runner.start('ns', {
      subagentType: 'Plan',
      prompt: 'Please do [TASK_TIMEOUT]',
      runInBackground: false,
    });
    expect(timedOut.status).toBe('timed_out');

    const pausedBg = await runner.start('ns', {
      subagentType: 'Plan',
      prompt: 'Background [TASK_PAUSE] token',
      runInBackground: true,
    });
    await sleep(80);
    const pausedBgPolled = await runner.poll('ns', pausedBg.agentId);
    expect(pausedBgPolled?.status).toBe('paused');
    expect(pausedBgPolled?.progress).toBe(0);

    expect(await runner.poll('ns', 'missing-poll')).toBeNull();

    const runnerNullComplete = new InProcessMockRunnerAdapter(store, { completionDelayMs: 5 });
    (
      runnerNullComplete as unknown as {
        completeRun: (_ns: string, _id: string) => Promise<null>;
      }
    ).completeRun = async () => null;
    const fallbackRun = await runnerNullComplete.start('ns', {
      subagentType: 'Plan',
      prompt: 'foreground with null complete',
      runInBackground: false,
    });
    expect(fallbackRun.status).toBe('running');

    const defaultDelayRunner = new InProcessMockRunnerAdapter(store, { completionDelayMs: 0 });
    expect((defaultDelayRunner as unknown as { completionDelayMs: number }).completionDelayMs).toBe(
      30
    );

    await expect(
      runnerAny.persistOutputFile('bad\0path', makeRun({ status: 'completed' }))
    ).resolves.toBeUndefined();
  });
});

import * as os from 'node:os';
import * as path from 'node:path';
import * as fsPromises from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskCreateTool } from '../task-create';
import { TaskGetTool } from '../task-get';
import { TaskOutputTool } from '../task-output';
import { TaskStopTool } from '../task-stop';
import { TaskStore } from '../task-store';
import { TaskTool } from '../task';
import type { SubagentRunnerAdapter } from '../task-runner-adapter';
import type { AgentRunEntity, TaskEntity } from '../task-types';
import type { ToolExecutionContext } from '../types';

function parseOutput<T>(output: string | undefined): T {
  return JSON.parse(output || '{}') as T;
}

function makeRun(overrides: Partial<AgentRunEntity> = {}): AgentRunEntity {
  const now = Date.now();
  return {
    agentId: overrides.agentId || 'agent-x',
    status: overrides.status || 'running',
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
    startedAt: overrides.startedAt || now,
    endedAt: overrides.endedAt,
    updatedAt: overrides.updatedAt || now,
    outputFile: overrides.outputFile,
    metadata: overrides.metadata || {},
    version: overrides.version || 1,
  };
}

function makeTask(overrides: Partial<TaskEntity> = {}): TaskEntity {
  const now = 1;
  return {
    id: overrides.id || 'task-x',
    subject: overrides.subject || 'Subject',
    description: overrides.description || 'Long enough description field.',
    activeForm: overrides.activeForm || 'Active subject',
    status: overrides.status || 'pending',
    priority: overrides.priority || 'normal',
    owner: overrides.owner === undefined ? null : overrides.owner,
    blockedBy: overrides.blockedBy || [],
    blocks: overrides.blocks || [],
    progress: overrides.progress || 0,
    checkpoints: overrides.checkpoints || [],
    retryConfig: overrides.retryConfig || {
      maxRetries: 3,
      retryDelayMs: 100,
      backoffMultiplier: 2,
      retryOn: ['timeout'],
    },
    retryCount: overrides.retryCount || 0,
    tags: overrides.tags || [],
    metadata: overrides.metadata || {},
    history: overrides.history || [],
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
    version: overrides.version || 1,
    agentId: overrides.agentId,
    startedAt: overrides.startedAt,
    completedAt: overrides.completedAt,
    cancelledAt: overrides.cancelledAt,
    lastError: overrides.lastError,
    lastErrorAt: overrides.lastErrorAt,
    timeoutMs: overrides.timeoutMs,
  };
}

describe('task tool runtime edge branches', () => {
  let baseDir: string;
  let store: TaskStore;
  let taskCreate: TaskCreateTool;

  beforeEach(async () => {
    baseDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'agent-v4-task-runtime-edge-'));
    store = new TaskStore({ baseDir });
    taskCreate = new TaskCreateTool({ store });
  });

  afterEach(async () => {
    await fsPromises.rm(baseDir, { recursive: true, force: true });
  });

  it('covers task schema preprocess, concurrency metadata and linked-task validation errors', async () => {
    const runner: SubagentRunnerAdapter = {
      start: async () => makeRun({ status: 'completed' }),
      poll: async () => null,
      cancel: async () => null,
    };
    const taskTool = new TaskTool({ store, runner, defaultNamespace: 'def' });

    const parsedTrue = taskTool.safeValidateArgs({
      subagent_type: 'Plan',
      prompt: 'x',
      run_in_background: 'true',
    });
    const parsedFalse = taskTool.safeValidateArgs({
      subagent_type: 'Plan',
      prompt: 'x',
      run_in_background: 'false',
    });
    const parsedBoolean = taskTool.safeValidateArgs({
      subagent_type: 'Plan',
      prompt: 'x',
      run_in_background: true,
    });
    expect(parsedTrue.success && parsedTrue.data.run_in_background).toBe(true);
    expect(parsedFalse.success && parsedFalse.data.run_in_background).toBe(false);
    expect(parsedBoolean.success && parsedBoolean.data.run_in_background).toBe(true);

    expect(taskTool.getConcurrencyMode({} as never)).toBe('exclusive');
    expect(taskTool.getConcurrencyLockKey({} as never)).toBe('taskns:def');
    expect(taskTool.getConcurrencyLockKey({ namespace: 'n1' } as never)).toBe('taskns:n1');

    const linkedMissing = await taskTool.execute({
      namespace: 'n1',
      subagent_type: 'Plan',
      prompt: 'x',
      linked_task_id: 'missing',
    });
    expect(linkedMissing.success).toBe(false);
    expect(linkedMissing.output).toContain('TASK_NOT_FOUND');

    const blocker = parseOutput<{ task: { id: string } }>(
      (
        await taskCreate.execute({
          namespace: 'n2',
          subject: 'blocker',
          description: 'blocker description long enough.',
        })
      ).output
    ).task.id;
    const blocked = parseOutput<{ task: { id: string } }>(
      (
        await taskCreate.execute({
          namespace: 'n2',
          subject: 'blocked',
          description: 'blocked description long enough.',
        })
      ).output
    ).task.id;
    await store.updateState('n2', (state) => {
      state.tasks[blocked].blockedBy = [blocker];
      return null;
    });

    const blockedResult = await taskTool.execute({
      namespace: 'n2',
      subagent_type: 'Plan',
      prompt: 'x',
      linked_task_id: blocked,
    });
    expect(blockedResult.success).toBe(false);
    expect(blockedResult.output).toContain('TASK_BLOCKED');
  });

  it('covers task linked mapping for cancelled run, missing task on post-run update, and catch fallback', async () => {
    const cancelledRunner: SubagentRunnerAdapter = {
      start: async () => makeRun({ agentId: 'agent-cancel', status: 'cancelled' }),
      poll: async () => null,
      cancel: async () => null,
    };
    const taskToolCancelled = new TaskTool({ store, runner: cancelledRunner });
    const taskGet = new TaskGetTool({ store });
    const linked = parseOutput<{ task: { id: string } }>(
      (
        await taskCreate.execute({
          namespace: 'n3',
          subject: 'cancel-me',
          description: 'cancel me with enough detail text.',
        })
      ).output
    ).task.id;

    const cancelled = await taskToolCancelled.execute({
      namespace: 'n3',
      subagent_type: 'Plan',
      prompt: 'x',
      linked_task_id: linked,
    });
    expect(cancelled.success).toBe(true);
    const taskAfterCancelled = await taskGet.execute({
      namespace: 'n3',
      task_id: linked,
    });
    expect(taskAfterCancelled.success).toBe(true);
    expect(parseOutput<{ task: { status: string } }>(taskAfterCancelled.output).task.status).toBe(
      'cancelled'
    );

    const fakeStore = {
      normalizeNamespace: (ns?: string) => (ns || 'default').trim() || 'default',
      getState: async () => ({
        namespace: 'fake',
        tasks: { t1: makeTask({ id: 't1' }) },
        agentRuns: {},
        graph: { adjacency: {}, reverse: {} },
        updatedAt: 0,
        schemaVersion: 1 as const,
      }),
      updateState: async (_ns: string | undefined, updater: (state: any) => any) => {
        const state = {
          namespace: 'fake',
          tasks: {},
          agentRuns: {},
          graph: { adjacency: {}, reverse: {} },
          updatedAt: 0,
          schemaVersion: 1 as const,
        };
        const result = await updater(state);
        return { state, result };
      },
    } as unknown as TaskStore;
    const fakeRunner: SubagentRunnerAdapter = {
      start: async () => makeRun({ status: 'completed', agentId: 'a1' }),
      poll: async () => null,
      cancel: async () => null,
    };
    const taskToolMissingPostLink = new TaskTool({ store: fakeStore, runner: fakeRunner });
    const postLinkResult = await taskToolMissingPostLink.execute({
      namespace: 'fake',
      subagent_type: 'Plan',
      prompt: 'x',
      linked_task_id: 't1',
    });
    expect(postLinkResult.success).toBe(true);

    const throwRunner: SubagentRunnerAdapter = {
      start: async () => {
        throw 'runner failed';
      },
      poll: async () => null,
      cancel: async () => null,
    };
    const taskToolError = new TaskTool({ store, runner: throwRunner });
    const failed = await taskToolError.execute({
      namespace: 'n4',
      subagent_type: 'Plan',
      prompt: 'x',
    });
    expect(failed.success).toBe(false);
    expect(failed.output).toContain('TASK_OPERATION_FAILED');
  });

  it('covers task default constructor, namespace fallback, failed run fallback error, and Error catch path', async () => {
    const defaultTool = new TaskTool();
    expect(defaultTool.getConcurrencyLockKey({} as never)).toBe('taskns:default');

    const failedRunner: SubagentRunnerAdapter = {
      start: async () => makeRun({ status: 'failed', error: undefined, agentId: 'agent-failed' }),
      poll: async () => null,
      cancel: async () => null,
    };
    const taskTool = new TaskTool({ store, runner: failedRunner });

    const linked = parseOutput<{ task: { id: string } }>(
      (
        await taskCreate.execute({
          subject: 'default namespace linked',
          description: 'Task in default namespace for failed fallback branch.',
        })
      ).output
    ).task.id;
    const failedLinked = await taskTool.execute({
      subagent_type: 'Plan',
      prompt: 'x',
      linked_task_id: linked,
    });
    expect(failedLinked.success).toBe(true);
    const detail = await new TaskGetTool({ store }).execute({
      task_id: linked,
    });
    expect(parseOutput<{ task: { lastError?: string } }>(detail.output).task.lastError).toContain(
      'linked agent failed'
    );

    const noNamespace = await taskTool.execute({
      subagent_type: 'Plan',
      prompt: 'no namespace run',
    });
    expect(noNamespace.success).toBe(true);

    const errorRunner: SubagentRunnerAdapter = {
      start: async () => {
        throw new Error('TASK_CUSTOM_ERROR: exploded');
      },
      poll: async () => null,
      cancel: async () => null,
    };
    const errorTool = new TaskTool({ store, runner: errorRunner });
    const err = await errorTool.execute({
      subagent_type: 'Plan',
      prompt: 'x',
    });
    expect(err.success).toBe(false);
    expect(err.output).toContain('TASK_CUSTOM_ERROR');
  });

  it('covers blocked-message fallback branch via mocked evaluateTaskCanStart', async () => {
    vi.resetModules();
    vi.doMock('../task-types', async () => {
      const actual = await vi.importActual<typeof import('../task-types')>('../task-types');
      return {
        ...actual,
        evaluateTaskCanStart: () => ({ canStart: false }),
      };
    });
    const { TaskTool: MockedTaskTool } = await import('../task');

    await store.updateState('m1', (state) => {
      state.tasks.t1 = makeTask({ id: 't1', status: 'pending' });
      return null;
    });
    const runner: SubagentRunnerAdapter = {
      start: async () => makeRun({ status: 'completed' }),
      poll: async () => null,
      cancel: async () => null,
    };
    const mockedTool = new MockedTaskTool({ store, runner });
    const result = await mockedTool.execute({
      namespace: 'm1',
      subagent_type: 'Plan',
      prompt: 'x',
      linked_task_id: 't1',
    });
    expect(result.success).toBe(false);
    expect(result.output).toContain('linked task is blocked');

    vi.doUnmock('../task-types');
    vi.resetModules();
  });
});

describe('task_output edge branches', () => {
  let baseDir: string;
  let store: TaskStore;

  beforeEach(async () => {
    baseDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'agent-v4-task-output-edge-'));
    store = new TaskStore({ baseDir });
  });

  afterEach(async () => {
    await fsPromises.rm(baseDir, { recursive: true, force: true });
  });

  it('covers schema preprocess and concurrency metadata', () => {
    const runner: SubagentRunnerAdapter = {
      start: async () => makeRun(),
      poll: async () => null,
      cancel: async () => null,
    };
    const tool = new TaskOutputTool({ store, runner, defaultNamespace: 'def-out' });
    const defaultTool = new TaskOutputTool();
    expect(defaultTool.getConcurrencyLockKey({} as never)).toBe('taskns:default:agent:unknown');

    const parsedTrue = tool.safeValidateArgs({ agent_id: 'a', block: 'true' });
    const parsedFalse = tool.safeValidateArgs({ agent_id: 'a', block: 'false' });
    const parsedBoolean = tool.safeValidateArgs({ agent_id: 'a', block: true });
    expect(parsedTrue.success && parsedTrue.data.block).toBe(true);
    expect(parsedFalse.success && parsedFalse.data.block).toBe(false);
    expect(parsedBoolean.success && parsedBoolean.data.block).toBe(true);

    expect(tool.getConcurrencyMode({} as never)).toBe('parallel-safe');
    expect(tool.getConcurrencyLockKey({} as never)).toBe('taskns:def-out:agent:unknown');
    expect(tool.getConcurrencyLockKey({ namespace: 'n1', agent_id: 'a1' } as never)).toBe(
      'taskns:n1:agent:a1'
    );
    expect(tool.getConcurrencyLockKey({ namespace: 'n1', task_id: 't1' } as never)).toBe(
      'taskns:n1:agent:t1'
    );
  });

  it('covers resolve target errors and poll-not-found branches', async () => {
    const runnerMissing: SubagentRunnerAdapter = {
      start: async () => makeRun(),
      poll: async () => null,
      cancel: async () => null,
    };
    const outputTool = new TaskOutputTool({ store, runner: runnerMissing });

    const targetRequired = await outputTool.execute({ namespace: 'n1' });
    expect(targetRequired.success).toBe(false);
    expect(targetRequired.output).toContain('TASK_OUTPUT_TARGET_REQUIRED');

    const taskNotFound = await outputTool.execute({
      namespace: 'n1',
      task_id: 'missing',
    });
    expect(taskNotFound.success).toBe(false);
    expect(taskNotFound.output).toContain('TASK_NOT_FOUND');

    await store.updateState('n1', (state) => {
      state.tasks.t1 = makeTask({ id: 't1', agentId: undefined });
      return null;
    });
    const noAgent = await outputTool.execute({
      namespace: 'n1',
      task_id: 't1',
    });
    expect(noAgent.success).toBe(false);
    expect(noAgent.output).toContain('AGENT_RUN_NOT_FOUND');

    const nonBlockingMissing = await outputTool.execute({
      namespace: 'n1',
      agent_id: 'missing-agent',
      block: false,
    });
    expect(nonBlockingMissing.success).toBe(false);
    expect(nonBlockingMissing.output).toContain('AGENT_RUN_NOT_FOUND');

    const blockingMissing = await outputTool.execute({
      namespace: 'n1',
      agent_id: 'missing-agent',
      timeout_ms: 50,
      poll_interval_ms: 20,
    });
    expect(blockingMissing.success).toBe(false);
    expect(blockingMissing.output).toContain('AGENT_RUN_NOT_FOUND');

    const defaultNamespaceMissing = await outputTool.execute({
      agent_id: 'missing-agent',
      block: false,
    });
    expect(defaultNamespaceMissing.success).toBe(false);

    const byTaskRunner: SubagentRunnerAdapter = {
      start: async () => makeRun(),
      poll: async () =>
        makeRun({ status: 'completed', agentId: 'agent-by-task', endedAt: Date.now() }),
      cancel: async () => null,
    };
    await store.updateState('n1', (state) => {
      state.tasks.t2 = makeTask({ id: 't2', agentId: 'agent-by-task' });
      return null;
    });
    const byTaskTool = new TaskOutputTool({ store, runner: byTaskRunner });
    const byTask = await byTaskTool.execute({
      namespace: 'n1',
      task_id: 't2',
      block: false,
    });
    expect(byTask.success).toBe(true);
  });

  it('covers timeout hit, final-poll missing, and abort branches in blocking mode', async () => {
    const alwaysRunning: SubagentRunnerAdapter = {
      start: async () => makeRun(),
      poll: async () => makeRun({ status: 'running', agentId: 'a-time' }),
      cancel: async () => null,
    };
    const outputTimeout = new TaskOutputTool({ store, runner: alwaysRunning });
    const timeoutRes = await outputTimeout.execute(
      {
        namespace: 'n2',
        agent_id: 'a-time',
        timeout_ms: 40,
        poll_interval_ms: 20,
      },
      {
        toolCallId: 'timeout-with-signal',
        loopIndex: 1,
        agent: {},
        toolAbortSignal: new AbortController().signal,
      }
    );
    expect(timeoutRes.success).toBe(true);
    const timeoutPayload = parseOutput<{ completed: boolean; timeout_hit: boolean }>(
      timeoutRes.output
    );
    expect(timeoutPayload.completed).toBe(false);
    expect(timeoutPayload.timeout_hit).toBe(true);

    let pollCount = 0;
    const latestMissingRunner: SubagentRunnerAdapter = {
      start: async () => makeRun(),
      poll: async () => {
        pollCount += 1;
        return pollCount === 1 ? makeRun({ status: 'running', agentId: 'a-latest' }) : null;
      },
      cancel: async () => null,
    };
    const outputLatestMissing = new TaskOutputTool({ store, runner: latestMissingRunner });
    const latestMissing = await outputLatestMissing.execute({
      namespace: 'n3',
      agent_id: 'a-latest',
      timeout_ms: 1,
      poll_interval_ms: 1,
    });
    expect(latestMissing.success).toBe(false);
    expect(latestMissing.output).toContain('AGENT_RUN_NOT_FOUND');

    const abortRunner: SubagentRunnerAdapter = {
      start: async () => makeRun(),
      poll: async () => makeRun({ status: 'running', agentId: 'a-abort' }),
      cancel: async () => null,
    };
    const outputAbort = new TaskOutputTool({ store, runner: abortRunner });

    const controller1 = new AbortController();
    controller1.abort();
    const context1 = {
      toolCallId: 'c1',
      loopIndex: 1,
      agent: {},
      toolAbortSignal: controller1.signal,
    } as ToolExecutionContext;
    await expect(
      outputAbort.execute(
        {
          namespace: 'n4',
          agent_id: 'a-abort',
          timeout_ms: 50,
          poll_interval_ms: 20,
        },
        context1
      )
    ).rejects.toThrow('TASK_OUTPUT_ABORTED');

    const controller2 = new AbortController();
    const context2 = {
      toolCallId: 'c2',
      loopIndex: 2,
      agent: {},
      toolAbortSignal: controller2.signal,
    } as ToolExecutionContext;
    const promise = outputAbort.execute(
      {
        namespace: 'n4',
        agent_id: 'a-abort',
        timeout_ms: 1000,
        poll_interval_ms: 200,
      },
      context2
    );
    setTimeout(() => controller2.abort(), 30);
    await expect(promise).rejects.toThrow('TASK_OUTPUT_ABORTED');
  });
});

describe('task_stop edge branches', () => {
  let baseDir: string;
  let store: TaskStore;

  beforeEach(async () => {
    baseDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'agent-v4-task-stop-edge-'));
    store = new TaskStore({ baseDir });
  });

  afterEach(async () => {
    await fsPromises.rm(baseDir, { recursive: true, force: true });
  });

  it('covers schema preprocess and concurrency metadata', () => {
    const runner: SubagentRunnerAdapter = {
      start: async () => makeRun(),
      poll: async () => null,
      cancel: async () => null,
    };
    const stopTool = new TaskStopTool({ store, runner, defaultNamespace: 'def-stop' });
    const defaultTool = new TaskStopTool();
    expect(defaultTool.getConcurrencyLockKey({} as never)).toBe('taskns:default');
    const parsedTrue = stopTool.safeValidateArgs({ agent_id: 'a', cancel_linked_task: 'true' });
    const parsedFalse = stopTool.safeValidateArgs({ agent_id: 'a', cancel_linked_task: 'false' });
    const parsedBoolean = stopTool.safeValidateArgs({ agent_id: 'a', cancel_linked_task: true });
    expect(parsedTrue.success && parsedTrue.data.cancel_linked_task).toBe(true);
    expect(parsedFalse.success && parsedFalse.data.cancel_linked_task).toBe(false);
    expect(parsedBoolean.success && parsedBoolean.data.cancel_linked_task).toBe(true);

    expect(stopTool.getConcurrencyMode({} as never)).toBe('exclusive');
    expect(stopTool.getConcurrencyLockKey({} as never)).toBe('taskns:def-stop');
    expect(stopTool.getConcurrencyLockKey({ namespace: 'n1' } as never)).toBe('taskns:n1');
  });

  it('covers resolve errors, pre-cancel error branches, and cancel returns null', async () => {
    const running = makeRun({ status: 'running', agentId: 'a1' });
    const terminal = makeRun({ status: 'completed', agentId: 'a2', endedAt: Date.now() });

    const runnerBase: SubagentRunnerAdapter = {
      start: async () => makeRun(),
      poll: async (_ns, id) => {
        if (id === 'a1') return running;
        if (id === 'a2') return terminal;
        return null;
      },
      cancel: async () => null,
    };
    const stopTool = new TaskStopTool({ store, runner: runnerBase });

    const targetRequired = await stopTool.execute({ namespace: 'n1' });
    expect(targetRequired.success).toBe(false);
    expect(targetRequired.output).toContain('TASK_STOP_TARGET_REQUIRED');

    const notFound = await stopTool.execute({
      namespace: 'n1',
      task_id: 'missing',
    });
    expect(notFound.success).toBe(false);
    expect(notFound.output).toContain('TASK_NOT_FOUND');

    await store.updateState('n1', (state) => {
      state.tasks.t1 = makeTask({ id: 't1' });
      return null;
    });
    const noAgent = await stopTool.execute({
      namespace: 'n1',
      task_id: 't1',
    });
    expect(noAgent.success).toBe(false);
    expect(noAgent.output).toContain('AGENT_RUN_NOT_FOUND');

    const beforeMissing = await stopTool.execute({
      namespace: 'n1',
      agent_id: 'missing-agent',
    });
    expect(beforeMissing.success).toBe(false);
    expect(beforeMissing.output).toContain('AGENT_RUN_NOT_FOUND');

    const beforeTerminal = await stopTool.execute({
      namespace: 'n1',
      agent_id: 'a2',
    });
    expect(beforeTerminal.success).toBe(false);
    expect(beforeTerminal.output).toContain('AGENT_RUN_ALREADY_TERMINAL');

    const cancelNull = await stopTool.execute({
      namespace: 'n1',
      agent_id: 'a1',
    });
    expect(cancelNull.success).toBe(false);
    expect(cancelNull.output).toContain('AGENT_RUN_NOT_FOUND');
  });

  it('covers cancel_linked_task false and true(with skip completed/cancelled)', async () => {
    const runner: SubagentRunnerAdapter = {
      start: async () => makeRun(),
      poll: async () => makeRun({ status: 'running', agentId: 'agent-main' }),
      cancel: async () =>
        makeRun({ status: 'cancelled', agentId: 'agent-main', endedAt: Date.now() }),
    };
    const stopTool = new TaskStopTool({ store, runner });

    await store.updateState('n2', (state) => {
      state.tasks.p1 = makeTask({ id: 'p1', status: 'pending', agentId: 'agent-main', owner: 'x' });
      return null;
    });

    const noLinkedCancel = await stopTool.execute({
      namespace: 'n2',
      agent_id: 'agent-main',
      cancel_linked_task: false,
    });
    expect(noLinkedCancel.success).toBe(true);
    const noLinkedPayload = parseOutput<{ cancelled_task_ids: string[] }>(noLinkedCancel.output);
    expect(noLinkedPayload.cancelled_task_ids).toEqual([]);
    const p1State = await store.getState('n2');
    expect(p1State.tasks.p1.status).toBe('pending');

    const defaultLinkedCancel = await stopTool.execute({
      namespace: 'n2',
      task_id: 'p1',
    });
    expect(defaultLinkedCancel.success).toBe(true);
    const defaultLinkedPayload = parseOutput<{ cancelled_task_ids: string[] }>(
      defaultLinkedCancel.output
    );
    expect(defaultLinkedPayload.cancelled_task_ids).toContain('p1');

    await store.updateState('n3', (state) => {
      state.tasks.t_pending = makeTask({
        id: 't_pending',
        status: 'in_progress',
        owner: 'agent:agent-main',
        agentId: 'agent-main',
      });
      state.tasks.t_completed = makeTask({
        id: 't_completed',
        status: 'completed',
        agentId: 'agent-main',
      });
      state.tasks.t_cancelled = makeTask({
        id: 't_cancelled',
        status: 'cancelled',
        agentId: 'agent-main',
      });
      return null;
    });

    const linkedCancel = await stopTool.execute({
      namespace: 'n3',
      agent_id: 'agent-main',
      cancel_linked_task: true,
    });
    expect(linkedCancel.success).toBe(true);
    const linkedPayload = parseOutput<{ cancelled_task_ids: string[] }>(linkedCancel.output);
    expect(linkedPayload.cancelled_task_ids).toEqual(['t_pending']);

    const stateAfter = await store.getState('n3');
    expect(stateAfter.tasks.t_pending.status).toBe('cancelled');
    expect(stateAfter.tasks.t_completed.status).toBe('completed');
    expect(stateAfter.tasks.t_cancelled.status).toBe('cancelled');

    await store.updateState(undefined, (state) => {
      state.tasks.default_task = makeTask({
        id: 'default_task',
        status: 'in_progress',
        owner: 'agent:agent-main',
        agentId: 'agent-main',
      });
      return null;
    });
    const noNamespaceStop = await stopTool.execute({
      task_id: 'default_task',
    });
    expect(noNamespaceStop.success).toBe(true);
  });
});

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Chunk, LLMProvider, LLMRequestMessage } from '../../providers';
import type { ToolExecutionContext } from '../types';
import { createAgentRunExecutionAdapter } from '../task-v2/runtime/agent-adapter';
import { TaskV2Error } from '../task-v2/errors';
import { TaskV2Runtime, getDefaultTaskV2Runtime } from '../task-v2/runtime/runtime';
import { createRunId } from '../task-v2/ulid';
import type { Run } from '../task-v2/types';
import { ToolManager } from '../manager';
import { createTool } from '../simple-tool';
import { z } from 'zod';
import {
  TaskV2ClearSessionTool,
  TaskV2CreateTool,
  TaskV2DependencyAddTool,
  TaskV2DependencyListTool,
  TaskV2DependencyRemoveTool,
  TaskV2DispatchReadyTool,
  TaskV2DeleteTool,
  TaskV2GcRunsTool,
  TaskV2GetTool,
  TaskV2ListTool,
  TaskV2RunCancelTool,
  TaskV2RunEventsTool,
  TaskV2RunGetTool,
  TaskV2RunStartTool,
  TaskV2SubmitTool,
  TaskV2RunWaitTool,
  TaskV2UpdateTool,
} from '../task-v2-tools';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createImmediateProvider(text: string): LLMProvider {
  return {
    config: { model: 'test-model' },
    generate: async () => {
      throw new Error('Not implemented');
    },
    async *generateStream(_messages: LLMRequestMessage[]) {
      const chunk: Chunk = {
        index: 0,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: text },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      };
      yield chunk;
    },
    getTimeTimeout: () => 60000,
    getLLMMaxTokens: () => 128000,
    getMaxOutputTokens: () => 8000,
  } as unknown as LLMProvider;
}

function createBlockingProvider(): LLMProvider {
  return {
    config: { model: 'test-model' },
    generate: async () => {
      throw new Error('Not implemented');
    },
    // eslint-disable-next-line require-yield
    async *generateStream(_messages: LLMRequestMessage[], options?: { abortSignal?: AbortSignal }) {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (options?.abortSignal?.aborted) {
          throw new Error('aborted');
        }
        await sleep(20);
      }
    },
    getTimeTimeout: () => 60000,
    getLLMMaxTokens: () => 128000,
    getMaxOutputTokens: () => 8000,
  } as unknown as LLMProvider;
}

function createFailingProvider(): LLMProvider {
  return {
    config: { model: 'test-model' },
    generate: async () => {
      throw new Error('Not implemented');
    },
    // eslint-disable-next-line require-yield
    async *generateStream() {
      throw new Error('boom');
    },
    getTimeTimeout: () => 60000,
    getLLMMaxTokens: () => 128000,
    getMaxOutputTokens: () => 8000,
  } as unknown as LLMProvider;
}

function createInspectingProvider(capture: {
  messages?: LLMRequestMessage[];
  toolNames?: string[];
}): LLMProvider {
  return {
    config: { model: 'test-model' },
    generate: async () => {
      throw new Error('Not implemented');
    },
    async *generateStream(messages: LLMRequestMessage[], options?: { tools?: unknown[] }) {
      capture.messages = messages;
      capture.toolNames = (options?.tools ?? [])
        .map((tool) => {
          const payload = tool as { function?: { name?: string } };
          return payload.function?.name;
        })
        .filter((name): name is string => typeof name === 'string');
      const chunk: Chunk = {
        index: 0,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: 'inspected' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      };
      yield chunk;
    },
    getTimeTimeout: () => 60000,
    getLLMMaxTokens: () => 128000,
    getMaxOutputTokens: () => 8000,
  } as unknown as LLMProvider;
}

function createContext(sessionId: string, provider?: LLMProvider): ToolExecutionContext {
  return {
    toolCallId: `call-${sessionId}`,
    loopIndex: 0,
    stepIndex: 0,
    agent: {
      getSessionId: () => sessionId,
      config: provider ? { provider } : {},
    } as unknown as ToolExecutionContext['agent'],
    agentContext: {
      sessionId,
      loopIndex: 0,
      stepIndex: 0,
    },
  };
}

function createBareContext(): ToolExecutionContext {
  return {
    toolCallId: 'call-default',
    loopIndex: 0,
    stepIndex: 0,
    agent: {
      getSessionId: () => '',
    } as unknown as ToolExecutionContext['agent'],
  };
}

describe('task-v2 tools and adapter', () => {
  let tempDir: string;
  let dbPath: string;
  let runtime: TaskV2Runtime;

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'task-v2-tools-'));
    dbPath = path.join(tempDir, 'tasks.db');
    runtime = new TaskV2Runtime({ dbPath });
    await runtime.prepare();
  });

  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  it('supports task_* and task_run_* tools end-to-end', async () => {
    const provider = createImmediateProvider('run done');
    const context = createContext('tool-session', provider);

    const taskCreate = new TaskV2CreateTool({ runtime });
    const taskGet = new TaskV2GetTool({ runtime });
    const taskList = new TaskV2ListTool({ runtime });
    const taskUpdate = new TaskV2UpdateTool({ runtime });
    const taskDelete = new TaskV2DeleteTool({ runtime });
    const dependencyAdd = new TaskV2DependencyAddTool({ runtime });
    const dependencyList = new TaskV2DependencyListTool({ runtime });
    const dependencyRemove = new TaskV2DependencyRemoveTool({ runtime });
    const runStart = new TaskV2RunStartTool({ runtime });
    const runGet = new TaskV2RunGetTool({ runtime });
    const runWait = new TaskV2RunWaitTool({ runtime });
    const runEvents = new TaskV2RunEventsTool({ runtime });
    const runCancel = new TaskV2RunCancelTool({ runtime });
    const gcRuns = new TaskV2GcRunsTool({ runtime });
    const clearSession = new TaskV2ClearSessionTool({ runtime });

    const created = await taskCreate.execute(
      {
        title: 'Task 1',
        description: 'desc',
        priority: 'high',
        status: 'ready',
      },
      context
    );
    expect(created.success).toBe(true);
    const taskId = (created.data as { id: string }).id;

    const depTask = await taskCreate.execute(
      {
        title: 'Dependency Task',
        description: 'dep',
        priority: 'medium',
        status: 'ready',
      },
      context
    );
    expect(depTask.success).toBe(true);
    const depTaskId = (depTask.data as { id: string }).id;

    const depAdded = await dependencyAdd.execute(
      { task_id: taskId, depends_on_task_id: depTaskId },
      context
    );
    expect(depAdded.success).toBe(true);
    const depListed = await dependencyList.execute({ task_id: taskId }, context);
    expect(depListed.success).toBe(true);
    expect((depListed.data as { count: number }).count).toBe(1);
    const depRemoved = await dependencyRemove.execute(
      { task_id: taskId, depends_on_task_id: depTaskId },
      context
    );
    expect(depRemoved.success).toBe(true);

    const got = await taskGet.execute({ task_id: taskId }, context);
    expect(got.success).toBe(true);

    const updated = await taskUpdate.execute(
      { task_id: taskId, status: 'running', expected_version: 1 },
      context
    );
    expect(updated.success).toBe(true);

    const runStarted = await runStart.execute(
      {
        task_id: taskId,
        agent_type: 'general-purpose',
      },
      context
    );
    expect(runStarted.success).toBe(true);
    const runId = (runStarted.data as { id: string }).id;

    const runFetched = await runGet.execute({ run_id: runId }, context);
    expect(runFetched.success).toBe(true);

    const waited = await runWait.execute(
      {
        run_id: runId,
        timeout_ms: 10_000,
        poll_interval_ms: 100,
      },
      context
    );
    expect(waited.success).toBe(true);
    expect((waited.data as { status: string }).status).toBe('succeeded');

    const events = await runEvents.execute({ run_id: runId, after_seq: 0, limit: 50 }, context);
    expect(events.success).toBe(true);
    expect((events.data as { count: number }).count).toBeGreaterThan(0);

    // Cancel terminal run should stay idempotent.
    const cancelTerminal = await runCancel.execute({ run_id: runId }, context);
    expect(cancelTerminal.success).toBe(true);

    const listed = await taskList.execute(
      { status: undefined, priority: undefined, limit: 50 },
      context
    );
    expect(listed.success).toBe(true);
    expect((listed.data as { count: number }).count).toBeGreaterThan(0);

    const gc = await gcRuns.execute(
      {
        finished_before: '2999-01-01T00:00:00.000Z',
        older_than_hours: 24,
        limit: 100,
      },
      context
    );
    expect(gc.success).toBe(true);
    expect((gc.data as { deleted_runs: number }).deleted_runs).toBeGreaterThanOrEqual(1);

    const deleted = await taskDelete.execute({ task_id: taskId }, context);
    expect(deleted.success).toBe(true);

    const cleared = await clearSession.execute({}, context);
    expect(cleared.success).toBe(true);
  });

  it('supports task_submit as a one-shot create/start/wait/events entrypoint', async () => {
    const provider = createImmediateProvider('submit done');
    const context = createContext('task-submit', provider);
    const submitTool = new TaskV2SubmitTool({ runtime });

    const createdAndWaited = await submitTool.execute(
      {
        title: 'Task submit title',
        description: 'Task submit description',
        prompt: 'analyze and fix',
        profile: 'general-purpose',
        priority: 'high',
        status: 'ready',
        wait: true,
        wait_timeout_ms: 10_000,
        poll_interval_ms: 100,
        include_events: true,
        events_after_seq: 0,
        events_limit: 50,
        dedupe_window_ms: 120_000,
        force_new: false,
      },
      context
    );
    expect(createdAndWaited.success).toBe(true);
    const createdData = createdAndWaited.data as {
      task: { id: string };
      run: { id: string; status: string };
      waited: boolean;
      event_count: number;
    };
    expect(createdData.task.id.startsWith('tsk_')).toBe(true);
    expect(createdData.waited).toBe(true);
    expect(createdData.run.status).toBe('succeeded');
    expect(createdData.event_count).toBeGreaterThan(0);

    const noWait = await submitTool.execute(
      {
        title: 'Task submit title 2',
        description: 'Task submit description 2',
        prompt: 'run second task',
        profile: 'general-purpose',
        priority: 'medium',
        status: 'ready',
        wait: false,
        wait_timeout_ms: 10_000,
        poll_interval_ms: 100,
        include_events: false,
        events_after_seq: 0,
        events_limit: 50,
        dedupe_window_ms: 120_000,
        force_new: false,
      },
      context
    );
    expect(noWait.success).toBe(true);
    const noWaitData = noWait.data as {
      task: { id: string };
      run: { id: string };
      waited: boolean;
    };
    expect(noWaitData.task.id.startsWith('tsk_')).toBe(true);
    expect(noWaitData.waited).toBe(false);
    expect(noWaitData.run.id.startsWith('run_')).toBe(true);
  });

  it('deduplicates repeated task_submit calls with same input by default', async () => {
    const provider = createImmediateProvider('dedupe done');
    const context = createContext('task-submit-dedupe', provider);
    const submitTool = new TaskV2SubmitTool({ runtime });

    const baseArgs = {
      title: 'Same title',
      description: 'Same description',
      prompt: 'same prompt',
      profile: 'general-purpose',
      priority: 'medium' as const,
      status: 'ready' as const,
      wait: false,
      wait_timeout_ms: 10_000,
      poll_interval_ms: 100,
      include_events: false,
      events_after_seq: 0,
      events_limit: 50,
      dedupe_window_ms: 120_000,
      force_new: false,
    };

    const first = await submitTool.execute(baseArgs, context);
    const second = await submitTool.execute(baseArgs, context);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);

    const firstData = first.data as {
      task: { id: string };
      run: { id: string };
      deduplicated: boolean;
    };
    const secondData = second.data as {
      task: { id: string };
      run: { id: string };
      deduplicated: boolean;
    };
    expect(firstData.deduplicated).toBe(false);
    expect(secondData.deduplicated).toBe(true);
    expect(secondData.task.id).toBe(firstData.task.id);
    expect(secondData.run.id).toBe(firstData.run.id);

    const tasks = await runtime.service.listTasks('task-submit-dedupe', { limit: 100 });
    const runs = await runtime.service.listRuns('task-submit-dedupe', { limit: 100 });
    expect(tasks).toHaveLength(1);
    expect(runs).toHaveLength(1);
  });

  it('creates new task/run when force_new=true or dedupe_window_ms=0', async () => {
    const provider = createImmediateProvider('force new done');
    const context = createContext('task-submit-force-new', provider);
    const submitTool = new TaskV2SubmitTool({ runtime });

    const baseArgs = {
      title: 'Force New Title',
      description: 'Force New Description',
      prompt: 'force new prompt',
      profile: 'general-purpose',
      priority: 'medium' as const,
      status: 'ready' as const,
      wait: false,
      wait_timeout_ms: 10_000,
      poll_interval_ms: 100,
      include_events: false,
      events_after_seq: 0,
      events_limit: 50,
      dedupe_window_ms: 120_000,
      force_new: false,
    };

    const first = await submitTool.execute({ ...baseArgs, force_new: true }, context);
    const second = await submitTool.execute({ ...baseArgs, force_new: true }, context);
    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    const firstData = first.data as {
      task: { id: string };
      run: { id: string };
      deduplicated: boolean;
    };
    const secondData = second.data as {
      task: { id: string };
      run: { id: string };
      deduplicated: boolean;
    };
    expect(firstData.deduplicated).toBe(false);
    expect(secondData.deduplicated).toBe(false);
    expect(secondData.task.id).not.toBe(firstData.task.id);
    expect(secondData.run.id).not.toBe(firstData.run.id);

    const third = await submitTool.execute({ ...baseArgs, dedupe_window_ms: 0 }, context);
    const fourth = await submitTool.execute({ ...baseArgs, dedupe_window_ms: 0 }, context);
    expect(third.success).toBe(true);
    expect(fourth.success).toBe(true);
    const thirdData = third.data as {
      task: { id: string };
      run: { id: string };
      deduplicated: boolean;
    };
    const fourthData = fourth.data as {
      task: { id: string };
      run: { id: string };
      deduplicated: boolean;
    };
    expect(thirdData.deduplicated).toBe(false);
    expect(fourthData.deduplicated).toBe(false);
    expect(fourthData.task.id).not.toBe(thirdData.task.id);
    expect(fourthData.run.id).not.toBe(thirdData.run.id);
  });

  it('dispatches dependency-ready tasks with max_parallel and unlocks downstream tasks', async () => {
    const provider = createImmediateProvider('dispatch done');
    const context = createContext('dispatch-ready', provider);
    const taskCreate = new TaskV2CreateTool({ runtime });
    const taskUpdate = new TaskV2UpdateTool({ runtime });
    const dependencyAdd = new TaskV2DependencyAddTool({ runtime });
    const dispatchReady = new TaskV2DispatchReadyTool({ runtime });

    const taskA = await taskCreate.execute(
      { title: 'A', description: 'task-a', priority: 'medium', status: 'ready' },
      context
    );
    const taskB = await taskCreate.execute(
      { title: 'B', description: 'task-b', priority: 'medium', status: 'ready' },
      context
    );
    const taskC = await taskCreate.execute(
      { title: 'C', description: 'task-c', priority: 'medium', status: 'blocked' },
      context
    );
    expect(taskA.success && taskB.success && taskC.success).toBe(true);

    const taskAId = (taskA.data as { id: string }).id;
    const taskBId = (taskB.data as { id: string }).id;
    const taskCId = (taskC.data as { id: string }).id;
    const taskARunning = await taskUpdate.execute({ task_id: taskAId, status: 'running' }, context);
    expect(taskARunning.success).toBe(true);
    const taskACompleted = await taskUpdate.execute(
      { task_id: taskAId, status: 'completed' },
      context
    );
    expect(taskACompleted.success).toBe(true);
    const taskBRunning = await taskUpdate.execute({ task_id: taskBId, status: 'running' }, context);
    expect(taskBRunning.success).toBe(true);
    const taskBCompleted = await taskUpdate.execute(
      { task_id: taskBId, status: 'completed' },
      context
    );
    expect(taskBCompleted.success).toBe(true);
    expect(
      (await dependencyAdd.execute({ task_id: taskCId, depends_on_task_id: taskAId }, context))
        .success
    ).toBe(true);
    expect(
      (await dependencyAdd.execute({ task_id: taskCId, depends_on_task_id: taskBId }, context))
        .success
    ).toBe(true);

    const readyDispatch = await dispatchReady.execute(
      {
        profile: 'general-purpose',
        max_parallel: 2,
        scan_limit: 100,
        wait: true,
        wait_timeout_ms: 10_000,
        poll_interval_ms: 100,
        include_events: true,
        events_after_seq: 0,
        events_limit: 100,
      },
      context
    );
    expect(readyDispatch.success).toBe(true);
    const readyData = readyDispatch.data as {
      dispatched_count: number;
      promoted_task_ids: string[];
      events: Array<{ run_id: string; count: number }>;
    };
    expect(readyData.promoted_task_ids).toContain(taskCId);
    expect(readyData.dispatched_count).toBe(1);
    expect(readyData.events.length).toBe(1);
    expect(readyData.events[0].count).toBeGreaterThan(0);

    const taskD = await taskCreate.execute(
      { title: 'D', description: 'task-d', priority: 'medium', status: 'ready' },
      context
    );
    const taskE = await taskCreate.execute(
      { title: 'E', description: 'task-e', priority: 'medium', status: 'ready' },
      context
    );
    const taskF = await taskCreate.execute(
      { title: 'F', description: 'task-f', priority: 'medium', status: 'ready' },
      context
    );
    expect(taskD.success && taskE.success && taskF.success).toBe(true);

    const parallelDispatch = await dispatchReady.execute(
      {
        profile: 'general-purpose',
        max_parallel: 2,
        scan_limit: 100,
        wait: false,
        wait_timeout_ms: 10_000,
        poll_interval_ms: 100,
        include_events: false,
        events_after_seq: 0,
        events_limit: 100,
      },
      context
    );
    expect(parallelDispatch.success).toBe(true);
    const parallelData = parallelDispatch.data as { dispatched_count: number; waited: boolean };
    expect(parallelData.dispatched_count).toBe(2);
    expect(parallelData.waited).toBe(false);
  }, 15_000);

  it('returns actionable failures for missing provider and invalid ids', async () => {
    const context = createContext('tool-failure');

    const runStart = new TaskV2RunStartTool({ runtime });
    const runStartMissingProvider = await runStart.execute(
      {
        prompt: 'hi',
        agent_type: 'general-purpose',
      },
      context
    );
    expect(runStartMissingProvider.success).toBe(false);
    expect(String(runStartMissingProvider.error)).toContain('TASK_PROVIDER_MISSING');

    const submitTool = new TaskV2SubmitTool({ runtime });
    const submitMissingProvider = await submitTool.execute(
      {
        title: 'missing provider task',
        description: 'desc',
        prompt: 'hi',
        profile: 'general-purpose',
        priority: 'medium',
        status: 'ready',
        wait: true,
        wait_timeout_ms: 10_000,
        poll_interval_ms: 100,
        include_events: false,
        events_after_seq: 0,
        events_limit: 50,
        dedupe_window_ms: 120_000,
        force_new: false,
      },
      context
    );
    expect(submitMissingProvider.success).toBe(false);
    expect(String(submitMissingProvider.error)).toContain('TASK_PROVIDER_MISSING');

    const dispatchTool = new TaskV2DispatchReadyTool({ runtime });
    const dispatchMissingProvider = await dispatchTool.execute(
      {
        profile: 'general-purpose',
        max_parallel: 1,
        scan_limit: 10,
        wait: false,
        wait_timeout_ms: 10_000,
        poll_interval_ms: 100,
        include_events: false,
        events_after_seq: 0,
        events_limit: 50,
      },
      context
    );
    expect(dispatchMissingProvider.success).toBe(false);
    expect(String(dispatchMissingProvider.error)).toContain('TASK_PROVIDER_MISSING');

    const taskGet = new TaskV2GetTool({ runtime });
    const missing = await taskGet.execute({ task_id: 'tsk_not_exists' }, context);
    expect(missing.success).toBe(false);
    expect(String(missing.error)).toContain('NOT_FOUND');

    const unknownProfile = await runStart.execute(
      {
        prompt: 'hi',
        agent_type: 'general-purpose',
        agent_profile_id: 'profile_not_exists',
      },
      createContext('tool-failure-profile', createImmediateProvider('x'))
    );
    expect(unknownProfile.success).toBe(false);
    expect(String(unknownProfile.error)).toContain('INVALID_ARGUMENT');
    expect(String(unknownProfile.error)).toContain('unknown agent profile');
  });

  it('supports run cancellation through task_run_cancel on active run', async () => {
    const provider = createBlockingProvider();
    const context = createContext('tool-cancel', provider);

    const runStart = new TaskV2RunStartTool({ runtime });
    const runCancel = new TaskV2RunCancelTool({ runtime });
    const runWait = new TaskV2RunWaitTool({ runtime });

    const started = await runStart.execute(
      {
        prompt: 'block',
        agent_type: 'general-purpose',
      },
      context
    );
    expect(started.success).toBe(true);
    const runId = (started.data as { id: string }).id;

    const canceled = await runCancel.execute({ run_id: runId }, context);
    expect(canceled.success).toBe(true);

    const waited = await runWait.execute(
      {
        run_id: runId,
        timeout_ms: 10_000,
        poll_interval_ms: 100,
      },
      context
    );
    expect(waited.success).toBe(true);
    expect((waited.data as { status: string }).status).toBe('cancelled');
  });

  it('covers runtime registry and session resolution fallback branches', async () => {
    const same1 = getDefaultTaskV2Runtime({ dbPath });
    const same2 = getDefaultTaskV2Runtime({ dbPath });
    expect(same1).toBe(same2);

    const context = createBareContext();
    expect(runtime.resolveSessionId(context)).toBe('default-session');
  });

  it('covers tool meta/default-runtime/exception mapping branches', async () => {
    // Cover resolveRuntime->getDefaultTaskV2Runtime branch without explicit runtime.
    const defaultListTool = new TaskV2ListTool({ workingDirectory: tempDir });
    const defaultResult = await defaultListTool.execute(
      { status: undefined, priority: undefined, limit: 10 },
      createContext('default-runtime', createImmediateProvider('x'))
    );
    expect(defaultResult.success).toBe(true);

    const taskV2Error = new TaskV2Error('BROKEN', 'task-v2-error');
    const failingRuntime = {
      prepare: async () => undefined,
      resolveSessionId: () => 'failing-session',
      service: {
        createTask: async () => {
          throw taskV2Error;
        },
        getTask: async () => {
          throw taskV2Error;
        },
        listTasks: async () => {
          throw taskV2Error;
        },
        updateTask: async () => {
          throw taskV2Error;
        },
        deleteTask: async () => {
          throw taskV2Error;
        },
        startRun: async () => {
          throw taskV2Error;
        },
        getRun: async () => {
          throw taskV2Error;
        },
        waitRun: async () => {
          throw taskV2Error;
        },
        cancelRun: async () => {
          throw taskV2Error;
        },
        listRunEvents: async () => {
          throw taskV2Error;
        },
        clearSession: async () => {
          throw taskV2Error;
        },
        gcRuns: async () => {
          throw taskV2Error;
        },
      },
    } as unknown as TaskV2Runtime;

    const tools = [
      new TaskV2CreateTool({ runtime: failingRuntime }),
      new TaskV2GetTool({ runtime: failingRuntime }),
      new TaskV2ListTool({ runtime: failingRuntime }),
      new TaskV2UpdateTool({ runtime: failingRuntime }),
      new TaskV2DeleteTool({ runtime: failingRuntime }),
      new TaskV2SubmitTool({ runtime: failingRuntime, provider: createImmediateProvider('x') }),
      new TaskV2RunStartTool({ runtime: failingRuntime, provider: createImmediateProvider('x') }),
      new TaskV2RunGetTool({ runtime: failingRuntime }),
      new TaskV2RunWaitTool({ runtime: failingRuntime }),
      new TaskV2RunCancelTool({ runtime: failingRuntime }),
      new TaskV2RunEventsTool({ runtime: failingRuntime }),
      new TaskV2ClearSessionTool({ runtime: failingRuntime }),
      new TaskV2GcRunsTool({ runtime: failingRuntime }),
    ];

    for (const tool of tools) {
      expect(typeof tool.meta.name).toBe('string');
      expect(tool.meta.name.length).toBeGreaterThan(0);
    }

    expect(
      (
        await (tools[0] as TaskV2CreateTool).execute(
          { title: 'x', description: 'y', priority: 'medium', status: 'pending' },
          createContext('fail')
        )
      ).success
    ).toBe(false);
    expect(
      (await (tools[1] as TaskV2GetTool).execute({ task_id: 'tsk_1' }, createContext('fail')))
        .success
    ).toBe(false);
    expect(
      (
        await (tools[2] as TaskV2ListTool).execute(
          { status: undefined, priority: undefined, limit: 10 },
          createContext('fail')
        )
      ).success
    ).toBe(false);
    expect(
      (
        await (tools[3] as TaskV2UpdateTool).execute(
          { task_id: 'tsk_1', status: 'ready' },
          createContext('fail')
        )
      ).success
    ).toBe(false);
    expect(
      (await (tools[4] as TaskV2DeleteTool).execute({ task_id: 'tsk_1' }, createContext('fail')))
        .success
    ).toBe(false);
    expect(
      (
        await (tools[5] as TaskV2SubmitTool).execute(
          {
            title: 'x',
            description: 'y',
            prompt: 'x',
            profile: 'general-purpose',
            priority: 'medium',
            status: 'ready',
            wait: true,
            wait_timeout_ms: 1000,
            poll_interval_ms: 100,
            include_events: false,
            events_after_seq: 0,
            events_limit: 50,
            dedupe_window_ms: 120_000,
            force_new: false,
          },
          createContext('fail')
        )
      ).success
    ).toBe(false);
    expect(
      (
        await (tools[6] as TaskV2RunStartTool).execute(
          { prompt: 'x', agent_type: 'general-purpose' },
          createContext('fail')
        )
      ).success
    ).toBe(false);
    expect(
      (await (tools[7] as TaskV2RunGetTool).execute({ run_id: 'run_1' }, createContext('fail')))
        .success
    ).toBe(false);
    expect(
      (
        await (tools[8] as TaskV2RunWaitTool).execute(
          { run_id: 'run_1', timeout_ms: 1000, poll_interval_ms: 100 },
          createContext('fail')
        )
      ).success
    ).toBe(false);
    expect(
      (await (tools[9] as TaskV2RunCancelTool).execute({ run_id: 'run_1' }, createContext('fail')))
        .success
    ).toBe(false);
    expect(
      (
        await (tools[10] as TaskV2RunEventsTool).execute(
          { run_id: 'run_1', after_seq: 0, limit: 10 },
          createContext('fail')
        )
      ).success
    ).toBe(false);
    expect(
      (await (tools[11] as TaskV2ClearSessionTool).execute({}, createContext('fail'))).success
    ).toBe(false);
    expect(
      (
        await (tools[12] as TaskV2GcRunsTool).execute(
          { older_than_hours: 24, limit: 10, finished_before: undefined },
          createContext('fail')
        )
      ).success
    ).toBe(false);

    // Cover parseInputSnapshot invalid-json branch in formatRun through run_get.
    const badSnapshotRuntime = {
      prepare: async () => undefined,
      resolveSessionId: () => 'bad-snapshot',
      service: {
        getRun: async () => ({
          id: createRunId(),
          sessionId: 'bad-snapshot',
          taskId: undefined,
          agentType: 'general-purpose',
          status: 'failed',
          inputSnapshot: '{bad-json',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      },
    } as unknown as TaskV2Runtime;
    const badSnapshotResult = await new TaskV2RunGetTool({ runtime: badSnapshotRuntime }).execute(
      { run_id: 'run_x' },
      createContext('bad-snapshot')
    );
    expect(badSnapshotResult.success).toBe(true);
    expect((badSnapshotResult.data as { input_snapshot: unknown }).input_snapshot).toEqual({});

    // Cover resolveProvider/resolveMemoryManager options branch and custom tool manager branch.
    const providerOptionRuntime = {
      prepare: async () => undefined,
      resolveSessionId: () => 'provider-option',
      service: {
        startRun: async (_sid: string, runId: string) => ({
          id: runId,
          sessionId: 'provider-option',
          taskId: undefined,
          agentType: 'general-purpose',
          status: 'queued',
          inputSnapshot: '{}',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }),
      },
    } as unknown as TaskV2Runtime;
    const providerOptionTool = new TaskV2RunStartTool({
      runtime: providerOptionRuntime,
      provider: createImmediateProvider('option'),
      memoryManager: {} as never,
      createSubagentToolManager: () => new ToolManager(),
    });
    const providerOptionResult = await providerOptionTool.execute(
      { prompt: 'x', agent_type: 'general-purpose' },
      createContext('provider-option')
    );
    expect(providerOptionResult.success).toBe(true);

    // Cover failureResult error-mapping branches for generic Error / non-Error throw values.
    const genericErrorRuntime = {
      prepare: async () => undefined,
      resolveSessionId: () => 'generic-error',
      service: {
        getTask: async () => {
          throw new Error('generic failure');
        },
      },
    } as unknown as TaskV2Runtime;
    const genericErrorRes = await new TaskV2GetTool({ runtime: genericErrorRuntime }).execute(
      { task_id: 'tsk_1' },
      createContext('generic-error')
    );
    expect(genericErrorRes.success).toBe(false);
    expect(String(genericErrorRes.error)).toContain('generic failure');

    const stringErrorRuntime = {
      prepare: async () => undefined,
      resolveSessionId: () => 'string-error',
      service: {
        getTask: async () => {
          throw 'string failure';
        },
      },
    } as unknown as TaskV2Runtime;
    const stringErrorRes = await new TaskV2GetTool({ runtime: stringErrorRuntime }).execute(
      { task_id: 'tsk_1' },
      createContext('string-error')
    );
    expect(stringErrorRes.success).toBe(false);
    expect(String(stringErrorRes.error)).toContain('string failure');
  });

  it('applies sub-agent profile and overrides to snapshot/system prompt/tool policy', async () => {
    const capture: { messages?: LLMRequestMessage[]; toolNames?: string[] } = {};
    const provider = createInspectingProvider(capture);
    const context = createContext('profile-run', provider);
    const runStart = new TaskV2RunStartTool({
      runtime,
      createSubagentToolManager: () => {
        const manager = new ToolManager();
        manager.register([
          createTool(
            {
              name: 'bash',
              description: 'bash',
              parameters: z.object({}).strict(),
            },
            async () => ({ success: true, data: {} })
          ),
          createTool(
            {
              name: 'file',
              description: 'file',
              parameters: z.object({}).strict(),
            },
            async () => ({ success: true, data: {} })
          ),
          createTool(
            {
              name: 'grep',
              description: 'grep',
              parameters: z.object({}).strict(),
            },
            async () => ({ success: true, data: {} })
          ),
        ]);
        return manager;
      },
    });
    const runWait = new TaskV2RunWaitTool({ runtime });

    const started = await runStart.execute(
      {
        prompt: 'profile-test',
        agent_type: 'general-purpose',
        agent_profile_id: 'plan',
        agent_overrides: {
          system_prompt: 'You are custom planner',
          output_contract: 'Return bullet list.',
          max_steps: 5,
          tool_allowlist: ['file', 'bash'],
          tool_denylist: ['bash'],
          memory_mode: 'off',
        },
      },
      context
    );
    expect(started.success).toBe(true);
    const startedData = started.data as {
      id: string;
      agent_profile_id: string;
      agent_config_snapshot: {
        systemPrompt: string;
        maxSteps: number;
        memoryMode: string;
      };
    };
    expect(startedData.agent_profile_id).toBe('plan');
    expect(startedData.agent_config_snapshot.systemPrompt).toBe('You are custom planner');
    expect(startedData.agent_config_snapshot.maxSteps).toBe(5);
    expect(startedData.agent_config_snapshot.memoryMode).toBe('off');

    const waited = await runWait.execute(
      {
        run_id: startedData.id,
        timeout_ms: 10_000,
        poll_interval_ms: 100,
      },
      context
    );
    expect(waited.success).toBe(true);
    expect((waited.data as { status: string }).status).toBe('succeeded');

    const systemMessages = (capture.messages ?? []).filter((message) => message.role === 'system');
    expect(systemMessages.length).toBeGreaterThan(0);
    const systemText = String(systemMessages[0].content);
    expect(systemText).toContain('You are custom planner');
    expect(systemText).toContain('Output contract');
    expect(capture.toolNames).toEqual(['file']);
  });

  it('covers agent adapter success/failure/timeout/cancel and prompt parsing branches', async () => {
    const runBase: Run = {
      id: createRunId(),
      sessionId: 'adapter',
      taskId: undefined,
      agentType: 'general-purpose',
      status: 'running',
      inputSnapshot: JSON.stringify({ prompt: 'hello adapter' }),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      timeoutMs: 1000,
    };

    const successAdapter = createAgentRunExecutionAdapter({
      provider: createImmediateProvider('ok'),
    });
    const successResult = await successAdapter.execute(
      runBase,
      new AbortController().signal,
      async () => undefined
    );
    expect(successResult.status).toBe('succeeded');

    const failedAdapter = createAgentRunExecutionAdapter({
      provider: createFailingProvider(),
    });
    const failureResult = await failedAdapter.execute(
      {
        ...runBase,
        id: createRunId(),
        inputSnapshot: '{invalid json',
      },
      new AbortController().signal,
      async () => undefined
    );
    expect(failureResult.status).toBe('failed');
    expect(String(failureResult.error)).toContain('boom');

    const timeoutAdapter = createAgentRunExecutionAdapter({
      provider: createBlockingProvider(),
    });
    const timeoutResult = await timeoutAdapter.execute(
      {
        ...runBase,
        id: createRunId(),
        timeoutMs: 30,
      },
      new AbortController().signal,
      async () => undefined
    );
    expect(timeoutResult.status).toBe('timeout');

    const cancelAdapter = createAgentRunExecutionAdapter({
      provider: createBlockingProvider(),
    });
    const ac = new AbortController();
    setTimeout(() => ac.abort('cancel'), 30);
    const cancelResult = await cancelAdapter.execute(
      {
        ...runBase,
        id: createRunId(),
        timeoutMs: 1000,
      },
      ac.signal,
      async () => undefined
    );
    expect(cancelResult.status).toBe('cancelled');
  });
});

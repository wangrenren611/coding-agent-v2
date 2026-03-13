import * as os from 'node:os';
import * as path from 'node:path';
import * as fsPromises from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskCreateTool } from '../task-create';
import { TaskGetTool } from '../task-get';
import { TaskListTool } from '../task-list';
import { TaskStore } from '../task-store';
import { TaskUpdateTool } from '../task-update';
import type { TaskEntity } from '../task-types';

function parseOutput<T>(output: string | undefined): T {
  return JSON.parse(output || '{}') as T;
}

function makeTask(overrides: Partial<TaskEntity> = {}): TaskEntity {
  const now = 1000;
  return {
    id: overrides.id || 'task_x',
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
    lastError: overrides.lastError,
    lastErrorAt: overrides.lastErrorAt,
    timeoutMs: overrides.timeoutMs,
    tags: overrides.tags || [],
    metadata: overrides.metadata || {},
    history: overrides.history || [],
    agentId: overrides.agentId,
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
    startedAt: overrides.startedAt,
    completedAt: overrides.completedAt,
    cancelledAt: overrides.cancelledAt,
    version: overrides.version || 1,
  };
}

describe('task_create/task_get/task_list/task_update edge branches', () => {
  let baseDir: string;
  let store: TaskStore;
  let taskCreate: TaskCreateTool;
  let taskGet: TaskGetTool;
  let taskList: TaskListTool;
  let taskUpdate: TaskUpdateTool;

  beforeEach(async () => {
    baseDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'renx-task-core-edge-'));
    store = new TaskStore({ baseDir });
    taskCreate = new TaskCreateTool({ store, defaultNamespace: 'def-ns' });
    taskGet = new TaskGetTool({ store, defaultNamespace: 'def-ns' });
    taskList = new TaskListTool({ store, defaultNamespace: 'def-ns' });
    taskUpdate = new TaskUpdateTool({ store, defaultNamespace: 'def-ns' });
  });

  afterEach(async () => {
    await fsPromises.rm(baseDir, { recursive: true, force: true });
  });

  it('covers task_create checkpoint/retry branches and concurrency metadata', async () => {
    const defaultCreateTool = new TaskCreateTool();
    expect(
      defaultCreateTool.getConcurrencyLockKey({
        subject: 's',
        description: '0123456789a',
      } as never)
    ).toBe('taskns:default');

    expect(taskCreate.getConcurrencyMode()).toBe('exclusive');
    expect(
      taskCreate.getConcurrencyLockKey({
        subject: 's',
        description: '0123456789a',
      } as never)
    ).toBe('taskns:def-ns');
    expect(
      taskCreate.getConcurrencyLockKey({
        namespace: 'abc',
        subject: 's',
        description: '0123456789a',
      } as never)
    ).toBe('taskns:abc');

    const created = await taskCreate.execute({
      subject: 'Create with checkpoints',
      description: 'Create with explicit checkpoints and retry config here.',
      active_form: 'Actively creating checkpoints',
      checkpoints: [
        { id: 'c1', name: 'first', completed: true },
        { id: 'c2', name: 'second', completed: false },
      ],
      retry_config: {
        maxRetries: 9,
        retryDelayMs: 200,
        backoffMultiplier: 3,
        retryOn: ['x', 'y'],
      },
    });
    expect(created.success).toBe(true);
    const payload = parseOutput<{
      namespace: string;
      task: {
        checkpoints: Array<{ id: string; completed: boolean }>;
        retryConfig: { maxRetries: number };
      };
    }>(created.output);
    expect(payload.namespace).toBe('def-ns');
    expect((payload as { task: { activeForm?: string } }).task.activeForm).toBe(
      'Actively creating checkpoints'
    );
    expect(payload.task.checkpoints).toEqual([
      { id: 'c1', name: 'first', completed: true },
      { id: 'c2', name: 'second', completed: false },
    ]);
    expect(payload.task.retryConfig.maxRetries).toBe(9);
  });

  it('covers task_create catch fallback when store throws non-prefixed error', async () => {
    const fakeStore = {
      normalizeNamespace: () => 'n1',
      updateState: async () => {
        throw 'raw failure';
      },
    } as unknown as TaskStore;
    const tool = new TaskCreateTool({ store: fakeStore });
    const result = await tool.execute({
      namespace: 'n1',
      subject: 'abc',
      description: '0123456789abcd',
    });
    expect(result.success).toBe(false);
    expect(result.output).toContain('TASK_OPERATION_FAILED');
  });

  it('covers task_get not-found, checkpoint progress, missing blocker/blocked branches', async () => {
    const defaultGetTool = new TaskGetTool();
    expect(defaultGetTool.getConcurrencyLockKey({ task_id: 'x' } as never)).toBe(
      'taskns:default:task:x'
    );

    expect(taskGet.getConcurrencyMode()).toBe('parallel-safe');
    expect(taskGet.getConcurrencyLockKey({ task_id: 't1' } as never)).toBe('taskns:def-ns:task:t1');
    expect(taskGet.getConcurrencyLockKey({ namespace: 'ns', task_id: 't2' } as never)).toBe(
      'taskns:ns:task:t2'
    );

    const missing = await taskGet.execute({
      task_id: 'missing',
    });
    expect(missing.success).toBe(false);
    expect(missing.output).toContain('TASK_NOT_FOUND');

    const created = await taskCreate.execute({
      namespace: 'g1',
      subject: 'Task get detail',
      description: 'Task get detail with checkpoints and links.',
      checkpoints: [
        { id: 'a', name: 'A', completed: true },
        { id: 'b', name: 'B', completed: false },
      ],
    });
    const taskId = parseOutput<{ task: { id: string } }>(created.output).task.id;

    await store.updateState('g1', (state) => {
      const task = state.tasks[taskId];
      task.blockedBy = ['missing-upstream'];
      task.blocks = ['missing-downstream'];
      return null;
    });

    const detail = await taskGet.execute({
      namespace: 'g1',
      task_id: taskId,
      include_history: true,
    });
    expect(detail.success).toBe(true);
    const payload = parseOutput<{
      task: {
        blockers: Array<{ status: string }>;
        blocked_tasks: Array<{ status: string }>;
        checkpoint_progress: number;
        history?: unknown[];
      };
    }>(detail.output);
    expect(payload.task.blockers[0].status).toBe('missing');
    expect(payload.task.blocked_tasks[0].status).toBe('missing');
    expect(payload.task.checkpoint_progress).toBe(50);
    expect(Array.isArray(payload.task.history)).toBe(true);
  });

  it('covers task_list filters, ranking branches and tie-breaking', async () => {
    const defaultListTool = new TaskListTool();
    expect(defaultListTool.getConcurrencyLockKey({} as never)).toBe('taskns:default:list');

    expect(taskList.getConcurrencyMode()).toBe('parallel-safe');
    expect(taskList.getConcurrencyLockKey({} as never)).toBe('taskns:def-ns:list');
    expect(taskList.getConcurrencyLockKey({ namespace: 'l1' } as never)).toBe('taskns:l1:list');

    await store.updateState('l1', (state) => {
      const now = 10;
      state.tasks = {
        critical_claim: makeTask({
          id: 'critical_claim',
          subject: 'critical',
          status: 'pending',
          priority: 'critical',
          createdAt: now + 1,
          updatedAt: now + 1,
          tags: [{ name: 'backend' }],
        }),
        in_progress: makeTask({
          id: 'in_progress',
          subject: 'in progress',
          status: 'in_progress',
          owner: 'worker',
          createdAt: now + 2,
          updatedAt: now + 2,
          tags: [{ name: 'backend' }],
        }),
        high_old: makeTask({
          id: 'high_old',
          subject: 'high old',
          status: 'pending',
          priority: 'high',
          createdAt: now + 3,
          updatedAt: now + 3,
          owner: null,
        }),
        high_new: makeTask({
          id: 'high_new',
          subject: 'high new',
          status: 'pending',
          priority: 'high',
          createdAt: now + 9,
          updatedAt: now + 9,
          owner: null,
        }),
        normal_claim: makeTask({
          id: 'normal_claim',
          subject: 'normal',
          status: 'pending',
          priority: 'normal',
          createdAt: now + 4,
          updatedAt: now + 4,
        }),
        low_b: makeTask({
          id: 'low_b',
          subject: 'low b',
          status: 'pending',
          priority: 'low',
          createdAt: now + 5,
          updatedAt: now + 5,
        }),
        low_a: makeTask({
          id: 'low_a',
          subject: 'low a',
          status: 'pending',
          priority: 'low',
          createdAt: now + 5,
          updatedAt: now + 5,
        }),
        blocked_missing: makeTask({
          id: 'blocked_missing',
          subject: 'blocked',
          status: 'pending',
          priority: 'normal',
          blockedBy: ['missing_blocker'],
          createdAt: now + 6,
          updatedAt: now + 6,
        }),
        blocked_by_completed: makeTask({
          id: 'blocked_by_completed',
          subject: 'blocked by completed',
          status: 'pending',
          priority: 'normal',
          blockedBy: ['completed_task'],
          createdAt: now + 6,
          updatedAt: now + 6,
        }),
        completed_task: makeTask({
          id: 'completed_task',
          subject: 'completed',
          status: 'completed',
          createdAt: now + 7,
          updatedAt: now + 7,
        }),
        cancelled_task: makeTask({
          id: 'cancelled_task',
          subject: 'cancelled',
          status: 'cancelled',
          createdAt: now + 8,
          updatedAt: now + 8,
        }),
        failed_task: makeTask({
          id: 'failed_task',
          subject: 'failed',
          status: 'failed',
          createdAt: now + 11,
          updatedAt: now + 11,
        }),
        pending_owned: makeTask({
          id: 'pending_owned',
          subject: 'pending owned',
          status: 'pending',
          owner: 'someone',
          createdAt: now + 12,
          updatedAt: now + 12,
        }),
      };
      return null;
    });

    const all = await taskList.execute({
      namespace: 'l1',
      include_history: true,
    });
    expect(all.success).toBe(true);
    const allPayload = parseOutput<{ tasks: Array<{ id: string; history?: unknown }> }>(all.output);
    expect(allPayload.tasks[0].id).toBe('critical_claim');
    const ids = allPayload.tasks.map((item) => item.id);
    expect(ids.indexOf('high_old')).toBeLessThan(ids.indexOf('high_new'));
    expect(ids.indexOf('low_a')).toBeLessThan(ids.indexOf('low_b'));
    expect(allPayload.tasks.every((item) => item.history !== undefined)).toBe(true);

    const byStatus = await taskList.execute({
      namespace: 'l1',
      statuses: ['pending'],
    });
    expect(byStatus.success).toBe(true);
    const byStatusPayload = parseOutput<{ tasks: Array<{ status: string }> }>(byStatus.output);
    expect(byStatusPayload.tasks.every((task) => task.status === 'pending')).toBe(true);

    const byOwner = await taskList.execute({
      namespace: 'l1',
      owner: 'worker',
    });
    const byOwnerPayload = parseOutput<{ total: number; tasks: Array<{ owner: string | null }> }>(
      byOwner.output
    );
    expect(byOwnerPayload.total).toBe(1);
    expect(byOwnerPayload.tasks[0].owner).toBe('worker');

    const byTag = await taskList.execute({
      namespace: 'l1',
      tag: 'backend',
    });
    const byTagPayload = parseOutput<{ total: number }>(byTag.output);
    expect(byTagPayload.total).toBe(2);

    const defaultNamespaceList = await defaultListTool.execute({});
    expect(defaultNamespaceList.success).toBe(true);
  });

  it('covers task_update edge branches across validation/dependency/status/history', async () => {
    const defaultUpdateTool = new TaskUpdateTool();
    expect(defaultUpdateTool.getConcurrencyLockKey({ task_id: 'x' } as never)).toBe(
      'taskns:default'
    );

    expect(taskUpdate.getConcurrencyMode()).toBe('exclusive');
    expect(taskUpdate.getConcurrencyLockKey({ task_id: 'x' } as never)).toBe('taskns:def-ns');
    expect(taskUpdate.getConcurrencyLockKey({ namespace: 'u1', task_id: 'x' } as never)).toBe(
      'taskns:u1'
    );

    const empty = await taskUpdate.execute({
      namespace: 'u1',
      task_id: 'none',
    });
    expect(empty.success).toBe(false);
    expect(empty.output).toContain('TASK_UPDATE_EMPTY');

    const notFound = await taskUpdate.execute({
      namespace: 'u1',
      task_id: 'none',
      subject: 'new subject',
    });
    expect(notFound.success).toBe(false);
    expect(notFound.output).toContain('TASK_NOT_FOUND');

    const created = await taskCreate.execute({
      namespace: 'u1',
      subject: 'updatable task',
      description: 'Updatable task with enough details in description.',
    });
    const taskId = parseOutput<{ task: { id: string } }>(created.output).task.id;

    await store.updateState('u1', (state) => {
      state.tasks[taskId].status = 'completed';
      return null;
    });

    const terminal = await taskUpdate.execute({
      namespace: 'u1',
      task_id: taskId,
      subject: 'should fail',
    });
    expect(terminal.success).toBe(false);
    expect(terminal.output).toContain('TASK_TERMINAL_IMMUTABLE');

    const created2 = await taskCreate.execute({
      namespace: 'u1',
      subject: 'second updatable task',
      description: 'Second task with details for update branches.',
    });
    const task2 = parseOutput<{ task: { id: string } }>(created2.output).task.id;

    const invalidTransition = await taskUpdate.execute({
      namespace: 'u1',
      task_id: task2,
      status: 'completed',
    });
    expect(invalidTransition.success).toBe(false);
    expect(invalidTransition.output).toContain('TASK_INVALID_STATUS_TRANSITION');

    const missingBlocker = await taskUpdate.execute({
      namespace: 'u1',
      task_id: task2,
      add_blocked_by: ['missing-task'],
    });
    expect(missingBlocker.success).toBe(false);
    expect(missingBlocker.output).toContain('TASK_NOT_FOUND');

    const selfDependency = await taskUpdate.execute({
      namespace: 'u1',
      task_id: task2,
      add_blocked_by: [task2],
    });
    expect(selfDependency.success).toBe(false);
    expect(selfDependency.output).toContain('TASK_CYCLE_DEPENDENCY');

    const removeMissing = await taskUpdate.execute({
      namespace: 'u1',
      task_id: task2,
      remove_blocked_by: ['not-exists'],
      reason: 'cleanup',
      updated_by: 'tester',
    });
    expect(removeMissing.success).toBe(true);
    const removePayload = parseOutput<{ task: { history: Array<{ action: string }> } }>(
      removeMissing.output
    );
    expect(removePayload.task.history.some((entry) => entry.action === 'dependency_removed')).toBe(
      true
    );

    const merged = await taskUpdate.execute({
      namespace: 'u1',
      task_id: task2,
      subject: 'second updatable task renamed',
      metadata: { k1: 'v1' },
      reason: 'minor edit',
      updated_by: 'tester',
    });
    expect(merged.success).toBe(true);
    const mergedPayload = parseOutput<{
      task: { metadata: Record<string, unknown>; history: Array<{ action: string }> };
    }>(merged.output);
    expect(mergedPayload.task.metadata.k1).toBe('v1');
    expect(mergedPayload.task.history.some((entry) => entry.action === 'updated')).toBe(true);

    const fieldUpdates = await taskUpdate.execute({
      namespace: 'u1',
      task_id: task2,
      description: 'Updated description with enough detail for branch coverage.',
      active_form: 'Actively updating task fields',
      priority: 'high',
      progress: 55,
    });
    expect(fieldUpdates.success).toBe(true);
    const fieldUpdatePayload = parseOutput<{
      task: { description: string; activeForm: string; priority: string; progress: number };
    }>(fieldUpdates.output);
    expect(fieldUpdatePayload.task.description).toContain('Updated description');
    expect(fieldUpdatePayload.task.activeForm).toBe('Actively updating task fields');
    expect(fieldUpdatePayload.task.priority).toBe('high');
    expect(fieldUpdatePayload.task.progress).toBe(55);

    const goRunning = await taskUpdate.execute({
      namespace: 'u1',
      task_id: task2,
      status: 'in_progress',
      owner: 'agent-x',
    });
    expect(goRunning.success).toBe(true);

    const backPending = await taskUpdate.execute({
      namespace: 'u1',
      task_id: task2,
      status: 'pending',
    });
    expect(backPending.success).toBe(true);
    const backPendingPayload = parseOutput<{ task: { owner: string | null } }>(backPending.output);
    expect(backPendingPayload.task.owner).toBeNull();

    const goRunningAgain = await taskUpdate.execute({
      namespace: 'u1',
      task_id: task2,
      status: 'in_progress',
      owner: 'agent-y',
    });
    expect(goRunningAgain.success).toBe(true);

    const failed = await taskUpdate.execute({
      namespace: 'u1',
      task_id: task2,
      status: 'failed',
      reason: 'boom',
    });
    expect(failed.success).toBe(true);
    const failedPayload = parseOutput<{ task: { lastError?: string; owner: string | null } }>(
      failed.output
    );
    expect(failedPayload.task.lastError).toContain('boom');
    expect(failedPayload.task.owner).toBeNull();

    const created4 = await taskCreate.execute({
      namespace: 'u1',
      subject: 'failed uses previous lastError',
      description: 'Task to test lastError fallback using existing error value.',
    });
    const task4 = parseOutput<{ task: { id: string } }>(created4.output).task.id;
    await taskUpdate.execute({
      namespace: 'u1',
      task_id: task4,
      status: 'in_progress',
      owner: 'agent-prev',
    });
    await store.updateState('u1', (state) => {
      state.tasks[task4].lastError = 'existing error';
      return null;
    });
    const failedUsePrevious = await taskUpdate.execute({
      namespace: 'u1',
      task_id: task4,
      status: 'failed',
    });
    expect(failedUsePrevious.success).toBe(true);
    const failedUsePreviousPayload = parseOutput<{ task: { lastError?: string } }>(
      failedUsePrevious.output
    );
    expect(failedUsePreviousPayload.task.lastError).toBe('existing error');

    const created5 = await taskCreate.execute({
      namespace: 'u1',
      subject: 'failed uses default lastError',
      description: 'Task to test default lastError fallback when none is provided.',
    });
    const task5 = parseOutput<{ task: { id: string } }>(created5.output).task.id;
    await taskUpdate.execute({
      namespace: 'u1',
      task_id: task5,
      status: 'in_progress',
      owner: 'agent-default',
    });
    const failedDefault = await taskUpdate.execute({
      namespace: 'u1',
      task_id: task5,
      status: 'failed',
    });
    expect(failedDefault.success).toBe(true);
    const failedDefaultPayload = parseOutput<{ task: { lastError?: string } }>(
      failedDefault.output
    );
    expect(failedDefaultPayload.task.lastError).toContain('task marked as failed');

    const created3 = await taskCreate.execute({
      namespace: 'u1',
      subject: 'cancel path task',
      description: 'Task for cancelled status branch in update tool.',
    });
    const task3 = parseOutput<{ task: { id: string } }>(created3.output).task.id;
    const cancelled = await taskUpdate.execute({
      namespace: 'u1',
      task_id: task3,
      status: 'cancelled',
      reason: 'stop',
    });
    expect(cancelled.success).toBe(true);
    const cancelledPayload = parseOutput<{
      task: { status: string; history: Array<{ action: string }> };
    }>(cancelled.output);
    expect(cancelledPayload.task.status).toBe('cancelled');
    expect(cancelledPayload.task.history.some((entry) => entry.action === 'cancelled')).toBe(true);
  });

  it('covers task_update catch fallback for non-prefixed thrown values', async () => {
    const fakeStore = {
      normalizeNamespace: () => 'n1',
      updateState: async () => {
        throw 'unstructured failure';
      },
    } as unknown as TaskStore;
    const tool = new TaskUpdateTool({ store: fakeStore });
    const result = await tool.execute({
      namespace: 'n1',
      task_id: 'x',
      subject: 'abc',
    });
    expect(result.success).toBe(false);
    expect(result.output).toContain('TASK_OPERATION_FAILED');
  });

  it('covers namespace fallback execution path in task_update', async () => {
    const created = await taskCreate.execute({
      subject: 'default namespace update',
      description: 'Task created in default namespace for update execution fallback.',
    });
    const taskId = parseOutput<{ task: { id: string } }>(created.output).task.id;
    const updated = await taskUpdate.execute({
      task_id: taskId,
      subject: 'default namespace updated',
    });
    expect(updated.success).toBe(true);
  });
});

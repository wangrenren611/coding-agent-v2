import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskV3Error } from '../task-v3/errors';
import { SqliteTaskRunner } from '../task-v3/runtime/sqlite-runner';
import { TaskService } from '../task-v3/service';
import { SqliteTaskRepository } from '../task-v3/storage/sqlite-repository';
import { createRunId, createTaskId } from '../task-v3/ulid';

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs = 5000,
  intervalMs = 20
): Promise<void> {
  const end = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (await predicate()) {
      return;
    }
    if (Date.now() >= end) {
      throw new Error('waitUntil timeout');
    }
    await sleep(intervalMs);
  }
}

describe('task-v3 core (repository/service/runner)', () => {
  let tempDir: string;
  let dbPath: string;
  let repository: SqliteTaskRepository;
  let runner: SqliteTaskRunner;
  let service: TaskService;

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'task-v3-core-'));
    dbPath = path.join(tempDir, 'tasks.db');
    repository = new SqliteTaskRepository({ dbPath });
    runner = new SqliteTaskRunner(repository);
    service = new TaskService(repository, runner);
    await service.prepare();
  });

  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  it('supports task CRUD with session isolation and optimistic locking', async () => {
    const sessionA = 's-a';
    const sessionB = 's-b';
    const taskId = createTaskId();

    const created = await service.createTask(
      sessionA,
      { title: 'A', description: 'desc A', priority: 'high', status: 'pending' },
      taskId
    );
    expect(created.id).toBe(taskId);
    expect(created.version).toBe(1);

    await expect(service.getTask(sessionB, taskId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    } satisfies Partial<TaskV3Error>);

    await expect(
      service.updateTask(sessionA, taskId, { status: 'completed' })
    ).rejects.toMatchObject({
      code: 'INVALID_STATUS_TRANSITION',
    } satisfies Partial<TaskV3Error>);

    const ready = await service.updateTask(sessionA, taskId, {
      status: 'ready',
      expectedVersion: created.version,
    });
    expect(ready.status).toBe('ready');
    expect(ready.version).toBe(2);

    await expect(
      service.updateTask(sessionA, taskId, {
        title: 'stale',
        expectedVersion: 1,
      })
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    } satisfies Partial<TaskV3Error>);

    const listed = await service.listTasks(sessionA, { status: 'ready' });
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe(taskId);

    await service.deleteTask(sessionA, taskId);
    await expect(service.getTask(sessionA, taskId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    } satisfies Partial<TaskV3Error>);
  });

  it('validates dependency cycle and supports remove/list branches', async () => {
    const sessionId = 'dep';
    const t1 = await service.createTask(
      sessionId,
      { title: 'T1', description: 'd1', status: 'ready' },
      createTaskId()
    );
    const t2 = await service.createTask(
      sessionId,
      { title: 'T2', description: 'd2', status: 'ready' },
      createTaskId()
    );
    const t3 = await service.createTask(
      sessionId,
      { title: 'T3', description: 'd3', status: 'ready' },
      createTaskId()
    );

    await service.addDependency(sessionId, t1.id, t2.id);
    await service.addDependency(sessionId, t2.id, t3.id);

    const depsForT1 = await repository.listDependencies(sessionId, t1.id);
    expect(depsForT1).toHaveLength(1);
    expect(depsForT1[0].dependsOnTaskId).toBe(t2.id);

    await expect(service.addDependency(sessionId, t3.id, t1.id)).rejects.toMatchObject({
      code: 'CONFLICT',
    } satisfies Partial<TaskV3Error>);

    await service.removeDependency(sessionId, t1.id, t2.id);
    const allDeps = await repository.listDependencies(sessionId);
    expect(allDeps).toHaveLength(1);
  });

  it('runs success flow and persists run events as append-only sequence', async () => {
    const sessionId = 'run-success';
    const task = await service.createTask(
      sessionId,
      { title: 'run task', description: 'run desc', status: 'ready' },
      createTaskId()
    );

    const run = await service.startRun(
      sessionId,
      createRunId(),
      { taskId: task.id, agentType: 'general-purpose' },
      {
        execute: async (currentRun, _signal, appendEvent) => {
          await appendEvent({
            runId: currentRun.id,
            type: 'stdout',
            payload: { text: 'step-1' },
            createdAt: nowIso(),
          });
          await appendEvent({
            runId: currentRun.id,
            type: 'meta',
            payload: { source: 'test' },
            createdAt: nowIso(),
          });
          return {
            status: 'succeeded',
            output: 'done',
          };
        },
      }
    );

    const waited = await service.waitRun(sessionId, run.id, {
      timeoutMs: 5000,
      pollIntervalMs: 50,
    });
    expect(waited.status).toBe('succeeded');

    const events = await service.listRunEvents(sessionId, run.id, { limit: 20 });
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events[0].seq).toBe(1);
    expect(events[events.length - 1].seq).toBe(events.length);

    const taskAfter = await service.getTask(sessionId, task.id);
    expect(taskAfter.status).toBe('completed');
  });

  it('handles cancellation, timeout wait, and run list query branches', async () => {
    const sessionId = 'run-cancel';
    const task = await service.createTask(
      sessionId,
      { title: 'cancel task', description: 'cancel desc', status: 'ready' },
      createTaskId()
    );

    const run = await service.startRun(
      sessionId,
      createRunId(),
      { taskId: task.id, agentType: 'general-purpose', prompt: 'loop forever' },
      {
        execute: async (_run, signal) => {
          // Wait until cancelled.
          while (!signal.aborted) {
            await sleep(20);
          }
          throw new Error('aborted by signal');
        },
      }
    );

    const early = await service.waitRun(sessionId, run.id, {
      timeoutMs: 1000,
      pollIntervalMs: 100,
    });
    expect(['running', 'queued']).toContain(early.status);

    await service.cancelRun(sessionId, run.id);
    const finalRun = await service.waitRun(sessionId, run.id, {
      timeoutMs: 5000,
      pollIntervalMs: 50,
    });
    expect(finalRun.status).toBe('cancelled');

    const byTask = await service.listRuns(sessionId, { taskId: task.id, limit: 10 });
    expect(byTask.length).toBeGreaterThan(0);
    const byStatus = await service.listRuns(sessionId, { status: 'cancelled', limit: 10 });
    expect(byStatus.some((item) => item.id === run.id)).toBe(true);
  });

  it('covers repository low-level branches (terminal updates, missing events, clear/gc)', async () => {
    const sessionId = 'repo-branches';
    const otherSession = 'repo-other';

    const task = await service.createTask(
      sessionId,
      { title: 'repo task', description: 'desc', status: 'ready' },
      createTaskId()
    );
    await service.createTask(
      otherSession,
      { title: 'other task', description: 'desc', status: 'ready' },
      createTaskId()
    );

    const run = await repository.createRun({
      sessionId,
      id: createRunId(),
      now: nowIso(),
      input: {
        taskId: task.id,
        prompt: 'manual',
        agentType: 'general-purpose',
      },
    });

    const noneByStatus = await repository.listRunsByStatus([]);
    expect(noneByStatus).toEqual([]);

    const firstComplete = await repository.completeRun(sessionId, run.id, {
      status: 'failed',
      error: 'fail-once',
      now: '2000-01-01T00:00:00.000Z',
    });
    expect(firstComplete?.status).toBe('failed');

    // Terminal run should not be updated again.
    const keepTerminal = await repository.updateRunStatus(sessionId, run.id, 'running', nowIso());
    expect(keepTerminal?.status).toBe('failed');

    const completeAgain = await repository.completeRun(sessionId, run.id, {
      status: 'succeeded',
      output: 'ignored',
      now: nowIso(),
    });
    expect(completeAgain?.status).toBe('failed');

    await expect(
      repository.appendRunEvent(sessionId, {
        runId: createRunId(),
        type: 'meta',
        payload: { x: 1 },
        createdAt: nowIso(),
      })
    ).rejects.toMatchObject({
      code: 'CONFLICT',
    } satisfies Partial<TaskV3Error>);

    const gcDeleted = await repository.gcRuns({
      finishedBefore: '2020-01-01T00:00:00.000Z',
      limit: 10,
    });
    expect(gcDeleted).toBeGreaterThanOrEqual(1);

    await repository.clearSession(sessionId);
    const leftTasks = await repository.listTasks(sessionId);
    const leftRuns = await repository.listRuns(sessionId);
    expect(leftTasks).toHaveLength(0);
    expect(leftRuns).toHaveLength(0);

    const untouchedOtherSessionTasks = await repository.listTasks(otherSession);
    expect(untouchedOtherSessionTasks).toHaveLength(1);
  });

  it('recovers queued/running/cancel_requested states without in-memory truth', async () => {
    const sessionId = 'recover';
    const task = await service.createTask(
      sessionId,
      { title: 'recover task', description: 'recover desc', status: 'ready' },
      createTaskId()
    );

    const runQueued = await repository.createRun({
      sessionId,
      id: createRunId(),
      now: nowIso(),
      input: { taskId: task.id, prompt: 'queued', agentType: 'general-purpose' },
    });
    const runRunning = await repository.createRun({
      sessionId,
      id: createRunId(),
      now: nowIso(),
      input: { taskId: task.id, prompt: 'running', agentType: 'general-purpose' },
    });
    await repository.updateRunStatus(sessionId, runRunning.id, 'running', nowIso());

    const runCancelRequested = await repository.createRun({
      sessionId,
      id: createRunId(),
      now: nowIso(),
      input: { taskId: task.id, prompt: 'cancel', agentType: 'general-purpose' },
    });
    await repository.updateRunStatus(
      sessionId,
      runCancelRequested.id,
      'cancel_requested',
      nowIso()
    );

    const recoveringRunner = new SqliteTaskRunner(repository);
    await recoveringRunner.recover();

    const afterQueued = await repository.getRun(sessionId, runQueued.id);
    const afterRunning = await repository.getRun(sessionId, runRunning.id);
    const afterCancel = await repository.getRun(sessionId, runCancelRequested.id);
    expect(afterQueued?.status).toBe('failed');
    expect(afterRunning?.status).toBe('failed');
    expect(afterCancel?.status).toBe('cancelled');
  });

  it('covers runner branch cases for start/cancel/isActive paths', async () => {
    const sessionId = 'runner-branches';
    const task = await service.createTask(
      sessionId,
      { title: 'runner task', description: 'runner desc', status: 'ready' },
      createTaskId()
    );

    const missingRunId = createRunId();
    await expect(
      runner.start({
        id: missingRunId,
        sessionId,
        taskId: task.id,
        agentType: 'general-purpose',
        status: 'queued',
        inputSnapshot: '{}',
        createdAt: nowIso(),
        updatedAt: nowIso(),
      })
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    } satisfies Partial<TaskV3Error>);

    const runCancelRequested = await repository.createRun({
      sessionId,
      id: createRunId(),
      now: nowIso(),
      input: { taskId: task.id, prompt: 'cancel before start', agentType: 'general-purpose' },
    });
    await repository.updateRunStatus(
      sessionId,
      runCancelRequested.id,
      'cancel_requested',
      nowIso()
    );
    await runner.start(runCancelRequested, {
      execute: async () => ({ status: 'succeeded', output: 'ignored' }),
    });
    const afterPreCancelled = await repository.getRun(sessionId, runCancelRequested.id);
    expect(afterPreCancelled?.status).toBe('cancelled');

    const runRunning = await repository.createRun({
      sessionId,
      id: createRunId(),
      now: nowIso(),
      input: { taskId: task.id, prompt: 'already running', agentType: 'general-purpose' },
    });
    await repository.updateRunStatus(sessionId, runRunning.id, 'running', nowIso());
    await runner.start(runRunning, {
      execute: async () => ({ status: 'succeeded', output: 'ignored' }),
    });
    const stillRunning = await repository.getRun(sessionId, runRunning.id);
    expect(stillRunning?.status).toBe('running');

    const runNoAdapter = await repository.createRun({
      sessionId,
      id: createRunId(),
      now: nowIso(),
      input: { taskId: task.id, prompt: 'no adapter', agentType: 'general-purpose' },
    });
    await runner.start(runNoAdapter);
    await waitUntil(async () => {
      const latest = await repository.getRun(sessionId, runNoAdapter.id);
      return latest?.status === 'failed';
    });
    const failedNoAdapter = await repository.getRun(sessionId, runNoAdapter.id);
    expect(failedNoAdapter?.error).toContain('missing execution adapter');

    const runActive = await repository.createRun({
      sessionId,
      id: createRunId(),
      now: nowIso(),
      input: { taskId: task.id, prompt: 'active cancel', agentType: 'general-purpose' },
    });
    await runner.start(runActive, {
      execute: async (_run, signal) => {
        while (!signal.aborted) {
          await sleep(10);
        }
        // Return success after cancel_requested is set so runner uses cancel_requested branch.
        return { status: 'succeeded', output: 'ignored after cancel' };
      },
    });

    await waitUntil(async () => runner.isActive(sessionId, runActive.id));
    await waitUntil(async () => {
      const latest = await repository.getRun(sessionId, runActive.id);
      return latest?.status === 'running';
    });
    expect(await runner.isActive(sessionId, runActive.id)).toBe(true);

    const cancelResult = await runner.cancel(sessionId, runActive.id);
    expect(cancelResult?.cancelRequested).toBe(true);

    await waitUntil(async () => {
      const latest = await repository.getRun(sessionId, runActive.id);
      return latest?.status === 'cancelled';
    });
    expect(await runner.isActive(sessionId, runActive.id)).toBe(false);

    const cancelMissing = await runner.cancel(sessionId, createRunId());
    expect(cancelMissing).toBeNull();

    const runTerminal = await repository.createRun({
      sessionId,
      id: createRunId(),
      now: nowIso(),
      input: { taskId: task.id, prompt: 'terminal', agentType: 'general-purpose' },
    });
    await repository.completeRun(sessionId, runTerminal.id, {
      status: 'succeeded',
      output: 'ok',
      now: nowIso(),
    });
    const cancelTerminal = await runner.cancel(sessionId, runTerminal.id);
    expect(cancelTerminal).toEqual({ runId: runTerminal.id, cancelRequested: false });
  });
});

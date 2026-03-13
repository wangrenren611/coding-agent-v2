import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskStore } from '../task-store';
import { TaskCreateTool } from '../task-create';
import { TaskGetTool } from '../task-get';
import { TaskListTool } from '../task-list';
import { TaskUpdateTool } from '../task-update';

function parseOutput<T>(output: string | undefined): T {
  return JSON.parse(output || '{}') as T;
}

describe('task_create/task_get/task_list/task_update', () => {
  let baseDir: string;
  let store: TaskStore;
  let taskCreate: TaskCreateTool;
  let taskGet: TaskGetTool;
  let taskList: TaskListTool;
  let taskUpdate: TaskUpdateTool;

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-task-tools-'));
    store = new TaskStore({ baseDir });
    taskCreate = new TaskCreateTool({ store });
    taskGet = new TaskGetTool({ store });
    taskList = new TaskListTool({ store });
    taskUpdate = new TaskUpdateTool({ store });
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('creates a task and returns full task payload', async () => {
    const result = await taskCreate.execute({
      namespace: 'ns1',
      subject: 'Implement feature X',
      description: 'Implement feature X with tests and docs.',
      priority: 'high',
      metadata: { module: 'auth' },
    });

    expect(result.success).toBe(true);
    const payload = parseOutput<{
      namespace: string;
      task: { id: string; status: string; version: number };
    }>(result.output);
    expect(payload.namespace).toBe('ns1');
    expect(payload.task.id).toContain('task_');
    expect(payload.task.status).toBe('pending');
    expect(payload.task.version).toBe(1);
  });

  it('rejects duplicate active subject', async () => {
    await taskCreate.execute({
      namespace: 'ns2',
      subject: 'Same subject',
      description: 'first task with same subject for duplicate detection',
    });

    const duplicate = await taskCreate.execute({
      namespace: 'ns2',
      subject: 'Same subject',
      description: 'second task with same subject for duplicate detection',
    });

    expect(duplicate.success).toBe(false);
    expect(duplicate.output).toContain('TASK_DUPLICATE_SUBJECT');
  });

  it('computes can_start and blocker summaries in task_get', async () => {
    const taskA = parseOutput<{ task: { id: string } }>(
      (
        await taskCreate.execute({
          namespace: 'ns3',
          subject: 'Prepare architecture',
          description: 'Prepare architecture and contracts for implementation.',
        })
      ).output
    ).task;

    const taskB = parseOutput<{ task: { id: string } }>(
      (
        await taskCreate.execute({
          namespace: 'ns3',
          subject: 'Implement API',
          description: 'Implement API based on architecture and contracts.',
        })
      ).output
    ).task;

    const addDependency = await taskUpdate.execute({
      namespace: 'ns3',
      task_id: taskB.id,
      add_blocked_by: [taskA.id],
    });
    expect(addDependency.success).toBe(true);

    const detail = await taskGet.execute({
      namespace: 'ns3',
      task_id: taskB.id,
    });
    expect(detail.success).toBe(true);

    const payload = parseOutput<{
      task: {
        can_start: { canStart: boolean; reason?: string };
        blockers: Array<{ id: string }>;
      };
    }>(detail.output);

    expect(payload.task.can_start.canStart).toBe(false);
    expect(payload.task.can_start.reason).toContain(taskA.id);
    expect(payload.task.blockers.map((item) => item.id)).toContain(taskA.id);
  });

  it('detects cycle dependency on update', async () => {
    const taskA = parseOutput<{ task: { id: string } }>(
      (
        await taskCreate.execute({
          namespace: 'ns4',
          subject: 'Task A',
          description: 'Task A detail with enough description text.',
        })
      ).output
    ).task;
    const taskB = parseOutput<{ task: { id: string } }>(
      (
        await taskCreate.execute({
          namespace: 'ns4',
          subject: 'Task B',
          description: 'Task B detail with enough description text.',
        })
      ).output
    ).task;

    expect(
      (
        await taskUpdate.execute({
          namespace: 'ns4',
          task_id: taskB.id,
          add_blocked_by: [taskA.id],
        })
      ).success
    ).toBe(true);

    const cycle = await taskUpdate.execute({
      namespace: 'ns4',
      task_id: taskA.id,
      add_blocked_by: [taskB.id],
    });

    expect(cycle.success).toBe(false);
    expect(cycle.output).toContain('TASK_CYCLE_DEPENDENCY');
  });

  it('supports owner=null and records status transition history accurately', async () => {
    const created = parseOutput<{ task: { id: string } }>(
      (
        await taskCreate.execute({
          namespace: 'ns5',
          subject: 'Run migration',
          description: 'Run migration with rollback plan and checklist.',
        })
      ).output
    ).task;

    const update1 = await taskUpdate.execute({
      namespace: 'ns5',
      task_id: created.id,
      status: 'in_progress',
      owner: 'main-agent',
      updated_by: 'tester',
    });
    expect(update1.success).toBe(true);

    const release = await taskUpdate.execute({
      namespace: 'ns5',
      task_id: created.id,
      owner: null,
      updated_by: 'tester',
    });
    expect(release.success).toBe(true);

    const complete = await taskUpdate.execute({
      namespace: 'ns5',
      task_id: created.id,
      status: 'completed',
      updated_by: 'tester',
    });
    expect(complete.success).toBe(true);

    const detail = await taskGet.execute({
      namespace: 'ns5',
      task_id: created.id,
      include_history: true,
    });
    const payload = parseOutput<{
      task: {
        owner: string | null;
        history: Array<{ action: string; fromStatus?: string; toStatus?: string }>;
      };
    }>(detail.output);
    expect(payload.task.owner).toBeNull();

    const statusEntries = payload.task.history.filter((entry) => entry.action === 'status_changed');
    expect(statusEntries.length).toBe(2);
    expect(statusEntries[0]).toMatchObject({
      fromStatus: 'pending',
      toStatus: 'in_progress',
    });
    expect(statusEntries[1]).toMatchObject({
      fromStatus: 'in_progress',
      toStatus: 'completed',
    });
  });

  it('sorts list with critical claimable before in_progress and others', async () => {
    const critical = parseOutput<{ task: { id: string } }>(
      (
        await taskCreate.execute({
          namespace: 'ns6',
          subject: 'Emergency fix',
          description: 'Emergency fix in production with immediate response.',
          priority: 'critical',
        })
      ).output
    ).task;

    const normal = parseOutput<{ task: { id: string } }>(
      (
        await taskCreate.execute({
          namespace: 'ns6',
          subject: 'Regular task',
          description: 'Regular task for planned sprint implementation.',
          priority: 'normal',
        })
      ).output
    ).task;

    const inProgress = parseOutput<{ task: { id: string } }>(
      (
        await taskCreate.execute({
          namespace: 'ns6',
          subject: 'In-progress task',
          description: 'Task that will be moved to in progress.',
          priority: 'high',
        })
      ).output
    ).task;

    await taskUpdate.execute({
      namespace: 'ns6',
      task_id: inProgress.id,
      status: 'in_progress',
      owner: 'agent-1',
    });

    const listed = await taskList.execute({ namespace: 'ns6' });
    expect(listed.success).toBe(true);
    const payload = parseOutput<{ tasks: Array<{ id: string }> }>(listed.output);
    expect(payload.tasks[0].id).toBe(critical.id);
    expect(payload.tasks.map((item) => item.id)).toContain(normal.id);
  });
});

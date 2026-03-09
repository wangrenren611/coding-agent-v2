import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskStore } from '../task-store';
import { TaskCreateTool } from '../task-create';
import { TaskUpdateTool } from '../task-update';
import { TaskGetTool } from '../task-get';

function parseOutput<T>(output: string | undefined): T {
  return JSON.parse(output || '{}') as T;
}

describe('task_update versioning and dependency integrity', () => {
  let baseDir: string;
  let store: TaskStore;
  let taskCreate: TaskCreateTool;
  let taskUpdate: TaskUpdateTool;
  let taskGet: TaskGetTool;

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-v4-task-version-'));
    store = new TaskStore({ baseDir });
    taskCreate = new TaskCreateTool({ store });
    taskUpdate = new TaskUpdateTool({ store });
    taskGet = new TaskGetTool({ store });
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('rejects stale expected_version and accepts correct one', async () => {
    const task = parseOutput<{ task: { id: string; version: number } }>(
      (
        await taskCreate.execute({
          namespace: 'ver1',
          subject: 'Versioned task',
          description: 'Versioned task for optimistic lock verification.',
        })
      ).output
    ).task;

    const stale = await taskUpdate.execute({
      namespace: 'ver1',
      task_id: task.id,
      subject: 'Versioned task updated once',
      expected_version: task.version + 1,
    });
    expect(stale.success).toBe(false);
    expect(stale.output).toContain('TASK_VERSION_CONFLICT');

    const ok = await taskUpdate.execute({
      namespace: 'ver1',
      task_id: task.id,
      subject: 'Versioned task updated once',
      expected_version: task.version,
    });
    expect(ok.success).toBe(true);
    const okPayload = parseOutput<{ task: { version: number } }>(ok.output);
    expect(okPayload.task.version).toBe(task.version + 1);
  });

  it('supports adding and removing dependencies and keeps graph symmetric', async () => {
    const a = parseOutput<{ task: { id: string } }>(
      (
        await taskCreate.execute({
          namespace: 'ver2',
          subject: 'Task A',
          description: 'Task A detail for dependency symmetry test.',
        })
      ).output
    ).task;
    const b = parseOutput<{ task: { id: string } }>(
      (
        await taskCreate.execute({
          namespace: 'ver2',
          subject: 'Task B',
          description: 'Task B detail for dependency symmetry test.',
        })
      ).output
    ).task;

    const added = await taskUpdate.execute({
      namespace: 'ver2',
      task_id: b.id,
      add_blocked_by: [a.id],
    });
    expect(added.success).toBe(true);

    const afterAddA = parseOutput<{ task: { blocks: string[] } }>(
      (await taskGet.execute({ namespace: 'ver2', task_id: a.id })).output
    );
    const afterAddB = parseOutput<{ task: { blockedBy: string[] } }>(
      (await taskGet.execute({ namespace: 'ver2', task_id: b.id })).output
    );
    expect(afterAddA.task.blocks).toContain(b.id);
    expect(afterAddB.task.blockedBy).toContain(a.id);

    const removed = await taskUpdate.execute({
      namespace: 'ver2',
      task_id: b.id,
      remove_blocked_by: [a.id],
    });
    expect(removed.success).toBe(true);

    const afterRemoveA = parseOutput<{ task: { blocks: string[] } }>(
      (await taskGet.execute({ namespace: 'ver2', task_id: a.id })).output
    );
    const afterRemoveB = parseOutput<{ task: { blockedBy: string[] } }>(
      (await taskGet.execute({ namespace: 'ver2', task_id: b.id })).output
    );
    expect(afterRemoveA.task.blocks).not.toContain(b.id);
    expect(afterRemoveB.task.blockedBy).not.toContain(a.id);
  });
});

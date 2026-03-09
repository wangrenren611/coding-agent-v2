import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskStore } from '../task-store';
import { InProcessMockRunnerAdapter } from '../task-runner-adapter';
import { TaskCreateTool } from '../task-create';
import { TaskTool } from '../task';
import { TaskOutputTool } from '../task-output';
import { TaskStopTool } from '../task-stop';
import { TaskGetTool } from '../task-get';
import { PARENT_ABORT_REASON } from '../task-parent-abort';
import type { AgentRunEntity } from '../task-types';
import type { SubagentRunnerAdapter } from '../task-runner-adapter';

function parseOutput<T>(output: string | undefined): T {
  return JSON.parse(output || '{}') as T;
}

async function waitUntil(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 1500,
  intervalMs = 20
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for condition');
}

function makeRunningRun(agentId: string, prompt = 'x'): AgentRunEntity {
  const now = Date.now();
  return {
    agentId,
    status: 'running',
    subagentType: 'Plan',
    prompt,
    createdAt: now,
    startedAt: now,
    updatedAt: now,
    metadata: {},
    version: 1,
  };
}

describe('task/task_output/task_stop lifecycle', () => {
  let baseDir: string;
  let store: TaskStore;
  let runner: InProcessMockRunnerAdapter;
  let taskCreate: TaskCreateTool;
  let taskTool: TaskTool;
  let taskOutput: TaskOutputTool;
  let taskStop: TaskStopTool;
  let taskGet: TaskGetTool;

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-v4-task-run-'));
    store = new TaskStore({ baseDir });
    runner = new InProcessMockRunnerAdapter(store, { completionDelayMs: 80 });
    taskCreate = new TaskCreateTool({ store });
    taskTool = new TaskTool({ store, runner });
    taskOutput = new TaskOutputTool({ store, runner });
    taskStop = new TaskStopTool({ store, runner });
    taskGet = new TaskGetTool({ store });
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('runs foreground task and links completion to planning task', async () => {
    const created = parseOutput<{ task: { id: string } }>(
      (
        await taskCreate.execute({
          namespace: 'run1',
          subject: 'Design auth schema',
          description: 'Design auth schema with entities and indexes.',
        })
      ).output
    ).task;

    const execution = await taskTool.execute({
      namespace: 'run1',
      subagent_type: 'Plan',
      prompt: 'Create a design for auth schema.',
      linked_task_id: created.id,
      run_in_background: false,
    });
    expect(execution.success).toBe(true);
    const runPayload = parseOutput<{ agent_run: { status: string; agentId: string } }>(
      execution.output
    );
    expect(runPayload.agent_run.status).toBe('completed');

    const detail = await taskGet.execute({
      namespace: 'run1',
      task_id: created.id,
    });
    const detailPayload = parseOutput<{ task: { status: string; agentId?: string } }>(
      detail.output
    );
    expect(detailPayload.task.status).toBe('completed');
    expect(detailPayload.task.agentId).toBe(runPayload.agent_run.agentId);
  });

  it('runs background task and output can observe completion', async () => {
    const execution = await taskTool.execute({
      namespace: 'run2',
      subagent_type: 'general-purpose',
      prompt: 'Background run example',
      run_in_background: true,
    });
    expect(execution.success).toBe(true);

    const payload = parseOutput<{ agent_run: { agentId: string; status: string } }>(
      execution.output
    );
    expect(payload.agent_run.status).toBe('running');

    const output = await taskOutput.execute({
      namespace: 'run2',
      agent_id: payload.agent_run.agentId,
      timeout_ms: 5000,
    });
    expect(output.success).toBe(true);
    const outPayload = parseOutput<{ agent_run: { status: string }; completed: boolean }>(
      output.output
    );
    expect(outPayload.agent_run.status).toBe('completed');
    expect(outPayload.completed).toBe(true);
  });

  it('stops a running background task and cancels linked task', async () => {
    const linked = parseOutput<{ task: { id: string } }>(
      (
        await taskCreate.execute({
          namespace: 'run3',
          subject: 'Long running task',
          description: 'Long running task that will be cancelled by stop.',
        })
      ).output
    ).task;

    const execution = await taskTool.execute({
      namespace: 'run3',
      subagent_type: 'general-purpose',
      prompt: 'Background run to cancel',
      run_in_background: true,
      linked_task_id: linked.id,
    });
    const runPayload = parseOutput<{ agent_run: { agentId: string } }>(execution.output);

    const stopped = await taskStop.execute({
      namespace: 'run3',
      agent_id: runPayload.agent_run.agentId,
      reason: 'User cancelled',
      cancel_linked_task: true,
    });
    expect(stopped.success).toBe(true);
    const stopPayload = parseOutput<{
      agent_run: { status: string };
      cancelled_task_ids: string[];
    }>(stopped.output);
    expect(stopPayload.agent_run.status).toBe('cancelled');
    expect(stopPayload.cancelled_task_ids).toContain(linked.id);

    const detail = await taskGet.execute({
      namespace: 'run3',
      task_id: linked.id,
    });
    const detailPayload = parseOutput<{ task: { status: string } }>(detail.output);
    expect(detailPayload.task.status).toBe('cancelled');
  });

  it('maps [TASK_FAIL] token to failed run and failed linked task', async () => {
    const linked = parseOutput<{ task: { id: string } }>(
      (
        await taskCreate.execute({
          namespace: 'run4',
          subject: 'Failing task',
          description: 'Task expected to fail in execution stage.',
        })
      ).output
    ).task;

    const execution = await taskTool.execute({
      namespace: 'run4',
      subagent_type: 'general-purpose',
      prompt: 'Trigger [TASK_FAIL] for test',
      linked_task_id: linked.id,
      run_in_background: false,
    });
    expect(execution.success).toBe(true);
    const runPayload = parseOutput<{ agent_run: { status: string } }>(execution.output);
    expect(runPayload.agent_run.status).toBe('failed');

    const detail = await taskGet.execute({
      namespace: 'run4',
      task_id: linked.id,
    });
    const detailPayload = parseOutput<{ task: { status: string } }>(detail.output);
    expect(detailPayload.task.status).toBe('failed');
  });

  it('cascades parent abort to subagent cancel and linked task cancel', async () => {
    const linked = parseOutput<{ task: { id: string } }>(
      (
        await taskCreate.execute({
          namespace: 'run5',
          subject: 'Cascade cancel task',
          description: 'Linked task should cancel when parent aborts tool execution.',
        })
      ).output
    ).task;

    const controller = new AbortController();
    const chunks: Array<{ type: string; content?: string }> = [];
    const execution = await taskTool.execute(
      {
        namespace: 'run5',
        subagent_type: 'Plan',
        prompt: 'Run that should be cancelled via parent abort',
        run_in_background: true,
        linked_task_id: linked.id,
      },
      {
        toolCallId: 'parent-abort-cascade',
        loopIndex: 1,
        agent: {},
        toolAbortSignal: controller.signal,
        onChunk: async (event) => {
          chunks.push({ type: event.type, content: String(event.content || '') });
        },
      }
    );

    const agentId = parseOutput<{ agent_run: { agentId: string } }>(execution.output).agent_run
      .agentId;
    controller.abort();

    await waitUntil(async () => {
      const state = await store.getState('run5');
      return state.agentRuns[agentId]?.status === 'cancelled';
    });

    const state = await store.getState('run5');
    expect(state.agentRuns[agentId]?.status).toBe('cancelled');
    expect(state.agentRuns[agentId]?.error).toBe(PARENT_ABORT_REASON);

    const detail = await taskGet.execute({
      namespace: 'run5',
      task_id: linked.id,
      include_history: true,
    });
    const taskPayload = parseOutput<{
      task: { status: string; history: Array<{ actor?: string; reason?: string }> };
    }>(detail.output);
    expect(taskPayload.task.status).toBe('cancelled');
    expect(taskPayload.task.history.some((item) => item.actor === 'task-parent-abort')).toBe(true);
    expect(
      taskPayload.task.history.some(
        (item) => item.actor === 'task-parent-abort' && item.reason === PARENT_ABORT_REASON
      )
    ).toBe(true);
    expect(
      chunks.some(
        (event) =>
          event.type === 'info' && event.content?.includes('subagent cancelled by parent abort')
      )
    ).toBe(true);
  });

  it('handles already-aborted parent signal and emits stderr chunk when cascade cancel fails', async () => {
    const runner: SubagentRunnerAdapter = {
      start: async () => makeRunningRun('agent-parent-fail'),
      poll: async () => null,
      cancel: async () => {
        throw new Error('boom');
      },
    };
    const taskWithFailingCancel = new TaskTool({ store, runner });

    const controller = new AbortController();
    controller.abort();
    const chunks: Array<{ type: string; content?: string }> = [];

    await taskWithFailingCancel.execute(
      {
        namespace: 'run6',
        subagent_type: 'Plan',
        prompt: 'Parent already aborted before execute',
        run_in_background: true,
      },
      {
        toolCallId: 'already-aborted-parent',
        loopIndex: 2,
        agent: {},
        toolAbortSignal: controller.signal,
        onChunk: async (event) => {
          chunks.push({ type: event.type, content: String(event.content || '') });
        },
      }
    );

    await waitUntil(() =>
      chunks.some(
        (event) =>
          event.type === 'stderr' && event.content?.includes('failed to cascade parent abort: boom')
      )
    );
  });
});

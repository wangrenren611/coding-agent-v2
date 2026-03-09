import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskStore } from '../task-store';
import { InProcessMockRunnerAdapter } from '../task-runner-adapter';
import { TaskTool } from '../task';
import { TaskOutputTool } from '../task-output';
import type { AgentRunEntity } from '../task-types';
import type { SubagentRunnerAdapter } from '../task-runner-adapter';

function parseOutput<T>(output: string | undefined): T {
  return JSON.parse(output || '{}') as T;
}

function makeRun(overrides: Partial<AgentRunEntity> = {}): AgentRunEntity {
  const now = Date.now();
  return {
    agentId: overrides.agentId || 'agent-x',
    status: overrides.status || 'running',
    subagentType: overrides.subagentType || 'Plan',
    prompt: overrides.prompt || 'p',
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

describe('task_output blocking semantics', () => {
  let baseDir: string;
  let store: TaskStore;
  let runner: InProcessMockRunnerAdapter;
  let taskTool: TaskTool;
  let taskOutput: TaskOutputTool;

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-v4-task-output-'));
    store = new TaskStore({ baseDir });
    runner = new InProcessMockRunnerAdapter(store, { completionDelayMs: 200 });
    taskTool = new TaskTool({ store, runner });
    taskOutput = new TaskOutputTool({ store, runner });
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('uses block=true by default when block is omitted', async () => {
    const started = await taskTool.execute({
      namespace: 'out1',
      subagent_type: 'general-purpose',
      prompt: 'Default blocking behavior check',
      run_in_background: true,
    });
    const run = parseOutput<{ agent_run: { agentId: string } }>(started.output).agent_run;

    const t0 = Date.now();
    const result = await taskOutput.execute({
      namespace: 'out1',
      agent_id: run.agentId,
      timeout_ms: 3000,
    });
    const elapsed = Date.now() - t0;

    expect(result.success).toBe(true);
    const payload = parseOutput<{ completed: boolean; agent_run: { status: string } }>(
      result.output
    );
    expect(payload.completed).toBe(true);
    expect(payload.agent_run.status).toBe('completed');
    expect(elapsed).toBeGreaterThanOrEqual(120);
  });

  it('returns quickly in non-blocking mode and can report running state', async () => {
    const started = await taskTool.execute({
      namespace: 'out2',
      subagent_type: 'general-purpose',
      prompt: 'Non-blocking behavior check',
      run_in_background: true,
    });
    const run = parseOutput<{ agent_run: { agentId: string } }>(started.output).agent_run;

    const t0 = Date.now();
    const result = await taskOutput.execute({
      namespace: 'out2',
      agent_id: run.agentId,
      block: false,
    });
    const elapsed = Date.now() - t0;

    expect(result.success).toBe(true);
    const payload = parseOutput<{ agent_run: { status: string; output?: string } }>(result.output);
    expect(['running', 'completed']).toContain(payload.agent_run.status);
    if (payload.agent_run.status === 'running') {
      expect(payload.agent_run.output).toBeUndefined();
    }
    expect(elapsed).toBeLessThan(120);
  });

  it('hides output for in-progress run but keeps completion output', async () => {
    const partialRunner: SubagentRunnerAdapter = {
      start: async () => makeRun(),
      poll: async (_namespace, agentId) => {
        if (agentId === 'agent-running') {
          return makeRun({
            agentId,
            status: 'running',
            output: 'partial content',
          });
        }
        return makeRun({
          agentId,
          status: 'completed',
          output: 'final content',
          endedAt: Date.now(),
        });
      },
      cancel: async () => null,
    };

    const outputTool = new TaskOutputTool({ store, runner: partialRunner });

    const running = await outputTool.execute({
      namespace: 'out3',
      agent_id: 'agent-running',
      block: false,
    });
    const runningPayload = parseOutput<{ agent_run: { status: string; output?: string } }>(
      running.output
    );
    expect(runningPayload.agent_run.status).toBe('running');
    expect(runningPayload.agent_run.output).toBeUndefined();

    const completed = await outputTool.execute({
      namespace: 'out3',
      agent_id: 'agent-completed',
      block: false,
    });
    const completedPayload = parseOutput<{ agent_run: { status: string; output?: string } }>(
      completed.output
    );
    expect(completedPayload.agent_run.status).toBe('completed');
    expect(completedPayload.agent_run.output).toBe('final content');
  });

  it('reports failure to parent agent and never leaks failed output', async () => {
    const failedRunner: SubagentRunnerAdapter = {
      start: async () => makeRun(),
      poll: async () =>
        makeRun({
          agentId: 'agent-failed',
          status: 'failed',
          output: 'internal stack trace',
          error: 'compile failed',
          endedAt: Date.now(),
        }),
      cancel: async () => null,
    };
    const outputTool = new TaskOutputTool({ store, runner: failedRunner });
    const failed = await outputTool.execute({
      namespace: 'out4',
      agent_id: 'agent-failed',
    });

    expect(failed.success).toBe(true);
    const payload = parseOutput<{
      completed: boolean;
      agent_run: { status: string; output?: string; error?: string };
    }>(failed.output);
    expect(payload.completed).toBe(true);
    expect(payload.agent_run.status).toBe('failed');
    expect(payload.agent_run.output).toBeUndefined();
    expect(payload.agent_run.error).toBe('compile failed');
  });

  it('fills default error text for terminal failed/timed_out/cancelled without error', async () => {
    const statuses: Array<'failed' | 'timed_out' | 'cancelled'> = [
      'failed',
      'timed_out',
      'cancelled',
    ];

    for (const status of statuses) {
      const runnerWithoutError: SubagentRunnerAdapter = {
        start: async () => makeRun(),
        poll: async () =>
          makeRun({
            agentId: `agent-${status}`,
            status,
            output: 'must hide',
            error: undefined,
            endedAt: Date.now(),
          }),
        cancel: async () => null,
      };

      const outputTool = new TaskOutputTool({ store, runner: runnerWithoutError });
      const result = await outputTool.execute({
        namespace: 'out5',
        agent_id: `agent-${status}`,
      });

      const payload = parseOutput<{
        agent_run: { status: string; output?: string; error?: string };
      }>(result.output);
      expect(payload.agent_run.status).toBe(status);
      expect(payload.agent_run.output).toBeUndefined();
      expect(payload.agent_run.error).toBe(`Agent run ${status}`);
    }
  });
});

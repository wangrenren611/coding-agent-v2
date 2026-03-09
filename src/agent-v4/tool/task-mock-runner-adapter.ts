import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { ToolExecutionContext } from './types';
import { TaskStore } from './task-store';
import {
  createAgentId,
  isAgentRunTerminal,
  safeJsonClone,
  type AgentRunEntity,
} from './task-types';
import type { StartAgentInput, SubagentRunnerAdapter } from './task-runner-adapter';

export interface InProcessMockRunnerAdapterOptions {
  completionDelayMs?: number;
  now?: () => number;
}

function createMockOutput(run: AgentRunEntity): string {
  const preview = run.prompt.trim().slice(0, 120);
  if (!preview) {
    return `Subagent ${run.agentId} completed`;
  }
  return `Subagent ${run.agentId} completed: ${preview}`;
}

export class InProcessMockRunnerAdapter implements SubagentRunnerAdapter {
  private readonly completionDelayMs: number;
  private readonly now: () => number;
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly store: TaskStore,
    options: InProcessMockRunnerAdapterOptions = {}
  ) {
    this.completionDelayMs =
      typeof options.completionDelayMs === 'number' && options.completionDelayMs > 0
        ? options.completionDelayMs
        : 30;
    this.now = options.now || Date.now;
  }

  async start(
    namespace: string,
    input: StartAgentInput,
    context?: ToolExecutionContext
  ): Promise<AgentRunEntity> {
    if (input.resume) {
      const resumed = await this.resumeRun(namespace, input.resume);
      if (!resumed) {
        throw new Error(`AGENT_RUN_NOT_FOUND: ${input.resume}`);
      }
      return resumed;
    }

    const createdAt = this.now();
    const agentId = createAgentId();
    const outputFile = this.buildOutputFilePath(namespace, agentId);
    const run: AgentRunEntity = {
      agentId,
      status: 'running',
      subagentType: input.subagentType,
      prompt: input.prompt,
      description: input.description,
      model: input.model,
      maxTurns: input.maxTurns,
      allowedTools: input.allowedTools,
      linkedTaskId: input.linkedTaskId,
      createdAt,
      startedAt: createdAt,
      updatedAt: createdAt,
      progress: input.runInBackground ? 0 : 100,
      outputFile: input.runInBackground ? outputFile : undefined,
      metadata: {
        ...(input.metadata || {}),
        ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
      },
      version: 1,
    };

    await this.store.updateState(namespace, (state) => {
      state.agentRuns[run.agentId] = safeJsonClone(run);
      return null;
    });

    await context?.onChunk?.({
      type: 'info',
      content: `subagent started: ${run.agentId}`,
      data: `subagent started: ${run.agentId}`,
    });

    if (input.runInBackground) {
      this.scheduleCompletion(namespace, run.agentId);
      return run;
    }

    const completed = await this.completeRun(namespace, run.agentId);
    return completed || run;
  }

  async poll(namespace: string, agentId: string): Promise<AgentRunEntity | null> {
    const state = await this.store.getState(namespace);
    return safeJsonClone(state.agentRuns[agentId] || null);
  }

  async cancel(
    namespace: string,
    agentId: string,
    reason?: string
  ): Promise<AgentRunEntity | null> {
    const timerKey = this.timerKey(namespace, agentId);
    const timer = this.timers.get(timerKey);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(timerKey);
    }

    const result = await this.store.updateState(namespace, (state) => {
      const run = state.agentRuns[agentId];
      if (!run) {
        return null;
      }
      if (isAgentRunTerminal(run.status)) {
        return safeJsonClone(run);
      }
      run.status = 'cancelled';
      run.error = reason || 'Cancelled by task_stop';
      run.progress = run.progress || 0;
      run.endedAt = this.now();
      run.updatedAt = this.now();
      run.version += 1;
      return safeJsonClone(run);
    });
    return result.result;
  }

  private async resumeRun(namespace: string, resumeId: string): Promise<AgentRunEntity | null> {
    const result = await this.store.updateState(namespace, (state) => {
      const run = state.agentRuns[resumeId];
      if (!run) {
        return null;
      }
      if (isAgentRunTerminal(run.status) || run.status === 'running') {
        return safeJsonClone(run);
      }
      run.status = 'running';
      run.updatedAt = this.now();
      run.version += 1;
      return safeJsonClone(run);
    });
    const resumed = result.result;
    if (resumed && resumed.status === 'running') {
      this.scheduleCompletion(namespace, resumed.agentId);
    }
    return resumed;
  }

  private scheduleCompletion(namespace: string, agentId: string): void {
    const timerKey = this.timerKey(namespace, agentId);
    const existing = this.timers.get(timerKey);
    if (existing) {
      clearTimeout(existing);
    }
    const timer = setTimeout(() => {
      void this.completeRun(namespace, agentId);
    }, this.completionDelayMs);
    this.timers.set(timerKey, timer);
  }

  private async completeRun(namespace: string, agentId: string): Promise<AgentRunEntity | null> {
    const timerKey = this.timerKey(namespace, agentId);
    const timer = this.timers.get(timerKey);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(timerKey);
    }

    const result = await this.store.updateState(namespace, (state) => {
      const run = state.agentRuns[agentId];
      if (!run) {
        return null;
      }
      if (isAgentRunTerminal(run.status)) {
        return safeJsonClone(run);
      }

      const prompt = run.prompt.toLowerCase();
      if (prompt.includes('[task_fail]')) {
        run.status = 'failed';
        run.error = 'Subagent mock failure requested by prompt token [TASK_FAIL]';
      } else if (prompt.includes('[task_pause]')) {
        run.status = 'paused';
      } else if (prompt.includes('[task_timeout]')) {
        run.status = 'timed_out';
        run.error = 'Subagent mock timeout requested by prompt token [TASK_TIMEOUT]';
      } else {
        run.status = 'completed';
        run.output = createMockOutput(run);
      }

      run.progress = run.status === 'completed' ? 100 : run.progress || 0;
      run.endedAt = this.now();
      run.updatedAt = this.now();
      run.version += 1;

      return safeJsonClone(run);
    });

    const completed = result.result;
    if (completed?.outputFile) {
      await this.persistOutputFile(completed.outputFile, completed);
    }
    return completed;
  }

  private async persistOutputFile(outputFile: string, run: AgentRunEntity): Promise<void> {
    try {
      await fs.mkdir(path.dirname(outputFile), { recursive: true });
      const content = run.output || run.error || run.status;
      await fs.writeFile(outputFile, content, 'utf8');
    } catch {
      // Persisting debug output must never block tool response.
    }
  }

  private buildOutputFilePath(namespace: string, agentId: string): string {
    return path.join(this.store.baseDir, 'logs', namespace, `${agentId}.log`);
  }

  private timerKey(namespace: string, agentId: string): string {
    return `${namespace}::${agentId}`;
  }
}

import path from 'path';
import type { ToolExecutionContext } from '../types';
import type { ActiveExecution, ManagedTask, SubTaskRunRecord } from './types';
import { extractToolsUsed, nowIso, pickLastToolName } from './utils';
import { TaskStore, type TaskStoreOptions } from './store';

const DEFAULT_CLEANUP_TTL_MS = 60_000;

export interface TaskRuntimeOptions extends TaskStoreOptions {
  cleanupTtlMs?: number;
  store?: TaskStore;
}

export class TaskRuntime {
  private readonly store: TaskStore;
  private readonly cleanupTtlMs: number;
  private readonly activeExecutions = new Map<string, ActiveExecution>();

  constructor(options: TaskRuntimeOptions = {}) {
    this.store = options.store ?? new TaskStore(options);
    this.cleanupTtlMs = options.cleanupTtlMs ?? DEFAULT_CLEANUP_TTL_MS;
  }

  getDataDir(): string {
    return this.store.getDataDir();
  }

  resolveSessionId(context: ToolExecutionContext): string {
    const fromAgentContext = context.agentContext?.sessionId;
    if (typeof fromAgentContext === 'string' && fromAgentContext.trim().length > 0) {
      return fromAgentContext.trim();
    }

    const fromAgent = context.agent.getSessionId();
    if (typeof fromAgent === 'string' && fromAgent.trim().length > 0) {
      return fromAgent.trim();
    }

    return 'default-session';
  }

  async listManagedTasks(sessionId: string): Promise<ManagedTask[]> {
    return this.store.listManagedTasks(sessionId);
  }

  async saveManagedTask(sessionId: string, task: ManagedTask): Promise<void> {
    await this.store.upsertManagedTask(sessionId, task);
  }

  async deleteManagedTask(sessionId: string, taskId: string): Promise<void> {
    await this.store.deleteManagedTask(sessionId, taskId);
  }

  async saveRun(sessionId: string, run: SubTaskRunRecord): Promise<void> {
    await this.store.upsertSubTaskRun(sessionId, run);
  }

  async getRun(sessionId: string, runId: string): Promise<SubTaskRunRecord | null> {
    return this.store.getSubTaskRun(sessionId, runId);
  }

  async listRuns(
    sessionId: string,
    options?: {
      mode?: SubTaskRunRecord['mode'];
      limit?: number;
      orderBy?: 'updatedAt' | 'createdAt';
      orderDirection?: 'asc' | 'desc';
    }
  ): Promise<SubTaskRunRecord[]> {
    return this.store.listSubTaskRuns(sessionId, options);
  }

  registerActiveExecution(execution: ActiveExecution): void {
    this.clearExecutionCleanup(execution.run.runId);
    this.activeExecutions.set(execution.run.runId, execution);
  }

  getActiveExecution(runId: string): ActiveExecution | undefined {
    return this.activeExecutions.get(runId);
  }

  async refreshActiveExecution(runId: string): Promise<SubTaskRunRecord | null> {
    const execution = this.activeExecutions.get(runId);
    if (!execution) {
      return null;
    }

    const messages = execution.agent.getMessages();
    const toolsUsed = extractToolsUsed(messages);
    const lastToolName = pickLastToolName(messages);
    const turns = execution.agent.getState().loopIndex;
    const messageCount = messages.length;

    execution.run.turns = turns;
    execution.run.toolsUsed = toolsUsed;
    execution.run.lastToolName = lastToolName;
    execution.run.messageCount = messageCount;
    execution.run.lastActivityAt = nowIso();
    execution.run.updatedAt = execution.run.lastActivityAt;

    await this.saveRun(execution.run.parentSessionId, execution.run);
    return execution.run;
  }

  removeActiveExecution(runId: string): void {
    const execution = this.activeExecutions.get(runId);
    if (!execution) {
      return;
    }
    this.clearExecutionCleanup(runId);
    this.activeExecutions.delete(runId);
  }

  scheduleExecutionCleanup(runId: string, ttlMs = this.cleanupTtlMs): void {
    const execution = this.activeExecutions.get(runId);
    if (!execution) {
      return;
    }

    this.clearExecutionCleanup(runId);
    execution.cleanupTimer = setTimeout(() => {
      this.removeActiveExecution(runId);
    }, ttlMs);
  }

  clearExecutionCleanup(runId: string): void {
    const execution = this.activeExecutions.get(runId);
    if (!execution?.cleanupTimer) {
      return;
    }
    clearTimeout(execution.cleanupTimer);
    execution.cleanupTimer = undefined;
  }

  async clearState(sessionId?: string): Promise<void> {
    const executions = Array.from(this.activeExecutions.values());
    for (const execution of executions) {
      if (sessionId && execution.run.parentSessionId !== sessionId) {
        continue;
      }
      execution.stopRequested = true;
      execution.agent.abort();
      this.removeActiveExecution(execution.run.runId);
    }

    if (sessionId) {
      await this.store.clearSession(sessionId);
      return;
    }
  }
}

const defaultRuntimeRegistry = new Map<string, TaskRuntime>();

export function getDefaultTaskRuntime(options: TaskRuntimeOptions = {}): TaskRuntime {
  const dataDir = options.dataDir ?? path.join(process.cwd(), 'data', 'task-tool');
  const key = path.resolve(dataDir);
  const existing = defaultRuntimeRegistry.get(key);
  if (existing) {
    return existing;
  }

  const runtime = new TaskRuntime({ ...options, dataDir: key });
  defaultRuntimeRegistry.set(key, runtime);
  return runtime;
}

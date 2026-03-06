import { conflict, invalidArgument, invalidTransition, notFound } from './errors';
import type { RunExecutionAdapter, TaskRunner } from './runtime/runner';
import type { TaskRepository } from './storage/repository';
import type {
  CreateTaskInput,
  Run,
  RunId,
  RunStatus,
  StartRunInput,
  Task,
  TaskDependency,
  TaskId,
  TaskStatus,
  UpdateTaskInput,
} from './types';

function defaultNow(): string {
  return new Date().toISOString();
}

const TERMINAL_RUN_STATUSES = new Set<RunStatus>(['succeeded', 'failed', 'cancelled', 'timeout']);

function canTransitionTaskStatus(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return true;
  const map: Record<TaskStatus, TaskStatus[]> = {
    pending: ['ready', 'blocked', 'cancelled'],
    ready: ['running', 'blocked', 'cancelled'],
    blocked: ['ready', 'cancelled'],
    running: ['completed', 'failed', 'cancelled'],
    completed: [],
    failed: [],
    cancelled: [],
  };
  return map[from].includes(to);
}

function hasCycle(edges: TaskDependency[]): boolean {
  const graph = new Map<string, Set<string>>();
  for (const edge of edges) {
    const deps = graph.get(edge.taskId) ?? new Set<string>();
    deps.add(edge.dependsOnTaskId);
    graph.set(edge.taskId, deps);
    if (!graph.has(edge.dependsOnTaskId)) {
      graph.set(edge.dependsOnTaskId, new Set());
    }
  }

  const state = new Map<string, 0 | 1 | 2>();
  const visit = (node: string): boolean => {
    const mark = state.get(node) ?? 0;
    if (mark === 1) return true;
    if (mark === 2) return false;
    state.set(node, 1);
    for (const dep of graph.get(node) ?? []) {
      if (visit(dep)) return true;
    }
    state.set(node, 2);
    return false;
  };

  for (const node of graph.keys()) {
    if (visit(node)) return true;
  }
  return false;
}

export class TaskService {
  constructor(
    private readonly repo: TaskRepository,
    private readonly runner: TaskRunner,
    private readonly now: () => string = defaultNow,
    private readonly sleepMs: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms))
  ) {}

  async prepare(): Promise<void> {
    await this.repo.prepare();
    await this.runner.recover();
  }

  async createTask(sessionId: string, input: CreateTaskInput, taskId: TaskId): Promise<Task> {
    const now = this.now();
    return this.repo.createTask({
      sessionId,
      input,
      now,
      id: taskId,
    });
  }

  async getTask(sessionId: string, taskId: TaskId): Promise<Task> {
    const task = await this.repo.getTask(sessionId, taskId);
    if (!task) throw notFound('task', taskId);
    return task;
  }

  async listTasks(
    sessionId: string,
    query?: { status?: TaskStatus; priority?: Task['priority']; limit?: number }
  ): Promise<Task[]> {
    return this.repo.listTasks(sessionId, query);
  }

  async updateTask(sessionId: string, taskId: TaskId, patch: UpdateTaskInput): Promise<Task> {
    const current = await this.repo.getTask(sessionId, taskId);
    if (!current) throw notFound('task', taskId);

    if (patch.status && !canTransitionTaskStatus(current.status, patch.status)) {
      throw invalidTransition(current.status, patch.status);
    }

    const updated = await this.repo.updateTask(sessionId, taskId, patch, this.now());
    if (!updated) {
      throw conflict('task update failed due to version mismatch or concurrent write', {
        taskId,
        expectedVersion: patch.expectedVersion,
      });
    }
    return updated;
  }

  async deleteTask(sessionId: string, taskId: TaskId): Promise<void> {
    const deleted = await this.repo.deleteTask(sessionId, taskId);
    if (!deleted) throw notFound('task', taskId);
  }

  async addDependency(sessionId: string, taskId: TaskId, dependsOnTaskId: TaskId): Promise<void> {
    if (taskId === dependsOnTaskId) {
      throw invalidArgument('task cannot depend on itself', { taskId, dependsOnTaskId });
    }

    await this.getTask(sessionId, taskId);
    await this.getTask(sessionId, dependsOnTaskId);

    const edge: TaskDependency = { taskId, dependsOnTaskId, createdAt: this.now() };
    await this.repo.addDependency(sessionId, edge);

    const allEdges = await this.repo.listDependencies(sessionId);
    if (hasCycle(allEdges)) {
      await this.repo.removeDependency(sessionId, taskId, dependsOnTaskId);
      throw conflict('circular dependency detected', { taskId, dependsOnTaskId });
    }
  }

  async removeDependency(
    sessionId: string,
    taskId: TaskId,
    dependsOnTaskId: TaskId
  ): Promise<void> {
    await this.repo.removeDependency(sessionId, taskId, dependsOnTaskId);
  }

  async listDependencies(sessionId: string, taskId?: TaskId): Promise<TaskDependency[]> {
    if (taskId) {
      await this.getTask(sessionId, taskId);
    }
    return this.repo.listDependencies(sessionId, taskId);
  }

  async startRun(
    sessionId: string,
    runId: RunId,
    input: StartRunInput,
    adapter?: RunExecutionAdapter
  ): Promise<Run> {
    if (!input.taskId && (!input.prompt || input.prompt.trim().length === 0)) {
      throw invalidArgument('task_run_start requires task_id or prompt');
    }
    let prompt = input.prompt?.trim();
    if (input.taskId) {
      const task = await this.getTask(sessionId, input.taskId);
      if (!prompt) {
        prompt = `${task.title}\n\n${task.description}`.trim();
      }
    }

    const now = this.now();
    const run = await this.repo.createRun({
      sessionId,
      input: {
        ...input,
        prompt: prompt ?? input.prompt,
      },
      now,
      id: runId,
    });

    await this.runner.start(run, adapter);
    return run;
  }

  async getRun(sessionId: string, runId: RunId): Promise<Run> {
    const run = await this.repo.getRun(sessionId, runId);
    if (!run) throw notFound('run', runId);
    return run;
  }

  async listRuns(
    sessionId: string,
    query?: { taskId?: TaskId; status?: RunStatus; limit?: number }
  ): Promise<Run[]> {
    return this.repo.listRuns(sessionId, query);
  }

  async cancelRun(sessionId: string, runId: RunId): Promise<void> {
    const run = await this.repo.getRun(sessionId, runId);
    if (!run) throw notFound('run', runId);

    if (TERMINAL_RUN_STATUSES.has(run.status)) {
      return;
    }

    await this.repo.updateRunStatus(sessionId, runId, 'cancel_requested', this.now());
    await this.runner.cancel(sessionId, runId);
  }

  async waitRun(
    sessionId: string,
    runId: RunId,
    options?: { timeoutMs?: number; pollIntervalMs?: number }
  ): Promise<Run> {
    const timeoutMs = Math.max(1_000, Math.floor(options?.timeoutMs ?? 30_000));
    const pollIntervalMs = Math.max(100, Math.floor(options?.pollIntervalMs ?? 300));
    const deadline = Date.now() + timeoutMs;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const run = await this.getRun(sessionId, runId);
      if (TERMINAL_RUN_STATUSES.has(run.status)) {
        return run;
      }
      if (Date.now() >= deadline) {
        return run;
      }
      await this.sleepMs(pollIntervalMs);
    }
  }

  async listRunEvents(
    sessionId: string,
    runId: RunId,
    options?: { afterSeq?: number; limit?: number }
  ) {
    await this.getRun(sessionId, runId);
    return this.repo.listRunEvents(sessionId, runId, options?.afterSeq, options?.limit);
  }

  async clearSession(sessionId: string): Promise<void> {
    await this.repo.clearSession(sessionId);
  }

  async gcRuns(finishedBefore: string, limit = 500): Promise<number> {
    return this.repo.gcRuns({
      finishedBefore,
      limit: Math.max(1, Math.floor(limit)),
    });
  }
}

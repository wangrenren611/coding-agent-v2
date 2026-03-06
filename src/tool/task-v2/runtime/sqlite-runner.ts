import { notFound } from '../errors';
import type { TaskRepository } from '../storage/repository';
import type { Run, RunId, RunStatus, TaskStatus } from '../types';
import type { RunControl, RunExecutionAdapter, TaskRunner } from './runner';

const TERMINAL_RUN_STATUSES = new Set<RunStatus>(['succeeded', 'failed', 'cancelled', 'timeout']);
const RECOVERY_SCAN_STATUSES: RunStatus[] = ['queued', 'running', 'cancel_requested'];

function defaultNow(): string {
  return new Date().toISOString();
}

function isAbortLikeError(error: unknown): boolean {
  if (error instanceof Error) {
    const text = `${error.name} ${error.message}`.toLowerCase();
    return text.includes('abort') || text.includes('cancel');
  }
  return false;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function mapRunStatusToTaskStatus(status: RunStatus): TaskStatus {
  if (status === 'succeeded') return 'completed';
  if (status === 'failed' || status === 'timeout') return 'failed';
  if (status === 'cancelled' || status === 'cancel_requested') return 'cancelled';
  return 'running';
}

export class SqliteTaskRunner implements TaskRunner {
  private readonly adapters = new Map<RunId, RunExecutionAdapter>();
  private readonly activeControllers = new Map<RunId, AbortController>();
  private recovered = false;
  private recoveryPromise: Promise<void> | null = null;

  constructor(
    private readonly repo: TaskRepository,
    private readonly now: () => string = defaultNow
  ) {}

  async recover(): Promise<void> {
    if (this.recovered) return;
    if (this.recoveryPromise) {
      await this.recoveryPromise;
      return;
    }
    this.recoveryPromise = this.doRecover();
    try {
      await this.recoveryPromise;
    } finally {
      this.recoveryPromise = null;
    }
  }

  private async doRecover(): Promise<void> {
    const runs = await this.repo.listRunsByStatus(RECOVERY_SCAN_STATUSES, 2000);
    for (const run of runs) {
      if (run.status === 'running') {
        await this.finishRun(run, {
          status: 'failed',
          error: 'run interrupted by runner restart',
        });
        continue;
      }

      if (run.status === 'cancel_requested') {
        await this.finishRun(run, {
          status: 'cancelled',
          error: 'cancelled during recovery',
        });
        continue;
      }

      if (!this.adapters.has(run.id)) {
        await this.finishRun(run, {
          status: 'failed',
          error: 'queued run converged without execution adapter',
        });
        continue;
      }

      void this.executeRun(run).catch(() => undefined);
    }
    this.recovered = true;
  }

  async start(run: Run, adapter?: RunExecutionAdapter): Promise<void> {
    await this.recover();
    if (adapter) {
      this.adapters.set(run.id, adapter);
    }

    const latest = await this.repo.getRun(run.sessionId, run.id);
    if (!latest) {
      throw notFound('run', run.id);
    }
    if (TERMINAL_RUN_STATUSES.has(latest.status)) return;

    if (latest.status === 'cancel_requested') {
      await this.finishRun(latest, { status: 'cancelled', error: 'cancelled before execution' });
      return;
    }

    if (latest.status !== 'queued') {
      return;
    }
    void this.executeRun(latest).catch(() => undefined);
  }

  async cancel(sessionId: string, runId: RunId): Promise<RunControl | null> {
    await this.recover();
    const run = await this.repo.getRun(sessionId, runId);
    if (!run) {
      return null;
    }
    if (TERMINAL_RUN_STATUSES.has(run.status)) {
      return { runId, cancelRequested: false };
    }

    const now = this.now();
    await this.repo.updateRunStatus(sessionId, runId, 'cancel_requested', now);
    await this.repo.appendRunEvent(sessionId, {
      runId,
      type: 'status',
      payload: { status: 'cancel_requested' },
      createdAt: now,
    });

    const controller = this.activeControllers.get(runId);
    if (controller) {
      controller.abort();
      return { runId, cancelRequested: true };
    }

    const latest = await this.repo.getRun(sessionId, runId);
    if (latest && latest.status === 'cancel_requested') {
      await this.finishRun(latest, { status: 'cancelled', error: 'cancelled while queued' });
    }
    return { runId, cancelRequested: true };
  }

  async isActive(sessionId: string, runId: RunId): Promise<boolean> {
    if (!this.activeControllers.has(runId)) {
      return false;
    }
    const run = await this.repo.getRun(sessionId, runId);
    if (!run) return false;
    return this.activeControllers.has(run.id);
  }

  private async executeRun(run: Run): Promise<void> {
    if (this.activeControllers.has(run.id)) return;
    const adapter = this.adapters.get(run.id);
    if (!adapter) {
      await this.finishRun(run, { status: 'failed', error: 'missing execution adapter' });
      return;
    }

    const controller = new AbortController();
    this.activeControllers.set(run.id, controller);

    const now = this.now();
    await this.repo.updateRunStatus(run.sessionId, run.id, 'running', now);
    await this.repo.appendRunEvent(run.sessionId, {
      runId: run.id,
      type: 'status',
      payload: { status: 'running' },
      createdAt: now,
    });
    await this.syncTaskStatus(run, 'running');

    try {
      const latest = (await this.repo.getRun(run.sessionId, run.id)) ?? run;
      const result = await adapter.execute(latest, controller.signal, async (event) => {
        await this.repo.appendRunEvent(run.sessionId, {
          runId: run.id,
          type: event.type,
          payload: event.payload,
          createdAt: event.createdAt,
        });
      });

      const after = await this.repo.getRun(run.sessionId, run.id);
      if (after?.status === 'cancel_requested') {
        await this.finishRun(run, { status: 'cancelled', error: 'cancel requested' });
        return;
      }
      await this.finishRun(run, result);
    } catch (error) {
      const cancelled = controller.signal.aborted || isAbortLikeError(error);
      await this.finishRun(run, {
        status: cancelled ? 'cancelled' : 'failed',
        error: toErrorMessage(error),
      });
    } finally {
      this.activeControllers.delete(run.id);
      this.adapters.delete(run.id);
    }
  }

  private async finishRun(
    run: Run,
    result: {
      status: 'succeeded' | 'failed' | 'cancelled' | 'timeout';
      output?: string;
      error?: string;
    }
  ): Promise<void> {
    const now = this.now();
    await this.repo.completeRun(run.sessionId, run.id, {
      status: result.status,
      output: result.output,
      error: result.error,
      now,
    });
    await this.repo.appendRunEvent(run.sessionId, {
      runId: run.id,
      type: 'status',
      payload: { status: result.status, error: result.error },
      createdAt: now,
    });
    await this.syncTaskStatus(run, mapRunStatusToTaskStatus(result.status));
  }

  private async syncTaskStatus(run: Run, status: TaskStatus): Promise<void> {
    if (!run.taskId) return;
    const task = await this.repo.getTask(run.sessionId, run.taskId);
    if (!task) return;
    if (task.status === status) return;
    await this.repo.updateTask(
      run.sessionId,
      run.taskId,
      { status, expectedVersion: task.version },
      this.now()
    );
  }
}

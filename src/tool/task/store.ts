import path from 'path';
import { z } from 'zod';
import { AtomicJsonStore } from '../../storage/atomic-json';
import { nowIso, compareTaskIds, uniqueStrings } from './utils';
import type { ManagedTask, SubTaskRunRecord } from './types';
import { ManagedTaskSchema, SubTaskRunRecordSchema } from './types';

const MANAGED_TASK_FILE_VERSION = 1;
const RUN_FILE_VERSION = 1;

const ManagedTaskFileSchema = z
  .object({
    version: z.literal(MANAGED_TASK_FILE_VERSION),
    tasks: z.array(ManagedTaskSchema),
  })
  .strict();

const SubTaskRunFileSchema = z
  .object({
    version: z.literal(RUN_FILE_VERSION),
    runs: z.array(SubTaskRunRecordSchema),
  })
  .strict();

type ManagedTaskFile = z.infer<typeof ManagedTaskFileSchema>;
type SubTaskRunFile = z.infer<typeof SubTaskRunFileSchema>;

export interface TaskStoreOptions {
  dataDir?: string;
  io?: AtomicJsonStore;
}

export class TaskStore {
  private readonly io: AtomicJsonStore;
  private readonly dataDir: string;
  private readonly managedDir: string;
  private readonly runDir: string;
  private preparePromise: Promise<void> | null = null;

  constructor(options: TaskStoreOptions = {}) {
    this.io = options.io ?? new AtomicJsonStore();
    this.dataDir = options.dataDir ?? path.join(process.cwd(), 'data', 'task-tool');
    this.managedDir = path.join(this.dataDir, 'managed');
    this.runDir = path.join(this.dataDir, 'runs');
  }

  getDataDir(): string {
    return this.dataDir;
  }

  async listManagedTasks(sessionId: string): Promise<ManagedTask[]> {
    await this.prepare();
    const parsed = await this.readManagedTaskFile(sessionId);
    return parsed.tasks;
  }

  async saveManagedTasks(sessionId: string, tasks: ManagedTask[]): Promise<void> {
    await this.prepare();
    const next = this.normalizeManagedTasks(tasks);
    const payload: ManagedTaskFile = {
      version: MANAGED_TASK_FILE_VERSION,
      tasks: next,
    };
    await this.io.writeJsonFile(this.managedFilePath(sessionId), payload);
  }

  async upsertManagedTask(sessionId: string, task: ManagedTask): Promise<void> {
    await this.prepare();
    await this.io.mutateJsonFile<ManagedTaskFile>(this.managedFilePath(sessionId), (current) => {
      const normalized = this.normalizeManagedTaskFile(current);
      const nextTasks = normalized.tasks.filter((item) => item.id !== task.id);
      nextTasks.push(task);
      return {
        version: MANAGED_TASK_FILE_VERSION,
        tasks: this.normalizeManagedTasks(nextTasks),
      };
    });
  }

  async deleteManagedTask(sessionId: string, taskId: string): Promise<void> {
    await this.prepare();
    await this.io.mutateJsonFile<ManagedTaskFile>(this.managedFilePath(sessionId), (current) => {
      const normalized = this.normalizeManagedTaskFile(current);
      return {
        version: MANAGED_TASK_FILE_VERSION,
        tasks: normalized.tasks.filter((task) => task.id !== taskId),
      };
    });
  }

  async getSubTaskRun(sessionId: string, runId: string): Promise<SubTaskRunRecord | null> {
    await this.prepare();
    const parsed = await this.readRunFile(sessionId);
    return parsed.runs.find((run) => run.runId === runId) ?? null;
  }

  async listSubTaskRuns(
    sessionId: string,
    options?: {
      mode?: SubTaskRunRecord['mode'];
      limit?: number;
      orderBy?: 'updatedAt' | 'createdAt';
      orderDirection?: 'asc' | 'desc';
    }
  ): Promise<SubTaskRunRecord[]> {
    await this.prepare();
    const parsed = await this.readRunFile(sessionId);
    let runs = parsed.runs;

    if (options?.mode) {
      runs = runs.filter((run) => run.mode === options.mode);
    }

    const orderBy = options?.orderBy ?? 'updatedAt';
    const orderDirection = options?.orderDirection ?? 'desc';
    const direction = orderDirection === 'asc' ? 1 : -1;

    runs = [...runs].sort((left, right) => {
      const leftTime = new Date(left[orderBy]).getTime();
      const rightTime = new Date(right[orderBy]).getTime();
      if (leftTime !== rightTime) {
        return direction * (leftTime - rightTime);
      }
      return direction * left.runId.localeCompare(right.runId);
    });

    if (typeof options?.limit === 'number' && options.limit > 0) {
      runs = runs.slice(0, options.limit);
    }

    return runs;
  }

  async upsertSubTaskRun(sessionId: string, run: SubTaskRunRecord): Promise<void> {
    await this.prepare();
    await this.io.mutateJsonFile<SubTaskRunFile>(this.runFilePath(sessionId), (current) => {
      const normalized = this.normalizeRunFile(current);
      const nextRuns = normalized.runs.filter((item) => item.runId !== run.runId);
      nextRuns.push(run);
      return {
        version: RUN_FILE_VERSION,
        runs: this.normalizeRuns(nextRuns),
      };
    });
  }

  async clearSession(sessionId: string): Promise<void> {
    await this.prepare();
    await Promise.all([
      this.io.deleteFileIfExists(this.managedFilePath(sessionId)),
      this.io.deleteFileIfExists(this.runFilePath(sessionId)),
    ]);
  }

  private async prepare(): Promise<void> {
    if (!this.preparePromise) {
      this.preparePromise = Promise.all([
        this.io.ensureDir(this.dataDir),
        this.io.ensureDir(this.managedDir),
        this.io.ensureDir(this.runDir),
      ]).then(() => undefined);
    }
    await this.preparePromise;
  }

  private async readManagedTaskFile(sessionId: string): Promise<ManagedTaskFile> {
    const loaded = await this.io.readJsonFile<unknown>(this.managedFilePath(sessionId));
    return this.normalizeManagedTaskFile(loaded);
  }

  private async readRunFile(sessionId: string): Promise<SubTaskRunFile> {
    const loaded = await this.io.readJsonFile<unknown>(this.runFilePath(sessionId));
    return this.normalizeRunFile(loaded);
  }

  private normalizeManagedTaskFile(raw: unknown): ManagedTaskFile {
    const parsed = ManagedTaskFileSchema.safeParse(raw);
    if (!parsed.success) {
      return { version: MANAGED_TASK_FILE_VERSION, tasks: [] };
    }
    return {
      version: MANAGED_TASK_FILE_VERSION,
      tasks: this.normalizeManagedTasks(parsed.data.tasks),
    };
  }

  private normalizeRunFile(raw: unknown): SubTaskRunFile {
    const parsed = SubTaskRunFileSchema.safeParse(raw);
    if (!parsed.success) {
      return { version: RUN_FILE_VERSION, runs: [] };
    }
    return {
      version: RUN_FILE_VERSION,
      runs: this.normalizeRuns(parsed.data.runs),
    };
  }

  private normalizeManagedTasks(tasks: ManagedTask[]): ManagedTask[] {
    return tasks
      .map((task) => ({
        ...task,
        owner: task.owner ?? '',
        blocks: uniqueStrings(task.blocks),
        blockedBy: uniqueStrings(task.blockedBy),
      }))
      .sort((left, right) => compareTaskIds(left.id, right.id));
  }

  private normalizeRuns(runs: SubTaskRunRecord[]): SubTaskRunRecord[] {
    const deduped = new Map<string, SubTaskRunRecord>();
    for (const run of runs) {
      deduped.set(run.runId, this.normalizeRun(run));
    }
    return Array.from(deduped.values()).sort((left, right) => {
      const leftTime = new Date(left.updatedAt).getTime();
      const rightTime = new Date(right.updatedAt).getTime();
      if (leftTime !== rightTime) {
        return rightTime - leftTime;
      }
      return right.runId.localeCompare(left.runId);
    });
  }

  private normalizeRun(run: SubTaskRunRecord): SubTaskRunRecord {
    const now = nowIso();
    const toolsUsed = uniqueStrings(run.toolsUsed);
    return {
      ...run,
      toolsUsed,
      messageCount: Number.isFinite(run.messageCount) ? Math.max(0, run.messageCount) : 0,
      updatedAt: run.updatedAt || now,
      lastActivityAt: run.lastActivityAt || run.updatedAt || now,
      output: run.output,
      error: run.error,
      lastToolName: run.lastToolName,
    };
  }

  private managedFilePath(sessionId: string): string {
    return path.join(this.managedDir, `${this.safeSessionName(sessionId)}.json`);
  }

  private runFilePath(sessionId: string): string {
    return path.join(this.runDir, `${this.safeSessionName(sessionId)}.json`);
  }

  private safeSessionName(sessionId: string): string {
    return encodeURIComponent(sessionId);
  }
}

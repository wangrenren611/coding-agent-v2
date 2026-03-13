import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { createEmptyNamespaceState, safeJsonClone, type TaskNamespaceState } from './task-types';

interface NamespaceLockState {
  locked: boolean;
  waiters: Array<() => void>;
}

export interface TaskStoreOptions {
  baseDir?: string;
  now?: () => number;
}

export class TaskStore {
  readonly baseDir: string;

  private readonly now: () => number;
  private readonly namespaceCache = new Map<string, TaskNamespaceState>();
  private readonly lockStates = new Map<string, NamespaceLockState>();
  private initialized = false;

  constructor(options: TaskStoreOptions = {}) {
    this.baseDir = path.resolve(
      options.baseDir || path.join(os.homedir(), '.renx', 'task')
    );
    this.now = options.now || Date.now;
  }

  async getState(namespaceInput?: string): Promise<TaskNamespaceState> {
    const namespace = this.normalizeNamespace(namespaceInput);
    await this.ensureInitialized();
    const state = await this.readNamespaceState(namespace);
    return safeJsonClone(state);
  }

  async updateState<T>(
    namespaceInput: string | undefined,
    updater: (state: TaskNamespaceState) => Promise<T> | T
  ): Promise<{ state: TaskNamespaceState; result: T }> {
    const namespace = this.normalizeNamespace(namespaceInput);
    await this.ensureInitialized();
    await this.acquireNamespaceLock(namespace);

    try {
      const current = await this.readNamespaceState(namespace);
      const working = safeJsonClone(current);
      const result = await updater(working);
      working.updatedAt = this.now();
      await this.writeNamespaceState(namespace, working);
      this.namespaceCache.set(namespace, safeJsonClone(working));
      return {
        state: safeJsonClone(working),
        result,
      };
    } finally {
      this.releaseNamespaceLock(namespace);
    }
  }

  normalizeNamespace(namespaceInput?: string): string {
    const raw = (namespaceInput || 'default').trim();
    if (!raw) {
      return 'default';
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(raw)) {
      throw new Error('TASK_INVALID_NAMESPACE: namespace allows only [a-zA-Z0-9._-]');
    }
    return raw;
  }

  getNamespaceFilePath(namespace: string): string {
    return path.join(this.baseDir, `${namespace}.json`);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await fs.mkdir(this.baseDir, { recursive: true });
    this.initialized = true;
  }

  private async readNamespaceState(namespace: string): Promise<TaskNamespaceState> {
    const cached = this.namespaceCache.get(namespace);
    if (cached) {
      return safeJsonClone(cached);
    }

    const filePath = this.getNamespaceFilePath(namespace);
    try {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<TaskNamespaceState>;
      const hydrated = this.hydrateState(namespace, parsed);
      this.namespaceCache.set(namespace, safeJsonClone(hydrated));
      return hydrated;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError?.code !== 'ENOENT') {
        throw new Error(
          `TASK_STORE_IO_ERROR: failed to load namespace ${namespace}: ${nodeError.message}`
        );
      }
      const emptyState = createEmptyNamespaceState(namespace);
      this.namespaceCache.set(namespace, safeJsonClone(emptyState));
      await this.writeNamespaceState(namespace, emptyState);
      return emptyState;
    }
  }

  private hydrateState(
    namespace: string,
    partial: Partial<TaskNamespaceState>
  ): TaskNamespaceState {
    const base = createEmptyNamespaceState(namespace);
    const merged: TaskNamespaceState = {
      ...base,
      ...partial,
      namespace,
      tasks: partial.tasks || {},
      agentRuns: partial.agentRuns || {},
      graph: {
        adjacency: partial.graph?.adjacency || {},
        reverse: partial.graph?.reverse || {},
      },
      updatedAt: typeof partial.updatedAt === 'number' ? partial.updatedAt : base.updatedAt,
      schemaVersion: 1,
    };

    for (const taskId of Object.keys(merged.tasks)) {
      if (!merged.graph.adjacency[taskId]) {
        merged.graph.adjacency[taskId] = [];
      }
      if (!merged.graph.reverse[taskId]) {
        merged.graph.reverse[taskId] = [];
      }
    }

    return merged;
  }

  private async writeNamespaceState(namespace: string, state: TaskNamespaceState): Promise<void> {
    const filePath = this.getNamespaceFilePath(namespace);
    const dirPath = path.dirname(filePath);
    await fs.mkdir(dirPath, { recursive: true });
    const tmpPath = `${filePath}.tmp.${randomUUID().slice(0, 8)}`;
    const json = `${JSON.stringify(state, null, 2)}\n`;
    await fs.writeFile(tmpPath, json, 'utf8');

    try {
      await fs.rename(tmpPath, filePath);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'EPERM' && process.platform === 'win32') {
        await fs.copyFile(tmpPath, filePath);
        await fs.unlink(tmpPath).catch(() => undefined);
        return;
      }
      throw error;
    }
  }

  private async acquireNamespaceLock(namespace: string): Promise<void> {
    let lockState = this.lockStates.get(namespace);
    if (!lockState) {
      lockState = {
        locked: false,
        waiters: [],
      };
      this.lockStates.set(namespace, lockState);
    }

    if (!lockState.locked) {
      lockState.locked = true;
      return;
    }

    await new Promise<void>((resolve) => {
      lockState?.waiters.push(resolve);
    });
  }

  private releaseNamespaceLock(namespace: string): void {
    const lockState = this.lockStates.get(namespace);
    if (!lockState) {
      return;
    }

    const next = lockState.waiters.shift();
    if (next) {
      next();
      return;
    }

    lockState.locked = false;
  }
}

let globalTaskStore: TaskStore | null = null;
let globalTaskStoreKey = '';

export function getTaskStore(options: TaskStoreOptions = {}): TaskStore {
  const baseDir = path.resolve(
    options.baseDir || path.join(os.homedir(), '.renx', 'task')
  );
  if (!globalTaskStore || globalTaskStoreKey !== baseDir) {
    globalTaskStore = new TaskStore({
      ...options,
      baseDir,
    });
    globalTaskStoreKey = baseDir;
  }
  return globalTaskStore;
}

export function resetTaskStoreSingleton(): void {
  globalTaskStore = null;
  globalTaskStoreKey = '';
}

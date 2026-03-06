import path from 'node:path';
import type { ToolExecutionContext } from '../../types';
import { TaskService } from '../service';
import {
  SqliteTaskRepository,
  type SqliteTaskRepositoryOptions,
} from '../storage/sqlite-repository';
import type { TaskRepository } from '../storage/repository';
import { SqliteTaskRunner } from './sqlite-runner';
import type { TaskRunner } from './runner';

export interface TaskV2RuntimeOptions {
  dbPath?: string;
  workingDirectory?: string;
  repository?: TaskRepository;
  runner?: TaskRunner;
  service?: TaskService;
}

function resolveDbPath(options: TaskV2RuntimeOptions): string {
  if (options.dbPath) {
    return path.resolve(options.dbPath);
  }
  const base = path.resolve(options.workingDirectory ?? process.cwd());
  return path.join(base, '.agent-cli', 'tasks.db');
}

export class TaskV2Runtime {
  readonly dbPath: string;
  readonly repository: TaskRepository;
  readonly runner: TaskRunner;
  readonly service: TaskService;
  private preparePromise: Promise<void> | null = null;

  constructor(options: TaskV2RuntimeOptions = {}) {
    this.dbPath = resolveDbPath(options);
    this.repository =
      options.repository ??
      new SqliteTaskRepository({
        dbPath: this.dbPath,
      } satisfies SqliteTaskRepositoryOptions);
    this.runner = options.runner ?? new SqliteTaskRunner(this.repository);
    this.service = options.service ?? new TaskService(this.repository, this.runner);
  }

  async prepare(): Promise<void> {
    if (!this.preparePromise) {
      this.preparePromise = this.service.prepare();
    }
    await this.preparePromise;
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
}

const defaultRuntimeRegistry = new Map<string, TaskV2Runtime>();

export function getDefaultTaskV2Runtime(options: TaskV2RuntimeOptions = {}): TaskV2Runtime {
  const dbPath = resolveDbPath(options);
  const existing = defaultRuntimeRegistry.get(dbPath);
  if (existing) {
    return existing;
  }
  const runtime = new TaskV2Runtime({ ...options, dbPath });
  defaultRuntimeRegistry.set(dbPath, runtime);
  return runtime;
}

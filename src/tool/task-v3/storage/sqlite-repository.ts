import path from 'node:path';
import { SqliteClient } from '../../../storage/sqliteClient';
import { conflict } from '../errors';
import type {
  AppendRunEventInput,
  CompleteRunInput,
  CreateTaskParams,
  RunQuery,
  StartRunParams,
  TaskQuery,
  TaskRepository,
} from './repository';
import type {
  Run,
  RunEvent,
  RunId,
  RunStatus,
  SubAgentConfigSnapshot,
  Task,
  TaskDependency,
  TaskId,
} from '../types';

const TERMINAL_RUN_STATUSES = new Set<RunStatus>(['succeeded', 'failed', 'cancelled', 'timeout']);

const TASK_V3_DDL = `
  CREATE TABLE IF NOT EXISTS task_v3_tasks (
    session_id TEXT NOT NULL,
    id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL,
    priority TEXT NOT NULL,
    version INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (session_id, id)
  );

  CREATE INDEX IF NOT EXISTS idx_task_v3_tasks_session_status
    ON task_v3_tasks(session_id, status, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_task_v3_tasks_session_priority
    ON task_v3_tasks(session_id, priority, updated_at DESC);

  CREATE TABLE IF NOT EXISTS task_v3_dependencies (
    session_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    depends_on_task_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (session_id, task_id, depends_on_task_id),
    FOREIGN KEY (session_id, task_id) REFERENCES task_v3_tasks(session_id, id) ON DELETE CASCADE,
    FOREIGN KEY (session_id, depends_on_task_id) REFERENCES task_v3_tasks(session_id, id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_task_v3_dependencies_depends_on
    ON task_v3_dependencies(session_id, depends_on_task_id);

  CREATE TABLE IF NOT EXISTS task_v3_runs (
    session_id TEXT NOT NULL,
    id TEXT NOT NULL,
    task_id TEXT,
    agent_type TEXT NOT NULL,
    agent_profile_id TEXT,
    agent_config_snapshot TEXT,
    status TEXT NOT NULL,
    input_snapshot TEXT NOT NULL,
    output TEXT,
    error TEXT,
    timeout_ms INTEGER,
    started_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (session_id, id),
    FOREIGN KEY (session_id, task_id) REFERENCES task_v3_tasks(session_id, id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_task_v3_runs_session_status
    ON task_v3_runs(session_id, status, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_task_v3_runs_status
    ON task_v3_runs(status, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_task_v3_runs_finished_at
    ON task_v3_runs(finished_at);

  CREATE TABLE IF NOT EXISTS task_v3_run_events (
    session_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (session_id, run_id, seq),
    FOREIGN KEY (session_id, run_id) REFERENCES task_v3_runs(session_id, id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_task_v3_run_events_cursor
    ON task_v3_run_events(session_id, run_id, seq);
`;

interface TaskRow {
  session_id: string;
  id: string;
  title: string;
  description: string;
  status: Task['status'];
  priority: Task['priority'];
  version: number;
  created_at: string;
  updated_at: string;
}

interface TaskDependencyRow {
  task_id: string;
  depends_on_task_id: string;
  created_at: string;
}

interface RunRow {
  session_id: string;
  id: string;
  task_id: string | null;
  agent_type: string;
  agent_profile_id: string | null;
  agent_config_snapshot: string | null;
  status: RunStatus;
  input_snapshot: string;
  output: string | null;
  error: string | null;
  timeout_ms: number | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

interface TableInfoRow {
  name: string;
}

interface RunEventRow {
  run_id: string;
  seq: number;
  type: RunEvent['type'];
  payload_json: string;
  created_at: string;
}

function parseJsonRecord(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

function parseAgentConfigSnapshot(raw: string | null): SubAgentConfigSnapshot | undefined {
  if (!raw) {
    return undefined;
  }
  const parsed = parseJsonRecord(raw);
  if (
    typeof parsed.profileId === 'string' &&
    typeof parsed.profileName === 'string' &&
    typeof parsed.profileVersion === 'number' &&
    typeof parsed.systemPrompt === 'string' &&
    typeof parsed.maxSteps === 'number' &&
    typeof parsed.memoryMode === 'string'
  ) {
    return parsed as unknown as SubAgentConfigSnapshot;
  }
  return undefined;
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id as TaskId,
    sessionId: row.session_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRun(row: RunRow): Run {
  const config = parseAgentConfigSnapshot(row.agent_config_snapshot);
  return {
    id: row.id as RunId,
    sessionId: row.session_id,
    taskId: (row.task_id ?? undefined) as TaskId | undefined,
    agentType: row.agent_type,
    agentProfileId: row.agent_profile_id ?? undefined,
    agentConfigSnapshot: config,
    status: row.status,
    inputSnapshot: row.input_snapshot,
    output: row.output ?? undefined,
    error: row.error ?? undefined,
    timeoutMs: row.timeout_ms ?? undefined,
    startedAt: row.started_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRunEvent(row: RunEventRow): RunEvent {
  return {
    runId: row.run_id as RunId,
    seq: row.seq,
    type: row.type,
    payload: parseJsonRecord(row.payload_json),
    createdAt: row.created_at,
  };
}

export interface SqliteTaskRepositoryOptions {
  dbPath?: string;
}

export class SqliteTaskRepository implements TaskRepository {
  private readonly client: SqliteClient;
  private prepared = false;
  private preparing: Promise<void> | null = null;

  constructor(options: SqliteTaskRepositoryOptions = {}) {
    const dbPath = options.dbPath ?? path.join(process.cwd(), '.agent-cli', 'tasks.db');
    this.client = new SqliteClient(dbPath);
  }

  async prepare(): Promise<void> {
    if (this.prepared) return;
    if (this.preparing) {
      await this.preparing;
      return;
    }
    this.preparing = this.doPrepare();
    try {
      await this.preparing;
    } finally {
      this.preparing = null;
    }
  }

  private async doPrepare(): Promise<void> {
    await this.client.prepare();
    await this.client.exec(TASK_V3_DDL);
    await this.ensureRunColumns();
    this.prepared = true;
  }

  private async ensureRunColumns(): Promise<void> {
    const columns = await this.client.all<TableInfoRow>('PRAGMA table_info(task_v3_runs)');
    const names = new Set(columns.map((column) => column.name));
    if (!names.has('agent_profile_id')) {
      await this.client.exec('ALTER TABLE task_v3_runs ADD COLUMN agent_profile_id TEXT;');
    }
    if (!names.has('agent_config_snapshot')) {
      await this.client.exec('ALTER TABLE task_v3_runs ADD COLUMN agent_config_snapshot TEXT;');
    }
  }

  async createTask(params: CreateTaskParams): Promise<Task> {
    await this.prepare();
    const status = params.input.status ?? 'pending';
    const priority = params.input.priority ?? 'medium';

    await this.client.run(
      `
        INSERT INTO task_v3_tasks(
          session_id, id, title, description, status, priority, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      `,
      [
        params.sessionId,
        params.id,
        params.input.title,
        params.input.description,
        status,
        priority,
        params.now,
        params.now,
      ]
    );

    const created = await this.getTask(params.sessionId, params.id);
    if (!created) {
      throw conflict('failed to create task', { taskId: params.id });
    }
    return created;
  }

  async getTask(sessionId: string, taskId: TaskId): Promise<Task | null> {
    await this.prepare();
    const row = await this.client.get<TaskRow>(
      `
        SELECT session_id, id, title, description, status, priority, version, created_at, updated_at
        FROM task_v3_tasks
        WHERE session_id = ? AND id = ?
      `,
      [sessionId, taskId]
    );
    return row ? toTask(row) : null;
  }

  async listTasks(sessionId: string, query?: TaskQuery): Promise<Task[]> {
    await this.prepare();
    const clauses = ['session_id = ?'];
    const params: unknown[] = [sessionId];
    if (query?.status) {
      clauses.push('status = ?');
      params.push(query.status);
    }
    if (query?.priority) {
      clauses.push('priority = ?');
      params.push(query.priority);
    }
    const limit = query?.limit && query.limit > 0 ? Math.floor(query.limit) : 200;
    params.push(limit);

    const rows = await this.client.all<TaskRow>(
      `
        SELECT session_id, id, title, description, status, priority, version, created_at, updated_at
        FROM task_v3_tasks
        WHERE ${clauses.join(' AND ')}
        ORDER BY updated_at DESC, id DESC
        LIMIT ?
      `,
      params
    );
    return rows.map(toTask);
  }

  async updateTask(
    sessionId: string,
    taskId: TaskId,
    patch: import('../types').UpdateTaskInput,
    now: string
  ): Promise<Task | null> {
    await this.prepare();

    return this.client.transaction(async () => {
      const current = await this.getTask(sessionId, taskId);
      if (!current) return null;
      if (typeof patch.expectedVersion === 'number' && patch.expectedVersion !== current.version) {
        return null;
      }

      const next: Task = {
        ...current,
        title: patch.title ?? current.title,
        description: patch.description ?? current.description,
        priority: patch.priority ?? current.priority,
        status: patch.status ?? current.status,
        version: current.version + 1,
        updatedAt: now,
      };

      await this.client.run(
        `
          UPDATE task_v3_tasks
          SET title = ?, description = ?, priority = ?, status = ?, version = ?, updated_at = ?
          WHERE session_id = ? AND id = ? AND version = ?
        `,
        [
          next.title,
          next.description,
          next.priority,
          next.status,
          next.version,
          now,
          sessionId,
          taskId,
          current.version,
        ]
      );

      const updated = await this.getTask(sessionId, taskId);
      if (!updated || updated.version !== next.version) {
        return null;
      }
      return updated;
    });
  }

  async deleteTask(sessionId: string, taskId: TaskId): Promise<boolean> {
    await this.prepare();
    const existing = await this.getTask(sessionId, taskId);
    if (!existing) return false;
    await this.client.run('DELETE FROM task_v3_tasks WHERE session_id = ? AND id = ?', [
      sessionId,
      taskId,
    ]);
    return true;
  }

  async addDependency(sessionId: string, edge: TaskDependency): Promise<void> {
    await this.prepare();
    await this.client.run(
      `
        INSERT OR IGNORE INTO task_v3_dependencies(
          session_id, task_id, depends_on_task_id, created_at
        ) VALUES (?, ?, ?, ?)
      `,
      [sessionId, edge.taskId, edge.dependsOnTaskId, edge.createdAt]
    );
  }

  async removeDependency(
    sessionId: string,
    taskId: TaskId,
    dependsOnTaskId: TaskId
  ): Promise<void> {
    await this.prepare();
    await this.client.run(
      `
        DELETE FROM task_v3_dependencies
        WHERE session_id = ? AND task_id = ? AND depends_on_task_id = ?
      `,
      [sessionId, taskId, dependsOnTaskId]
    );
  }

  async listDependencies(sessionId: string, taskId?: TaskId): Promise<TaskDependency[]> {
    await this.prepare();
    const rows = taskId
      ? await this.client.all<TaskDependencyRow>(
          `
            SELECT task_id, depends_on_task_id, created_at
            FROM task_v3_dependencies
            WHERE session_id = ? AND task_id = ?
            ORDER BY created_at ASC
          `,
          [sessionId, taskId]
        )
      : await this.client.all<TaskDependencyRow>(
          `
            SELECT task_id, depends_on_task_id, created_at
            FROM task_v3_dependencies
            WHERE session_id = ?
            ORDER BY created_at ASC
          `,
          [sessionId]
        );

    return rows.map((row) => ({
      taskId: row.task_id as TaskId,
      dependsOnTaskId: row.depends_on_task_id as TaskId,
      createdAt: row.created_at,
    }));
  }

  async createRun(params: StartRunParams): Promise<Run> {
    await this.prepare();
    const snapshot = {
      task_id: params.input.taskId ?? null,
      prompt: params.input.prompt ?? '',
      agent_type: params.input.agentType,
      agent_profile_id: params.input.agentProfileId ?? null,
      agent_config_snapshot: params.input.agentConfigSnapshot ?? null,
      timeout_ms: params.input.timeoutMs ?? null,
    };

    await this.client.run(
      `
        INSERT INTO task_v3_runs(
          session_id, id, task_id, agent_type, agent_profile_id, agent_config_snapshot, status, input_snapshot,
          output, error, timeout_ms, started_at, finished_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, NULL, NULL, ?, NULL, NULL, ?, ?)
      `,
      [
        params.sessionId,
        params.id,
        params.input.taskId ?? null,
        params.input.agentType,
        params.input.agentProfileId ?? null,
        params.input.agentConfigSnapshot ? JSON.stringify(params.input.agentConfigSnapshot) : null,
        JSON.stringify(snapshot),
        params.input.timeoutMs ?? null,
        params.now,
        params.now,
      ]
    );

    const run = await this.getRun(params.sessionId, params.id);
    if (!run) {
      throw conflict('failed to create run', { runId: params.id });
    }
    return run;
  }

  async getRun(sessionId: string, runId: RunId): Promise<Run | null> {
    await this.prepare();
    const row = await this.client.get<RunRow>(
      `
        SELECT session_id, id, task_id, agent_type, agent_profile_id, agent_config_snapshot,
               status, input_snapshot, output, error, timeout_ms,
               started_at, finished_at, created_at, updated_at
        FROM task_v3_runs
        WHERE session_id = ? AND id = ?
      `,
      [sessionId, runId]
    );
    return row ? toRun(row) : null;
  }

  async listRuns(sessionId: string, query?: RunQuery): Promise<Run[]> {
    await this.prepare();
    const clauses = ['session_id = ?'];
    const params: unknown[] = [sessionId];
    if (query?.taskId) {
      clauses.push('task_id = ?');
      params.push(query.taskId);
    }
    if (query?.status) {
      clauses.push('status = ?');
      params.push(query.status);
    }
    const limit = query?.limit && query.limit > 0 ? Math.floor(query.limit) : 200;
    params.push(limit);
    const rows = await this.client.all<RunRow>(
      `
        SELECT session_id, id, task_id, agent_type, agent_profile_id, agent_config_snapshot,
               status, input_snapshot, output, error, timeout_ms,
               started_at, finished_at, created_at, updated_at
        FROM task_v3_runs
        WHERE ${clauses.join(' AND ')}
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `,
      params
    );
    return rows.map(toRun);
  }

  async listRunsByStatus(statuses: RunStatus[], limit = 500): Promise<Run[]> {
    await this.prepare();
    if (statuses.length === 0) return [];
    const placeholders = statuses.map(() => '?').join(', ');
    const rows = await this.client.all<RunRow>(
      `
        SELECT session_id, id, task_id, agent_type, agent_profile_id, agent_config_snapshot,
               status, input_snapshot, output, error, timeout_ms,
               started_at, finished_at, created_at, updated_at
        FROM task_v3_runs
        WHERE status IN (${placeholders})
        ORDER BY created_at ASC
        LIMIT ?
      `,
      [...statuses, Math.max(1, Math.floor(limit))]
    );
    return rows.map(toRun);
  }

  async updateRunStatus(
    sessionId: string,
    runId: RunId,
    status: RunStatus,
    now: string
  ): Promise<Run | null> {
    await this.prepare();
    const current = await this.getRun(sessionId, runId);
    if (!current) return null;
    if (TERMINAL_RUN_STATUSES.has(current.status)) {
      return current;
    }

    const startedAt =
      status === 'running' && !current.startedAt
        ? now
        : status === 'queued'
          ? null
          : (current.startedAt ?? null);

    await this.client.run(
      `
        UPDATE task_v3_runs
        SET status = ?, started_at = ?, updated_at = ?
        WHERE session_id = ? AND id = ?
      `,
      [status, startedAt, now, sessionId, runId]
    );
    return this.getRun(sessionId, runId);
  }

  async completeRun(sessionId: string, runId: RunId, input: CompleteRunInput): Promise<Run | null> {
    await this.prepare();
    const current = await this.getRun(sessionId, runId);
    if (!current) return null;
    if (TERMINAL_RUN_STATUSES.has(current.status)) {
      return current;
    }

    await this.client.run(
      `
        UPDATE task_v3_runs
        SET status = ?, output = ?, error = ?, finished_at = ?, updated_at = ?
        WHERE session_id = ? AND id = ?
      `,
      [
        input.status,
        input.output ?? null,
        input.error ?? null,
        input.now,
        input.now,
        sessionId,
        runId,
      ]
    );
    return this.getRun(sessionId, runId);
  }

  async appendRunEvent(sessionId: string, input: AppendRunEventInput): Promise<RunEvent> {
    await this.prepare();
    const existing = await this.getRun(sessionId, input.runId);
    if (!existing) {
      throw conflict('run not found for event append', { runId: input.runId });
    }

    const maxAttempts = 8;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const row = await this.client.get<{ next_seq: number }>(
        `
          SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq
          FROM task_v3_run_events
          WHERE session_id = ? AND run_id = ?
        `,
        [sessionId, input.runId]
      );
      const seq = Math.max(1, row?.next_seq ?? 1);

      try {
        await this.client.run(
          `
            INSERT INTO task_v3_run_events(
              session_id, run_id, seq, type, payload_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?)
          `,
          [
            sessionId,
            input.runId,
            seq,
            input.type,
            JSON.stringify(input.payload ?? {}),
            input.createdAt,
          ]
        );
        return {
          runId: input.runId,
          seq,
          type: input.type,
          payload: input.payload ?? {},
          createdAt: input.createdAt,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : '';
        const isDuplicateSeq =
          message.includes('unique constraint') || message.includes('constraint failed');
        if (!isDuplicateSeq || attempt === maxAttempts - 1) {
          throw error;
        }
      }
    }

    throw conflict('failed to append run event after retries', { runId: input.runId });
  }

  async listRunEvents(
    sessionId: string,
    runId: RunId,
    afterSeq = 0,
    limit = 200
  ): Promise<RunEvent[]> {
    await this.prepare();
    const rows = await this.client.all<RunEventRow>(
      `
        SELECT run_id, seq, type, payload_json, created_at
        FROM task_v3_run_events
        WHERE session_id = ? AND run_id = ? AND seq > ?
        ORDER BY seq ASC
        LIMIT ?
      `,
      [sessionId, runId, Math.max(0, afterSeq), Math.max(1, Math.floor(limit))]
    );
    return rows.map(toRunEvent);
  }

  async clearSession(sessionId: string): Promise<void> {
    await this.prepare();
    await this.client.run('DELETE FROM task_v3_runs WHERE session_id = ?', [sessionId]);
    await this.client.run('DELETE FROM task_v3_tasks WHERE session_id = ?', [sessionId]);
  }

  async gcRuns(params: { finishedBefore: string; limit: number }): Promise<number> {
    await this.prepare();

    return this.client.transaction(async () => {
      const rows = await this.client.all<{ session_id: string; id: string }>(
        `
          SELECT session_id, id
          FROM task_v3_runs
          WHERE status IN ('succeeded', 'failed', 'cancelled', 'timeout')
            AND finished_at IS NOT NULL
            AND finished_at < ?
          ORDER BY finished_at ASC
          LIMIT ?
        `,
        [params.finishedBefore, Math.max(1, Math.floor(params.limit))]
      );

      for (const row of rows) {
        await this.client.run('DELETE FROM task_v3_runs WHERE session_id = ? AND id = ?', [
          row.session_id,
          row.id,
        ]);
      }
      return rows.length;
    });
  }
}

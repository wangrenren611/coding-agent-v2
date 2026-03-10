import type { Message } from '../types';
import type {
  CliEventEnvelope,
  CompactionDroppedMessageRecord,
  ListConversationEventsOptions,
  ListRunLogsOptions,
  ListRunsOptions,
  ListRunsResult,
  RunRecord,
  RunLogRecord,
} from './contracts';
import type {
  ContextProjectionStorePort,
  EventStorePort,
  ExecutionStorePort,
  MessageProjectionStorePort,
  RunLogStorePort,
} from './ports';
import { AgentAppSqliteClient } from './sqlite-client';

interface RunRow {
  execution_id: string;
  run_id: string;
  conversation_id: string;
  status: RunRecord['status'];
  created_at_ms: number;
  updated_at_ms: number;
  step_index: number;
  started_at_ms: number | null;
  completed_at_ms: number | null;
  last_checkpoint_seq: number | null;
  terminal_reason: RunRecord['terminalReason'] | null;
  error_code: string | null;
  error_category: string | null;
  error_message: string | null;
}

interface EventRow {
  conversation_id: string;
  execution_id: string;
  seq: number;
  event_type: CliEventEnvelope['eventType'];
  payload_json: string;
  created_at_ms: number;
}

interface MessageRow {
  message_id: string;
  execution_id?: string;
  seq?: number;
  role: Message['role'];
  type: Message['type'];
  content_json: string;
  reasoning_content: string | null;
  tool_call_id: string | null;
  tool_calls_json: string | null;
  usage_json: string | null;
  metadata_json: string | null;
  created_at_ms: number;
}

interface CursorToken {
  updatedAt: number;
  executionId: string;
}

interface MessageEventPayload {
  message: Message;
  stepIndex?: number;
}

interface CompactionDroppedMessageRow {
  conversation_id: string;
  execution_id: string;
  step_index: number;
  removed_message_id: string;
  created_at_ms: number;
}

interface RunLogRow {
  id: number;
  execution_id: string;
  conversation_id: string;
  step_index: number | null;
  level: 'debug' | 'info' | 'warn' | 'error';
  code: string | null;
  source: string;
  message: string;
  error_json: string | null;
  context_json: string | null;
  data_json: string | null;
  created_at_ms: number;
}

const APP_MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS agent_v4_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at_ms INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runs (
        execution_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        step_index INTEGER NOT NULL DEFAULT 0,
        started_at_ms INTEGER,
        completed_at_ms INTEGER,
        last_checkpoint_seq INTEGER,
        terminal_reason TEXT,
        error_code TEXT,
        error_category TEXT,
        error_message TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_runs_conversation_updated
        ON runs(conversation_id, updated_at_ms DESC, execution_id DESC);

      CREATE TABLE IF NOT EXISTS events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        UNIQUE(conversation_id, seq)
      );
      CREATE INDEX IF NOT EXISTS idx_events_execution_seq
        ON events(execution_id, seq ASC);
      CREATE INDEX IF NOT EXISTS idx_events_conversation_seq
        ON events(conversation_id, seq ASC);

      CREATE TABLE IF NOT EXISTS messages (
        message_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        step_index INTEGER,
        role TEXT NOT NULL,
        type TEXT NOT NULL,
        content_json TEXT NOT NULL,
        reasoning_content TEXT,
        tool_call_id TEXT,
        tool_calls_json TEXT,
        usage_json TEXT,
        metadata_json TEXT,
        created_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_seq
        ON messages(conversation_id, seq ASC);
      CREATE INDEX IF NOT EXISTS idx_messages_execution_seq
        ON messages(execution_id, seq ASC);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS context_messages (
        conversation_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        step_index INTEGER,
        role TEXT NOT NULL,
        type TEXT NOT NULL,
        content_json TEXT NOT NULL,
        reasoning_content TEXT,
        tool_call_id TEXT,
        tool_calls_json TEXT,
        usage_json TEXT,
        metadata_json TEXT,
        created_at_ms INTEGER NOT NULL,
        PRIMARY KEY (conversation_id, message_id)
      );
      CREATE INDEX IF NOT EXISTS idx_context_messages_conversation_seq
        ON context_messages(conversation_id, seq ASC);
      CREATE INDEX IF NOT EXISTS idx_context_messages_execution_seq
        ON context_messages(execution_id, seq ASC);

      CREATE TABLE IF NOT EXISTS compaction_dropped_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        execution_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        removed_message_id TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        UNIQUE(execution_id, step_index, removed_message_id)
      );
      CREATE INDEX IF NOT EXISTS idx_compaction_dropped_execution_step
        ON compaction_dropped_messages(execution_id, step_index ASC, id ASC);
      CREATE INDEX IF NOT EXISTS idx_compaction_dropped_conversation
        ON compaction_dropped_messages(conversation_id, id ASC);

      INSERT OR IGNORE INTO context_messages (
        conversation_id,
        execution_id,
        message_id,
        seq,
        step_index,
        role,
        type,
        content_json,
        reasoning_content,
        tool_call_id,
        tool_calls_json,
        usage_json,
        metadata_json,
        created_at_ms
      )
      SELECT
        conversation_id,
        execution_id,
        message_id,
        seq,
        step_index,
        role,
        type,
        content_json,
        reasoning_content,
        tool_call_id,
        tool_calls_json,
        usage_json,
        metadata_json,
        created_at_ms
      FROM messages;
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE IF NOT EXISTS run_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        step_index INTEGER,
        level TEXT NOT NULL CHECK(level IN ('debug', 'info', 'warn', 'error')),
        code TEXT,
        source TEXT NOT NULL,
        message TEXT NOT NULL,
        error_json TEXT,
        context_json TEXT,
        data_json TEXT,
        created_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_run_logs_execution_created
        ON run_logs(execution_id, created_at_ms ASC, id ASC);
      CREATE INDEX IF NOT EXISTS idx_run_logs_execution_level_created
        ON run_logs(execution_id, level, created_at_ms ASC, id ASC);
    `,
  },
];

export class SqliteAgentAppStore
  implements
    ExecutionStorePort,
    EventStorePort,
    MessageProjectionStorePort,
    ContextProjectionStorePort,
    RunLogStorePort
{
  private readonly client: AgentAppSqliteClient;
  private prepared = false;
  private preparePromise: Promise<void> | null = null;
  private mutationChain: Promise<void> = Promise.resolve();

  constructor(private readonly dbPath: string) {
    this.client = new AgentAppSqliteClient(dbPath);
  }

  async prepare(): Promise<void> {
    if (this.prepared) {
      return;
    }
    if (this.preparePromise) {
      await this.preparePromise;
      return;
    }

    this.preparePromise = (async () => {
      await this.client.prepare();
      await this.withMutationLock(async () => {
        await runAppMigrations(this.client);
      });
      this.prepared = true;
    })();

    try {
      await this.preparePromise;
    } finally {
      this.preparePromise = null;
    }
  }

  async close(): Promise<void> {
    await this.client.close();
    this.prepared = false;
  }

  getDatabasePath(): string {
    return this.dbPath;
  }

  async create(run: RunRecord): Promise<void> {
    await this.prepare();
    await this.withMutationLock(async () => {
      await this.client.run(
        `
          INSERT INTO runs (
            execution_id,
            run_id,
            conversation_id,
            status,
            created_at_ms,
            updated_at_ms,
            step_index,
            started_at_ms,
            completed_at_ms,
            last_checkpoint_seq,
            terminal_reason,
            error_code,
            error_category,
            error_message
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          run.executionId,
          run.runId,
          run.conversationId,
          run.status,
          run.createdAt,
          run.updatedAt,
          run.stepIndex,
          run.startedAt ?? null,
          run.completedAt ?? null,
          run.lastCheckpointSeq ?? null,
          run.terminalReason ?? null,
          run.errorCode ?? null,
          run.errorCategory ?? null,
          run.errorMessage ?? null,
        ]
      );
    });
  }

  async patch(executionId: string, patch: Partial<RunRecord>): Promise<void> {
    await this.prepare();
    const updates: string[] = [];
    const params: unknown[] = [];

    if (typeof patch.runId === 'string') {
      updates.push('run_id = ?');
      params.push(patch.runId);
    }
    if (typeof patch.conversationId === 'string') {
      updates.push('conversation_id = ?');
      params.push(patch.conversationId);
    }
    if (typeof patch.status === 'string') {
      updates.push('status = ?');
      params.push(patch.status);
    }
    if (typeof patch.stepIndex === 'number') {
      updates.push('step_index = ?');
      params.push(patch.stepIndex);
    }
    if ('startedAt' in patch) {
      updates.push('started_at_ms = ?');
      params.push(patch.startedAt ?? null);
    }
    if ('completedAt' in patch) {
      updates.push('completed_at_ms = ?');
      params.push(patch.completedAt ?? null);
    }
    if ('lastCheckpointSeq' in patch) {
      updates.push('last_checkpoint_seq = ?');
      params.push(patch.lastCheckpointSeq ?? null);
    }
    if ('terminalReason' in patch) {
      updates.push('terminal_reason = ?');
      params.push(patch.terminalReason ?? null);
    }
    if ('errorCode' in patch) {
      updates.push('error_code = ?');
      params.push(patch.errorCode ?? null);
    }
    if ('errorCategory' in patch) {
      updates.push('error_category = ?');
      params.push(patch.errorCategory ?? null);
    }
    if ('errorMessage' in patch) {
      updates.push('error_message = ?');
      params.push(patch.errorMessage ?? null);
    }

    updates.push('updated_at_ms = ?');
    params.push(typeof patch.updatedAt === 'number' ? patch.updatedAt : Date.now());
    params.push(executionId);

    await this.withMutationLock(async () => {
      await this.client.run(`UPDATE runs SET ${updates.join(', ')} WHERE execution_id = ?`, params);
    });
  }

  async get(executionId: string): Promise<RunRecord | null> {
    await this.prepare();
    const row = await this.client.get<RunRow>(
      `
        SELECT
          execution_id,
          run_id,
          conversation_id,
          status,
          created_at_ms,
          updated_at_ms,
          step_index,
          started_at_ms,
          completed_at_ms,
          last_checkpoint_seq,
          terminal_reason,
          error_code,
          error_category,
          error_message
        FROM runs
        WHERE execution_id = ?
      `,
      [executionId]
    );

    return row ? mapRunRow(row) : null;
  }

  async listByConversation(
    conversationId: string,
    opts: ListRunsOptions = {}
  ): Promise<ListRunsResult> {
    await this.prepare();
    const limit = clampLimit(opts.limit);
    const params: unknown[] = [conversationId];
    const filters: string[] = ['conversation_id = ?'];

    if (opts.statuses && opts.statuses.length > 0) {
      const placeholders = opts.statuses.map(() => '?').join(', ');
      filters.push(`status IN (${placeholders})`);
      params.push(...opts.statuses);
    }

    const cursor = decodeCursor(opts.cursor);
    if (cursor) {
      filters.push('(updated_at_ms < ? OR (updated_at_ms = ? AND execution_id < ?))');
      params.push(cursor.updatedAt, cursor.updatedAt, cursor.executionId);
    }

    params.push(limit + 1);

    const rows = await this.client.all<RunRow>(
      `
        SELECT
          execution_id,
          run_id,
          conversation_id,
          status,
          created_at_ms,
          updated_at_ms,
          step_index,
          started_at_ms,
          completed_at_ms,
          last_checkpoint_seq,
          terminal_reason,
          error_code,
          error_category,
          error_message
        FROM runs
        WHERE ${filters.join(' AND ')}
        ORDER BY updated_at_ms DESC, execution_id DESC
        LIMIT ?
      `,
      params
    );

    const hasNext = rows.length > limit;
    const selected = hasNext ? rows.slice(0, limit) : rows;
    const items = selected.map(mapRunRow);
    const tail = items[items.length - 1];

    return {
      items,
      nextCursor: hasNext && tail ? encodeCursor(tail.updatedAt, tail.executionId) : undefined,
    };
  }

  async appendAutoSeq(event: Omit<CliEventEnvelope, 'seq'>): Promise<CliEventEnvelope> {
    await this.prepare();

    return this.withMutationLock(async () => {
      return this.client.transaction(async () => {
        const row = await this.client.get<{ max_seq: number | null }>(
          'SELECT MAX(seq) AS max_seq FROM events WHERE conversation_id = ?',
          [event.conversationId]
        );
        const seq = ((row?.max_seq ?? 0) as number) + 1;
        const payloadJson = JSON.stringify(event.data ?? null);

        await this.client.run(
          `
            INSERT INTO events (
              conversation_id,
              execution_id,
              seq,
              event_type,
              payload_json,
              created_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?)
          `,
          [
            event.conversationId,
            event.executionId,
            seq,
            event.eventType,
            payloadJson,
            event.createdAt,
          ]
        );

        return {
          ...event,
          seq,
        };
      });
    });
  }

  async append(event: CliEventEnvelope): Promise<void> {
    await this.prepare();
    await this.withMutationLock(async () => {
      await this.client.run(
        `
          INSERT INTO events (
            conversation_id,
            execution_id,
            seq,
            event_type,
            payload_json,
            created_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
          event.conversationId,
          event.executionId,
          event.seq,
          event.eventType,
          JSON.stringify(event.data ?? null),
          event.createdAt,
        ]
      );
    });
  }

  async listByRun(executionId: string): Promise<CliEventEnvelope[]> {
    await this.prepare();
    const rows = await this.client.all<EventRow>(
      `
        SELECT
          conversation_id,
          execution_id,
          seq,
          event_type,
          payload_json,
          created_at_ms
        FROM events
        WHERE execution_id = ?
        ORDER BY seq ASC
      `,
      [executionId]
    );
    return rows.map(mapEventRow);
  }

  async listEventsByConversation(
    conversationId: string,
    opts: ListConversationEventsOptions = {}
  ): Promise<CliEventEnvelope[]> {
    await this.prepare();
    const filters = ['conversation_id = ?'];
    const params: unknown[] = [conversationId];

    if (typeof opts.fromSeq === 'number' && opts.fromSeq > 0) {
      filters.push('seq >= ?');
      params.push(opts.fromSeq);
    }

    if (typeof opts.limit === 'number' && opts.limit > 0) {
      params.push(opts.limit);
      const rows = await this.client.all<EventRow>(
        `
          SELECT
            conversation_id,
            execution_id,
            seq,
            event_type,
            payload_json,
            created_at_ms
          FROM events
          WHERE ${filters.join(' AND ')}
          ORDER BY seq ASC
          LIMIT ?
        `,
        params
      );
      return rows.map(mapEventRow);
    }

    const rows = await this.client.all<EventRow>(
      `
        SELECT
          conversation_id,
          execution_id,
          seq,
          event_type,
          payload_json,
          created_at_ms
        FROM events
        WHERE ${filters.join(' AND ')}
        ORDER BY seq ASC
      `,
      params
    );
    return rows.map(mapEventRow);
  }

  async upsertFromEvent(event: CliEventEnvelope): Promise<void> {
    await this.prepare();
    const payload = extractMessagePayload(event);
    if (!payload) {
      return;
    }

    const { message, stepIndex } = payload;
    await this.withMutationLock(async () => {
      await this.client.transaction(async () => {
        await upsertMessageIntoHistory(this.client, event, message, stepIndex);
        await upsertMessageIntoContext(this.client, event, message, stepIndex);
      });
    });
  }

  async list(conversationId: string): Promise<Message[]> {
    await this.prepare();
    const rows = await this.client.all<MessageRow>(
      `
        SELECT
          message_id,
          role,
          type,
          content_json,
          reasoning_content,
          tool_call_id,
          tool_calls_json,
          usage_json,
          metadata_json,
          created_at_ms
        FROM messages
        WHERE conversation_id = ?
        ORDER BY seq ASC
      `,
      [conversationId]
    );

    return rows.map((row) => mapMessageRow(row));
  }

  async listContext(conversationId: string): Promise<Message[]> {
    await this.prepare();
    const rows = await this.client.all<MessageRow>(
      `
        SELECT
          message_id,
          role,
          type,
          content_json,
          reasoning_content,
          tool_call_id,
          tool_calls_json,
          usage_json,
          metadata_json,
          created_at_ms
        FROM context_messages
        WHERE conversation_id = ?
        ORDER BY seq ASC
      `,
      [conversationId]
    );

    return rows.map((row) => mapMessageRow(row));
  }

  async applyCompaction(input: {
    conversationId: string;
    executionId: string;
    stepIndex: number;
    removedMessageIds: string[];
    createdAt: number;
  }): Promise<void> {
    await this.prepare();
    const deduplicated = Array.from(
      new Set(input.removedMessageIds.filter((messageId) => messageId.trim().length > 0))
    );
    if (deduplicated.length === 0) {
      return;
    }

    await this.withMutationLock(async () => {
      await this.client.transaction(async () => {
        for (const removedMessageId of deduplicated) {
          await this.client.run(
            `
              INSERT OR IGNORE INTO compaction_dropped_messages (
                conversation_id,
                execution_id,
                step_index,
                removed_message_id,
                created_at_ms
              ) VALUES (?, ?, ?, ?, ?)
            `,
            [
              input.conversationId,
              input.executionId,
              input.stepIndex,
              removedMessageId,
              input.createdAt,
            ]
          );
        }

        for (const idsChunk of chunkStrings(deduplicated, 200)) {
          const placeholders = idsChunk.map(() => '?').join(', ');
          await this.client.run(
            `
              DELETE FROM context_messages
              WHERE conversation_id = ?
                AND message_id IN (${placeholders})
            `,
            [input.conversationId, ...idsChunk]
          );
        }
      });
    });
  }

  async listDroppedMessages(
    executionId: string,
    opts: { stepIndex?: number; limit?: number } = {}
  ): Promise<CompactionDroppedMessageRecord[]> {
    await this.prepare();
    const filters = ['execution_id = ?'];
    const params: unknown[] = [executionId];

    if (typeof opts.stepIndex === 'number' && Number.isFinite(opts.stepIndex)) {
      filters.push('step_index = ?');
      params.push(Math.floor(opts.stepIndex));
    }

    const effectiveLimit =
      typeof opts.limit === 'number' && Number.isFinite(opts.limit) && opts.limit > 0
        ? Math.floor(opts.limit)
        : 1000;
    params.push(effectiveLimit);

    const rows = await this.client.all<CompactionDroppedMessageRow>(
      `
        SELECT
          conversation_id,
          execution_id,
          step_index,
          removed_message_id,
          created_at_ms
        FROM compaction_dropped_messages
        WHERE ${filters.join(' AND ')}
        ORDER BY step_index ASC, id ASC
        LIMIT ?
      `,
      params
    );

    return rows.map((row) => ({
      conversationId: row.conversation_id,
      executionId: row.execution_id,
      stepIndex: row.step_index,
      removedMessageId: row.removed_message_id,
      createdAt: row.created_at_ms,
    }));
  }

  async appendRunLog(record: RunLogRecord): Promise<void> {
    await this.prepare();
    await this.withMutationLock(async () => {
      await this.client.run(
        `
          INSERT INTO run_logs (
            execution_id,
            conversation_id,
            step_index,
            level,
            code,
            source,
            message,
            error_json,
            context_json,
            data_json,
            created_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          record.executionId,
          record.conversationId,
          record.stepIndex ?? null,
          record.level,
          record.code ?? null,
          record.source,
          record.message,
          record.error ? JSON.stringify(record.error) : null,
          record.context ? JSON.stringify(record.context) : null,
          record.data !== undefined ? JSON.stringify(record.data) : null,
          record.createdAt,
        ]
      );
    });
  }

  async listRunLogs(executionId: string, opts: ListRunLogsOptions = {}): Promise<RunLogRecord[]> {
    await this.prepare();
    const filters = ['execution_id = ?'];
    const params: unknown[] = [executionId];

    if (opts.level) {
      filters.push('level = ?');
      params.push(opts.level);
    }

    params.push(clampLimit(opts.limit));

    const rows = await this.client.all<RunLogRow>(
      `
        SELECT
          id,
          execution_id,
          conversation_id,
          step_index,
          level,
          code,
          source,
          message,
          error_json,
          context_json,
          data_json,
          created_at_ms
        FROM run_logs
        WHERE ${filters.join(' AND ')}
        ORDER BY created_at_ms ASC, id ASC
        LIMIT ?
      `,
      params
    );

    return rows.map(mapRunLogRow);
  }

  private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationChain;
    let release: () => void = () => undefined;
    this.mutationChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export function createSqliteAgentAppStore(dbPath: string): SqliteAgentAppStore {
  return new SqliteAgentAppStore(dbPath);
}

async function upsertMessageIntoHistory(
  client: AgentAppSqliteClient,
  event: CliEventEnvelope,
  message: Message,
  stepIndex?: number
): Promise<void> {
  const serialized = serializeMessage(event, message, stepIndex);
  await client.run(
    `
      INSERT INTO messages (
        message_id,
        conversation_id,
        execution_id,
        seq,
        step_index,
        role,
        type,
        content_json,
        reasoning_content,
        tool_call_id,
        tool_calls_json,
        usage_json,
        metadata_json,
        created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(message_id) DO UPDATE SET
        conversation_id = excluded.conversation_id,
        execution_id = excluded.execution_id,
        seq = excluded.seq,
        step_index = excluded.step_index,
        role = excluded.role,
        type = excluded.type,
        content_json = excluded.content_json,
        reasoning_content = excluded.reasoning_content,
        tool_call_id = excluded.tool_call_id,
        tool_calls_json = excluded.tool_calls_json,
        usage_json = excluded.usage_json,
        metadata_json = excluded.metadata_json,
        created_at_ms = excluded.created_at_ms
    `,
    serialized
  );
}

async function upsertMessageIntoContext(
  client: AgentAppSqliteClient,
  event: CliEventEnvelope,
  message: Message,
  stepIndex?: number
): Promise<void> {
  const serialized = serializeMessage(event, message, stepIndex);
  await client.run(
    `
      INSERT INTO context_messages (
        message_id,
        conversation_id,
        execution_id,
        seq,
        step_index,
        role,
        type,
        content_json,
        reasoning_content,
        tool_call_id,
        tool_calls_json,
        usage_json,
        metadata_json,
        created_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id, message_id) DO UPDATE SET
        execution_id = excluded.execution_id,
        seq = excluded.seq,
        step_index = excluded.step_index,
        role = excluded.role,
        type = excluded.type,
        content_json = excluded.content_json,
        reasoning_content = excluded.reasoning_content,
        tool_call_id = excluded.tool_call_id,
        tool_calls_json = excluded.tool_calls_json,
        usage_json = excluded.usage_json,
        metadata_json = excluded.metadata_json,
        created_at_ms = excluded.created_at_ms
    `,
    serialized
  );
}

function serializeMessage(
  event: CliEventEnvelope,
  message: Message,
  stepIndex?: number
): unknown[] {
  return [
    message.messageId,
    event.conversationId,
    event.executionId,
    event.seq,
    stepIndex ?? null,
    message.role,
    message.type,
    JSON.stringify(message.content ?? null),
    message.reasoning_content ?? null,
    message.tool_call_id ?? null,
    message.tool_calls ? JSON.stringify(message.tool_calls) : null,
    message.usage ? JSON.stringify(message.usage) : null,
    message.metadata ? JSON.stringify(message.metadata) : null,
    message.timestamp,
  ];
}

function mapMessageRow(row: MessageRow): Message {
  return {
    messageId: row.message_id,
    role: row.role,
    type: row.type,
    content: parseJsonOrDefault(row.content_json, ''),
    reasoning_content: row.reasoning_content ?? undefined,
    tool_call_id: row.tool_call_id ?? undefined,
    tool_calls: row.tool_calls_json
      ? (parseJsonOrDefault(row.tool_calls_json, undefined) as Message['tool_calls'])
      : undefined,
    usage: row.usage_json
      ? (parseJsonOrDefault(row.usage_json, undefined) as Message['usage'])
      : undefined,
    metadata: row.metadata_json
      ? (parseJsonOrDefault(row.metadata_json, undefined) as Message['metadata'])
      : undefined,
    timestamp: row.created_at_ms,
  };
}

function chunkStrings(items: string[], chunkSize: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function mapRunRow(row: RunRow): RunRecord {
  return {
    executionId: row.execution_id,
    runId: row.run_id,
    conversationId: row.conversation_id,
    status: row.status,
    createdAt: row.created_at_ms,
    updatedAt: row.updated_at_ms,
    stepIndex: row.step_index,
    startedAt: row.started_at_ms ?? undefined,
    completedAt: row.completed_at_ms ?? undefined,
    lastCheckpointSeq: row.last_checkpoint_seq ?? undefined,
    terminalReason: row.terminal_reason ?? undefined,
    errorCode: row.error_code ?? undefined,
    errorCategory: row.error_category ?? undefined,
    errorMessage: row.error_message ?? undefined,
  };
}

function mapEventRow(row: EventRow): CliEventEnvelope {
  return {
    conversationId: row.conversation_id,
    executionId: row.execution_id,
    seq: row.seq,
    eventType: row.event_type,
    data: parseJsonOrDefault(row.payload_json, null),
    createdAt: row.created_at_ms,
  };
}

function mapRunLogRow(row: RunLogRow): RunLogRecord {
  return {
    id: row.id,
    executionId: row.execution_id,
    conversationId: row.conversation_id,
    stepIndex: row.step_index ?? undefined,
    level: row.level,
    code: row.code ?? undefined,
    source: row.source,
    message: row.message,
    error: row.error_json
      ? (parseJsonOrDefault(row.error_json, undefined) as RunLogRecord['error'])
      : undefined,
    context: row.context_json
      ? (parseJsonOrDefault(row.context_json, undefined) as RunLogRecord['context'])
      : undefined,
    data: row.data_json ? parseJsonOrDefault(row.data_json, undefined) : undefined,
    createdAt: row.created_at_ms,
  };
}

function clampLimit(limit?: number): number {
  if (!Number.isFinite(limit)) {
    return 20;
  }
  return Math.min(100, Math.max(1, Math.floor(Number(limit))));
}

function encodeCursor(updatedAt: number, executionId: string): string {
  return `${updatedAt}:${executionId}`;
}

function decodeCursor(cursor?: string): CursorToken | null {
  if (!cursor) {
    return null;
  }
  const splitIndex = cursor.indexOf(':');
  if (splitIndex <= 0 || splitIndex >= cursor.length - 1) {
    return null;
  }
  const updatedAtRaw = cursor.slice(0, splitIndex);
  const executionId = cursor.slice(splitIndex + 1);
  const updatedAt = Number(updatedAtRaw);
  if (!Number.isFinite(updatedAt) || executionId.length === 0) {
    return null;
  }
  return {
    updatedAt,
    executionId,
  };
}

function parseJsonOrDefault<T>(raw: string, defaultValue: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMessage(value: unknown): value is Message {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.messageId === 'string' &&
    typeof value.role === 'string' &&
    typeof value.type === 'string' &&
    typeof value.timestamp === 'number' &&
    'content' in value
  );
}

function extractMessagePayload(event: CliEventEnvelope): MessageEventPayload | null {
  if (event.eventType !== 'user_message' && event.eventType !== 'assistant_message') {
    return null;
  }

  if (isMessage(event.data)) {
    return { message: event.data };
  }

  if (!isRecord(event.data) || !isMessage(event.data.message)) {
    return null;
  }

  const stepIndex = event.data.stepIndex;
  return {
    message: event.data.message,
    stepIndex: typeof stepIndex === 'number' ? stepIndex : undefined,
  };
}

async function runAppMigrations(client: AgentAppSqliteClient): Promise<void> {
  await client.exec(`
    CREATE TABLE IF NOT EXISTS agent_v4_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at_ms INTEGER NOT NULL
    );
  `);

  const rows = await client.all<{ version: number }>(
    'SELECT version FROM agent_v4_schema_migrations ORDER BY version ASC'
  );
  const applied = new Set(rows.map((row) => row.version));

  for (const migration of APP_MIGRATIONS) {
    if (applied.has(migration.version)) {
      continue;
    }
    await client.transaction(async () => {
      await client.exec(migration.sql);
      await client.run(
        'INSERT INTO agent_v4_schema_migrations(version, applied_at_ms) VALUES(?, ?)',
        [migration.version, Date.now()]
      );
    });
  }
}

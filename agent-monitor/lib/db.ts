import { execFileSync } from 'child_process';

const DB_PATH = 'C:\\Users\\Administrator\\.renx\\data.db';
const MAX_BUFFER = 10 * 1024 * 1024;

function runSqliteCli(sql: string): string {
  return execFileSync('sqlite3', ['-json', DB_PATH, sql], {
    encoding: 'utf-8',
    maxBuffer: MAX_BUFFER,
  });
}

function runPythonSqlite(sql: string): string {
  const pyScript = [
    'import json, sqlite3, sys',
    'db_path, query = sys.argv[1], sys.argv[2]',
    'conn = sqlite3.connect(db_path)',
    'conn.row_factory = sqlite3.Row',
    'cur = conn.cursor()',
    'cur.execute(query)',
    'rows = [dict(r) for r in cur.fetchall()]',
    'print(json.dumps(rows, ensure_ascii=False))',
    'conn.close()',
  ].join('; ');

  return execFileSync('python', ['-c', pyScript, DB_PATH, sql], {
    encoding: 'utf-8',
    maxBuffer: MAX_BUFFER,
  });
}

function query<T>(sql: string): T[] {
  try {
    const result = runSqliteCli(sql);
    const trimmed = result.trim();
    if (!trimmed) { return []; }
    return JSON.parse(trimmed) as T[];
  } catch (cliError) {
    try {
      const result = runPythonSqlite(sql);
      const trimmed = result.trim();
      if (!trimmed) { return []; }
      return JSON.parse(trimmed) as T[];
    } catch (pythonError) {
      console.error('Database query error (sqlite3 + python fallback failed):', {
        cliError,
        pythonError,
      });
      return [];
    }
  }
}

function queryOne<T>(sql: string): T | null {
  const results = query<T>(sql);
  return results.length > 0 ? results[0] : null;
}

export interface Run {
  execution_id: string;
  run_id: string;
  conversation_id: string;
  status: string;
  created_at_ms: number;
  updated_at_ms: number;
  step_index: number;
  started_at_ms: number | null;
  completed_at_ms: number | null;
  terminal_reason: string | null;
  error_code: string | null;
  error_category: string | null;
  error_message: string | null;
}

export interface RunLog {
  id: number;
  execution_id: string;
  step_index: number | null;
  level: string;
  code: string | null;
  source: string;
  message: string;
  error_json: string | null;
  created_at_ms: number;
}

export interface Message {
  message_id: string;
  execution_id: string;
  step_index: number | null;
  role: string;
  type: string;
  usage_json: string | null;
  created_at_ms: number;
}

export interface RunStats {
  execution_id: string;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  duration_ms: number;
  message_count: number;
  tool_call_count: number;
}

export function getRuns(limit = 100): Run[] {
  return query<Run>(`SELECT * FROM runs ORDER BY created_at_ms DESC LIMIT ${limit}`);
}

export function getRunById(executionId: string): Run | null {
  return queryOne<Run>(`SELECT * FROM runs WHERE execution_id = '${executionId}'`);
}

export function getErrorLogs(limit = 100): RunLog[] {
  return query<RunLog>(
    `SELECT * FROM run_logs WHERE level IN ('error', 'warning') ORDER BY created_at_ms DESC LIMIT ${limit}`
  );
}

export function getRunLogs(executionId: string, limit = 100): RunLog[] {
  return query<RunLog>(
    `SELECT * FROM run_logs WHERE execution_id = '${executionId}' ORDER BY created_at_ms DESC LIMIT ${limit}`
  );
}

export function getRunStats(executionId: string): RunStats | null {
  const messages = query<Message>(
    `SELECT * FROM messages WHERE execution_id = '${executionId}'`
  );

  const run = getRunById(executionId);
  if (!run) { return null; }

  let totalTokens = 0;
  let promptTokens = 0;
  let completionTokens = 0;

  for (const msg of messages) {
    if (msg.usage_json) {
      try {
        const usage = JSON.parse(msg.usage_json);
        totalTokens += usage.total_tokens || 0;
        promptTokens += usage.prompt_tokens || 0;
        completionTokens += usage.completion_tokens || 0;
      } catch {
        // Ignore parse errors
      }
    }
  }

  const durationMs =
    run.completed_at_ms && run.started_at_ms
      ? run.completed_at_ms - run.started_at_ms
      : 0;

  const toolCallCount = query<{ count: number }>(
    `SELECT COUNT(*) as count FROM messages WHERE execution_id = '${executionId}' AND type = 'tool_call'`
  );

  return {
    execution_id: executionId,
    total_tokens: totalTokens,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    duration_ms: durationMs,
    message_count: messages.length,
    tool_call_count: toolCallCount[0]?.count || 0,
  };
}

export interface AggregateStats {
  total_runs: number;
  running_runs: number;
  completed_runs: number;
  failed_runs: number;
  cancelled_runs: number;
  total_tokens: number;
  avg_duration_ms: number;
  total_errors: number;
}

export function getAggregateStats(): AggregateStats {
  const runs = query<Run>('SELECT * FROM runs');
  const errors = query<{ count: number }>(
    "SELECT COUNT(*) as count FROM run_logs WHERE level = 'error'"
  );

  let totalTokens = 0;
  let totalDuration = 0;
  let completedWithDuration = 0;

  for (const run of runs) {
    const stats = getRunStats(run.execution_id);
    if (stats) {
      totalTokens += stats.total_tokens;
      if (stats.duration_ms > 0) {
        totalDuration += stats.duration_ms;
        completedWithDuration++;
      }
    }
  }

  return {
    total_runs: runs.length,
    running_runs: runs.filter(r => r.status === 'RUNNING').length,
    completed_runs: runs.filter(r => r.status === 'COMPLETED').length,
    failed_runs: runs.filter(r => r.status === 'FAILED').length,
    cancelled_runs: runs.filter(r => r.status === 'CANCELLED').length,
    total_tokens: totalTokens,
    avg_duration_ms: completedWithDuration > 0 ? Math.round(totalDuration / completedWithDuration) : 0,
    total_errors: errors[0]?.count || 0,
  };
}

export interface DailyStats {
  date: string;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  run_count: number;
}

export function getDailyStats(days = 7): DailyStats[] {
  const result = query<{
    date: string;
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    run_count: number;
  }>(`
    SELECT 
      date(created_at_ms / 1000, 'unixepoch') as date,
      0 as total_tokens,
      0 as prompt_tokens,
      0 as completion_tokens,
      COUNT(*) as run_count
    FROM runs
    WHERE created_at_ms > (strftime('%s', 'now') - ${days * 86400}) * 1000
    GROUP BY date
    ORDER BY date ASC
  `);

  // Enrich with token data from messages
  return result.map(day => {
    const dayRuns = query<Run>(
      `SELECT * FROM runs WHERE date(created_at_ms / 1000, 'unixepoch') = '${day.date}'`
    );

    let totalTokens = 0;
    let promptTokens = 0;
    let completionTokens = 0;

    for (const run of dayRuns) {
      const stats = getRunStats(run.execution_id);
      if (stats) {
        totalTokens += stats.total_tokens;
        promptTokens += stats.prompt_tokens;
        completionTokens += stats.completion_tokens;
      }
    }

    return {
      date: day.date,
      total_tokens: totalTokens,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      run_count: day.run_count,
    };
  });
}

export interface ModelUsage {
  model: string;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  message_count: number;
  run_count: number;
}

export function getLogsByExecution(executionId: string, limit = 200): RunLog[] {
  return query<RunLog>(
    `SELECT * FROM run_logs WHERE execution_id = '${executionId}' ORDER BY created_at_ms DESC LIMIT ${limit}`
  );
}

export interface TokenUsageByDay {
  date: string;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  run_count: number;
}

export function getTokenUsageByDay(days = 7): TokenUsageByDay[] {
  return query<TokenUsageByDay>(`
    SELECT 
      date(created_at_ms / 1000, 'unixepoch') as date,
      0 as total_tokens,
      0 as prompt_tokens,
      0 as completion_tokens,
      COUNT(*) as run_count
    FROM runs
    WHERE created_at_ms > (strftime('%s', 'now') - ${days * 86400}) * 1000
    GROUP BY date
    ORDER BY date ASC
  `);
}

export interface StatusDistribution {
  status: string;
  count: number;
}

export function getStatusDistribution(): StatusDistribution[] {
  return query<StatusDistribution>(`
    SELECT status, COUNT(*) as count
    FROM runs
    GROUP BY status
  `);
}

export interface TokenUsageByModel {
  model: string;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  message_count: number;
  run_count: number;
}

export function getTokenUsageByModel(): TokenUsageByModel[] {
  return getModelUsage();
}

export interface TokenUsageByExecution {
  execution_id: string;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  message_count: number;
}

export function getTokenUsageByExecution(): TokenUsageByExecution[] {
  const messages = query<Message>(
    "SELECT * FROM messages WHERE role = 'assistant' AND usage_json IS NOT NULL"
  );

  const execMap = new Map<string, TokenUsageByExecution>();

  for (const msg of messages) {
    if (!msg.usage_json) { continue; }
    try {
      const usage = JSON.parse(msg.usage_json);
      if (!execMap.has(msg.execution_id)) {
        execMap.set(msg.execution_id, {
          execution_id: msg.execution_id,
          total_tokens: 0,
          prompt_tokens: 0,
          completion_tokens: 0,
          message_count: 0,
        });
      }
      const entry = execMap.get(msg.execution_id)!;
      entry.total_tokens += usage.total_tokens || 0;
      entry.prompt_tokens += usage.prompt_tokens || 0;
      entry.completion_tokens += usage.completion_tokens || 0;
      entry.message_count += 1;
    } catch { /* ignore */ }
  }

  return Array.from(execMap.values()).sort((a, b) => b.total_tokens - a.total_tokens);
}

export function getModelUsage(): ModelUsage[] {
  // Model info is in metadata_json.modelLabel, token counts in usage_json
  const rows = query<{
    model: string;
    usage_json: string;
    execution_id: string;
  }>(
    "SELECT json_extract(metadata_json, '$.modelLabel') as model, usage_json, execution_id FROM messages WHERE role = 'assistant' AND usage_json IS NOT NULL AND metadata_json IS NOT NULL"
  );

  const modelMap = new Map<string, ModelUsage>();
  const modelRuns = new Map<string, Set<string>>();

  for (const row of rows) {
    const model = row.model || 'unknown';

    try {
      const usage = JSON.parse(row.usage_json);

      if (!modelMap.has(model)) {
        modelMap.set(model, {
          model,
          total_tokens: 0,
          prompt_tokens: 0,
          completion_tokens: 0,
          message_count: 0,
          run_count: 0,
        });
        modelRuns.set(model, new Set());
      }

      const entry = modelMap.get(model)!;
      entry.total_tokens += usage.total_tokens || 0;
      entry.prompt_tokens += usage.prompt_tokens || 0;
      entry.completion_tokens += usage.completion_tokens || 0;
      entry.message_count += 1;
      modelRuns.get(model)!.add(row.execution_id);
    } catch {
      // Ignore parse errors
    }
  }

  // Set run counts
  for (const [model, entry] of Array.from(modelMap.entries())) {
    entry.run_count = modelRuns.get(model)?.size || 0;
  }

  return Array.from(modelMap.values()).sort((a, b) => b.total_tokens - a.total_tokens);
}

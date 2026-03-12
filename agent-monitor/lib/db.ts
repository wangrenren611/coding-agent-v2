import { execSync } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';

const DB_PATH = join(homedir(), '.agent-v4', 'agent.db');

function query<T>(sql: string): T[] {
  try {
    const result = execSync(`sqlite3 -json "${DB_PATH}" "${sql.replace(/"/g, '\\"')}"`, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return JSON.parse(result) as T[];
  } catch (error) {
    console.error('Database query error:', error);
    return [];
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
  return query<RunLog>(`SELECT * FROM run_logs WHERE level = 'error' ORDER BY created_at_ms DESC LIMIT ${limit}`);
}

export function getLogsByExecution(executionId: string, limit = 200): RunLog[] {
  return query<RunLog>(`SELECT * FROM run_logs WHERE execution_id = '${executionId}' ORDER BY created_at_ms ASC LIMIT ${limit}`);
}

export function getRunStats(executionId: string): RunStats | null {
  const messages = query<{ usage_json: string }>(
    `SELECT usage_json FROM messages WHERE execution_id = '${executionId}' AND usage_json IS NOT NULL`
  );

  let total_tokens = 0;
  let prompt_tokens = 0;
  let completion_tokens = 0;

  for (const msg of messages) {
    try {
      const usage = JSON.parse(msg.usage_json);
      total_tokens += usage.total_tokens || 0;
      prompt_tokens += usage.prompt_tokens || 0;
      completion_tokens += usage.completion_tokens || 0;
    } catch {
      // Skip invalid JSON
    }
  }

  const run = getRunById(executionId);
  const duration_ms = run && run.started_at_ms && run.completed_at_ms
    ? run.completed_at_ms - run.started_at_ms
    : 0;

  const messageCountResult = queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM messages WHERE execution_id = '${executionId}'`
  );

  const toolCallCountResult = queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM messages WHERE execution_id = '${executionId}' AND type = 'tool-call'`
  );

  return {
    execution_id: executionId,
    total_tokens,
    prompt_tokens,
    completion_tokens,
    duration_ms,
    message_count: messageCountResult?.count || 0,
    tool_call_count: toolCallCountResult?.count || 0,
  };
}

export function getAggregateStats(): {
  total_runs: number;
  running_runs: number;
  completed_runs: number;
  failed_runs: number;
  cancelled_runs: number;
  total_tokens: number;
  avg_duration_ms: number;
  total_errors: number;
} {
  const runStats = queryOne<{
    total_runs: number;
    running_runs: number;
    completed_runs: number;
    failed_runs: number;
    cancelled_runs: number;
  }>(`
    SELECT 
      COUNT(*) as total_runs,
      SUM(CASE WHEN status = 'RUNNING' THEN 1 ELSE 0 END) as running_runs,
      SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_runs,
      SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed_runs,
      SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled_runs
    FROM runs
  `) || { total_runs: 0, running_runs: 0, completed_runs: 0, failed_runs: 0, cancelled_runs: 0 };

  const errorCount = queryOne<{ count: number }>(
    `SELECT COUNT(*) as count FROM run_logs WHERE level = 'error'`
  );

  const recentRuns = getRuns(100);
  let totalTokens = 0;
  let totalDuration = 0;
  let runsWithDuration = 0;

  for (const run of recentRuns) {
    const stats = getRunStats(run.execution_id);
    if (stats) {
      totalTokens += stats.total_tokens;
      if (stats.duration_ms > 0) {
        totalDuration += stats.duration_ms;
        runsWithDuration++;
      }
    }
  }

  return {
    total_runs: runStats.total_runs || 0,
    running_runs: runStats.running_runs || 0,
    completed_runs: runStats.completed_runs || 0,
    failed_runs: runStats.failed_runs || 0,
    cancelled_runs: runStats.cancelled_runs || 0,
    total_tokens: totalTokens,
    avg_duration_ms: runsWithDuration > 0 ? Math.round(totalDuration / runsWithDuration) : 0,
    total_errors: errorCount?.count || 0,
  };
}

export function getTokenUsageByDay(days = 7): Array<{
  date: string;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  run_count: number;
}> {
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const runs = query<{ execution_id: string; created_at_ms: number }>(
    `SELECT execution_id, created_at_ms FROM runs WHERE created_at_ms > ${cutoffMs} ORDER BY created_at_ms DESC`
  );

  const dailyStats = new Map<string, {
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    run_count: number;
  }>();

  for (const run of runs) {
    const date = new Date(run.created_at_ms).toISOString().split('T')[0];
    const stats = getRunStats(run.execution_id);
    
    if (!dailyStats.has(date)) {
      dailyStats.set(date, { total_tokens: 0, prompt_tokens: 0, completion_tokens: 0, run_count: 0 });
    }
    
    const dayStats = dailyStats.get(date)!;
    dayStats.run_count++;
    if (stats) {
      dayStats.total_tokens += stats.total_tokens;
      dayStats.prompt_tokens += stats.prompt_tokens;
      dayStats.completion_tokens += stats.completion_tokens;
    }
  }

  return Array.from(dailyStats.entries())
    .map(([date, stats]) => ({ date, ...stats }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getStatusDistribution(): Array<{
  status: string;
  count: number;
  percentage: number;
}> {
  const totalResult = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM runs');
  const total = totalResult?.count || 0;
  
  const distribution = query<{ status: string; count: number }>(`
    SELECT status, COUNT(*) as count FROM runs GROUP BY status
  `);

  return distribution.map(d => ({
    status: d.status,
    count: d.count,
    percentage: total > 0 ? Math.round((d.count / total) * 100) : 0,
  }));
}

export function getTokenUsageByModel(): Array<{
  model: string;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  message_count: number;
  run_count: number;
}> {
  // 从 messages 表中提取 usage_json 中的模型信息
  // 同时从 metadata_json 中尝试获取模型信息
  const messages = query<{
    execution_id: string;
    usage_json: string;
    metadata_json: string | null;
  }>(`
    SELECT execution_id, usage_json, metadata_json
    FROM messages 
    WHERE usage_json IS NOT NULL 
    AND json_extract(usage_json, '$.total_tokens') > 0
  `);

  const modelStats = new Map<string, {
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
    message_count: number;
    executions: Set<string>;
  }>();

  for (const msg of messages) {
    try {
      const usage = JSON.parse(msg.usage_json);
      const total_tokens = usage.total_tokens || 0;
      const prompt_tokens = usage.prompt_tokens || 0;
      const completion_tokens = usage.completion_tokens || 0;

      // 尝试从 metadata_json 中提取模型信息
      let model = 'unknown';
      if (msg.metadata_json) {
        try {
          const metadata = JSON.parse(msg.metadata_json);
          // 尝试多种可能的模型字段
          model = metadata.model || 
                  metadata.model_id || 
                  metadata.modelLabel ||
                  'unknown';
        } catch {
          // 忽略解析错误
        }
      }

      if (!modelStats.has(model)) {
        modelStats.set(model, {
          total_tokens: 0,
          prompt_tokens: 0,
          completion_tokens: 0,
          message_count: 0,
          executions: new Set(),
        });
      }

      const stats = modelStats.get(model)!;
      stats.total_tokens += total_tokens;
      stats.prompt_tokens += prompt_tokens;
      stats.completion_tokens += completion_tokens;
      stats.message_count++;
      stats.executions.add(msg.execution_id);
    } catch {
      // 忽略解析错误
    }
  }

  return Array.from(modelStats.entries())
    .map(([model, stats]) => ({
      model,
      total_tokens: stats.total_tokens,
      prompt_tokens: stats.prompt_tokens,
      completion_tokens: stats.completion_tokens,
      message_count: stats.message_count,
      run_count: stats.executions.size,
    }))
    .sort((a, b) => b.total_tokens - a.total_tokens);
}

export function getTokenUsageByExecution(): Array<{
  execution_id: string;
  total_tokens: number;
  prompt_tokens: number;
  completion_tokens: number;
  message_count: number;
  status: string;
  created_at_ms: number;
}> {
  const runs = query<Run>('SELECT execution_id, status, created_at_ms FROM runs ORDER BY created_at_ms DESC LIMIT 100');
  
  return runs.map(run => {
    const messages = query<{ usage_json: string }>(
      `SELECT usage_json FROM messages WHERE execution_id = '${run.execution_id}' AND usage_json IS NOT NULL`
    );

    let total_tokens = 0;
    let prompt_tokens = 0;
    let completion_tokens = 0;

    for (const msg of messages) {
      try {
        const usage = JSON.parse(msg.usage_json);
        total_tokens += usage.total_tokens || 0;
        prompt_tokens += usage.prompt_tokens || 0;
        completion_tokens += usage.completion_tokens || 0;
      } catch {
        // 忽略解析错误
      }
    }

    return {
      execution_id: run.execution_id,
      total_tokens,
      prompt_tokens,
      completion_tokens,
      message_count: messages.length,
      status: run.status,
      created_at_ms: run.created_at_ms,
    };
  }).filter(r => r.total_tokens > 0);
}

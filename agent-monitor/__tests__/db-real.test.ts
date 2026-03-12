import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, unlinkSync } from 'fs';

// 创建测试数据库
const TEST_DB_PATH = '/tmp/agent-test.db';

describe('Database Layer (Real DB)', () => {
  let db: Database.Database;

  beforeEach(() => {
    // 创建测试数据库
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
    db = new Database(TEST_DB_PATH);

    // 创建测试表
    db.exec(`
      CREATE TABLE runs (
        execution_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        step_index INTEGER NOT NULL DEFAULT 0,
        started_at_ms INTEGER,
        completed_at_ms INTEGER,
        terminal_reason TEXT,
        error_code TEXT,
        error_category TEXT,
        error_message TEXT
      )
    `);

    db.exec(`
      CREATE TABLE run_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_id TEXT NOT NULL,
        step_index INTEGER,
        level TEXT NOT NULL,
        code TEXT,
        source TEXT NOT NULL,
        message TEXT NOT NULL,
        error_json TEXT,
        created_at_ms INTEGER NOT NULL
      )
    `);

    db.exec(`
      CREATE TABLE messages (
        message_id TEXT PRIMARY KEY,
        execution_id TEXT NOT NULL,
        step_index INTEGER,
        role TEXT NOT NULL,
        type TEXT NOT NULL,
        usage_json TEXT,
        created_at_ms INTEGER NOT NULL
      )
    `);

    // 插入测试数据
    const now = Date.now();
    db.prepare(
      `
      INSERT INTO runs (execution_id, run_id, conversation_id, status, created_at_ms, updated_at_ms, step_index, started_at_ms, completed_at_ms, terminal_reason, error_code, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      'exec_test_001',
      'run_001',
      'conv_001',
      'COMPLETED',
      now - 100000,
      now - 50000,
      5,
      now - 90000,
      now - 50000,
      'stop',
      null,
      null
    );

    db.prepare(
      `
      INSERT INTO runs (execution_id, run_id, conversation_id, status, created_at_ms, updated_at_ms, step_index, started_at_ms, completed_at_ms, terminal_reason, error_code, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      'exec_test_002',
      'run_002',
      'conv_001',
      'FAILED',
      now - 80000,
      now - 30000,
      10,
      now - 70000,
      now - 30000,
      'error',
      'AGENT_UNKNOWN_ERROR',
      'Test error message'
    );

    db.prepare(
      `
      INSERT INTO runs (execution_id, run_id, conversation_id, status, created_at_ms, updated_at_ms, step_index, started_at_ms, completed_at_ms, terminal_reason, error_code, error_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      'exec_test_003',
      'run_003',
      'conv_001',
      'RUNNING',
      now - 10000,
      now - 5000,
      3,
      now - 8000,
      null,
      null,
      null,
      null
    );

    // 插入测试日志
    db.prepare(
      `
      INSERT INTO run_logs (execution_id, step_index, level, source, message, error_json, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      'exec_test_002',
      10,
      'error',
      'agent',
      '[Agent] run.error',
      JSON.stringify({ name: 'UnknownError', message: 'Test error' }),
      now - 30000
    );

    db.prepare(
      `
      INSERT INTO run_logs (execution_id, step_index, level, source, message, error_json, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    ).run('exec_test_001', 5, 'info', 'agent', '[Agent] run.finish', null, now - 50000);

    // 插入测试消息
    db.prepare(
      `
      INSERT INTO messages (message_id, execution_id, step_index, role, type, usage_json, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    ).run(
      'msg_001',
      'exec_test_001',
      1,
      'assistant',
      'tool-call',
      JSON.stringify({ prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }),
      now - 90000
    );

    db.prepare(
      `
      INSERT INTO messages (message_id, execution_id, step_index, role, type, usage_json, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
    ).run('msg_002', 'exec_test_001', 2, 'tool', 'tool-result', null, now - 80000);
  });

  afterEach(() => {
    db.close();
    if (existsSync(TEST_DB_PATH)) {
      unlinkSync(TEST_DB_PATH);
    }
  });

  describe('getRuns', () => {
    it('should return runs ordered by created_at_ms DESC', () => {
      const stmt = db.prepare('SELECT * FROM runs ORDER BY created_at_ms DESC LIMIT ?');
      const runs = stmt.all(100) as any[];

      expect(runs).toHaveLength(3);
      expect(runs[0].execution_id).toBe('exec_test_003'); // Most recent
      expect(runs[1].execution_id).toBe('exec_test_002');
      expect(runs[2].execution_id).toBe('exec_test_001'); // Oldest
    });

    it('should respect limit parameter', () => {
      const stmt = db.prepare('SELECT * FROM runs ORDER BY created_at_ms DESC LIMIT ?');
      const runs = stmt.all(2) as any[];

      expect(runs).toHaveLength(2);
    });
  });

  describe('getRunById', () => {
    it('should return run by execution_id', () => {
      const stmt = db.prepare('SELECT * FROM runs WHERE execution_id = ?');
      const run = stmt.get('exec_test_001') as any;

      expect(run).toBeDefined();
      expect(run.execution_id).toBe('exec_test_001');
      expect(run.status).toBe('COMPLETED');
      expect(run.step_index).toBe(5);
    });

    it('should return undefined for non-existent run', () => {
      const stmt = db.prepare('SELECT * FROM runs WHERE execution_id = ?');
      const run = stmt.get('non_existent') as any;

      expect(run).toBeUndefined();
    });
  });

  describe('getErrorLogs', () => {
    it('should return error logs ordered by created_at_ms DESC', () => {
      const stmt = db.prepare(`
        SELECT * FROM run_logs 
        WHERE level = 'error'
        ORDER BY created_at_ms DESC 
        LIMIT ?
      `);
      const logs = stmt.all(100) as any[];

      expect(logs).toHaveLength(1);
      expect(logs[0].level).toBe('error');
      expect(logs[0].execution_id).toBe('exec_test_002');
    });
  });

  describe('getLogsByExecution', () => {
    it('should return logs for specific execution', () => {
      const stmt = db.prepare(`
        SELECT * FROM run_logs 
        WHERE execution_id = ?
        ORDER BY created_at_ms ASC 
        LIMIT ?
      `);
      const logs = stmt.all('exec_test_001', 200) as any[];

      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('[Agent] run.finish');
    });

    it('should return empty array for execution without logs', () => {
      const stmt = db.prepare(`
        SELECT * FROM run_logs 
        WHERE execution_id = ?
        ORDER BY created_at_ms ASC 
        LIMIT ?
      `);
      const logs = stmt.all('exec_test_003', 200) as any[];

      expect(logs).toHaveLength(0);
    });
  });

  describe('getRunStats', () => {
    it('should calculate token usage from messages', () => {
      const messages = db
        .prepare(
          `
        SELECT usage_json FROM messages 
        WHERE execution_id = ? AND usage_json IS NOT NULL
      `
        )
        .all('exec_test_001') as { usage_json: string }[];

      let total_tokens = 0;
      let prompt_tokens = 0;
      let completion_tokens = 0;

      for (const msg of messages) {
        const usage = JSON.parse(msg.usage_json);
        total_tokens += usage.total_tokens || 0;
        prompt_tokens += usage.prompt_tokens || 0;
        completion_tokens += usage.completion_tokens || 0;
      }

      expect(total_tokens).toBe(150);
      expect(prompt_tokens).toBe(100);
      expect(completion_tokens).toBe(50);
    });

    it('should calculate message count', () => {
      const messageCount = db
        .prepare(
          `
        SELECT COUNT(*) as count FROM messages WHERE execution_id = ?
      `
        )
        .get('exec_test_001') as { count: number };

      expect(messageCount.count).toBe(2);
    });

    it('should calculate tool call count', () => {
      const toolCallCount = db
        .prepare(
          `
        SELECT COUNT(*) as count FROM messages 
        WHERE execution_id = ? AND type = 'tool-call'
      `
        )
        .get('exec_test_001') as { count: number };

      expect(toolCallCount.count).toBe(1);
    });
  });

  describe('getAggregateStats', () => {
    it('should return correct run counts by status', () => {
      const runStats = db
        .prepare(
          `
        SELECT 
          COUNT(*) as total_runs,
          SUM(CASE WHEN status = 'RUNNING' THEN 1 ELSE 0 END) as running_runs,
          SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed_runs,
          SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed_runs,
          SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled_runs
        FROM runs
      `
        )
        .get() as any;

      expect(runStats.total_runs).toBe(3);
      expect(runStats.running_runs).toBe(1);
      expect(runStats.completed_runs).toBe(1);
      expect(runStats.failed_runs).toBe(1);
      expect(runStats.cancelled_runs).toBe(0);
    });

    it('should count error logs', () => {
      const errorCount = db
        .prepare(
          `
        SELECT COUNT(*) as count FROM run_logs WHERE level = 'error'
      `
        )
        .get() as { count: number };

      expect(errorCount.count).toBe(1);
    });
  });

  describe('getStatusDistribution', () => {
    it('should return distribution with percentages', () => {
      const total = db.prepare('SELECT COUNT(*) as count FROM runs').get() as { count: number };
      const distribution = db
        .prepare(
          `
        SELECT status, COUNT(*) as count 
        FROM runs 
        GROUP BY status
      `
        )
        .all() as { status: string; count: number }[];

      const result = distribution.map(d => ({
        status: d.status,
        count: d.count,
        percentage: total.count > 0 ? Math.round((d.count / total.count) * 100) : 0,
      }));

      expect(result).toHaveLength(3); // RUNNING, COMPLETED, FAILED

      const completed = result.find(r => r.status === 'COMPLETED');
      expect(completed?.count).toBe(1);
      expect(completed?.percentage).toBe(33); // 1/3 = 33%
    });
  });

  describe('Run Status Queries', () => {
    it('should filter runs by status', () => {
      const stmt = db.prepare('SELECT * FROM runs WHERE status = ? ORDER BY created_at_ms DESC');
      const running = stmt.all('RUNNING') as any[];
      const completed = stmt.all('COMPLETED') as any[];
      const failed = stmt.all('FAILED') as any[];

      expect(running).toHaveLength(1);
      expect(completed).toHaveLength(1);
      expect(failed).toHaveLength(1);
    });

    it('should calculate run duration', () => {
      const run = db
        .prepare('SELECT * FROM runs WHERE execution_id = ?')
        .get('exec_test_001') as any;
      const duration =
        run.completed_at_ms && run.started_at_ms ? run.completed_at_ms - run.started_at_ms : 0;

      expect(duration).toBe(40000); // 40 seconds
    });
  });
});

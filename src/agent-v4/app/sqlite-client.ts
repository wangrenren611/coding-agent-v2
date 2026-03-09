import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as path from 'node:path';

interface SqliteStatementLike {
  run: (...params: unknown[]) => unknown;
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
}

interface SqliteDatabaseLike {
  exec: (sql: string) => void;
  prepare: (sql: string) => SqliteStatementLike;
  close: () => void;
}

interface BunSqliteStatementLike {
  run: (...params: unknown[]) => unknown;
  get: (...params: unknown[]) => unknown;
  all: (...params: unknown[]) => unknown[];
}

interface BunSqliteDatabaseLike {
  exec: (sql: string) => unknown;
  query: (sql: string) => BunSqliteStatementLike;
  close: () => unknown;
}

class BunSqliteDatabaseAdapter implements SqliteDatabaseLike {
  constructor(private readonly db: BunSqliteDatabaseLike) {}

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): SqliteStatementLike {
    const statement = this.db.query(sql);
    return {
      run: (...params: unknown[]) => statement.run(...params),
      get: (...params: unknown[]) => statement.get(...params),
      all: (...params: unknown[]) => statement.all(...params),
    };
  }

  close(): void {
    this.db.close();
  }
}

/**
 * Agent-v4 app 专用 SQLite 客户端。
 * 只负责连接与事务，不执行通用 storage 模块的旧迁移。
 */
export class AgentAppSqliteClient {
  private static readonly require = createRequire(import.meta.url);
  private db: SqliteDatabaseLike | null = null;
  private initialized = false;
  private initializePromise: Promise<void> | null = null;

  constructor(private readonly dbPath: string) {}

  async prepare(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (this.initializePromise) {
      return this.initializePromise;
    }
    this.initializePromise = this.doPrepare();
    try {
      await this.initializePromise;
    } finally {
      this.initializePromise = null;
    }
  }

  private async doPrepare(): Promise<void> {
    await fs.mkdir(path.dirname(this.dbPath), { recursive: true });

    this.db = this.tryCreateNodeSqlite() ?? this.tryCreateBunSqlite();
    if (!this.db) {
      throw new Error(
        'Unable to initialize sqlite backend: neither "node:sqlite" nor "bun:sqlite" is available.'
      );
    }

    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA temp_store = MEMORY;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.initialized = true;
  }

  async exec(sql: string): Promise<void> {
    this.requireDb().exec(sql);
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    this.requireDb()
      .prepare(sql)
      .run(...params);
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return this.requireDb()
      .prepare(sql)
      .get(...params) as T | undefined;
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.requireDb()
      .prepare(sql)
      .all(...params) as T[];
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const db = this.requireDb();
    db.exec('BEGIN IMMEDIATE;');
    try {
      const result = await fn();
      db.exec('COMMIT;');
      return result;
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.initializePromise) {
      await this.initializePromise.catch(() => undefined);
    }
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initialized = false;
  }

  private tryCreateNodeSqlite(): SqliteDatabaseLike | null {
    try {
      const sqliteModule = AgentAppSqliteClient.require('node:sqlite') as {
        DatabaseSync: new (location: string) => SqliteDatabaseLike;
      };
      return new sqliteModule.DatabaseSync(this.dbPath);
    } catch {
      return null;
    }
  }

  private tryCreateBunSqlite(): SqliteDatabaseLike | null {
    try {
      const sqliteModule = AgentAppSqliteClient.require('bun:sqlite') as {
        Database: new (location: string, options?: { create?: boolean }) => BunSqliteDatabaseLike;
      };
      const db = new sqliteModule.Database(this.dbPath, { create: true });
      return new BunSqliteDatabaseAdapter(db);
    } catch {
      return null;
    }
  }

  private requireDb(): SqliteDatabaseLike {
    if (!this.db) {
      throw new Error('SQLite client not initialized. Call prepare() first.');
    }
    return this.db;
  }
}

export const AGENT_APP_SQLITE_CLIENT_MODULE = 'agent-v4-app-sqlite-client';

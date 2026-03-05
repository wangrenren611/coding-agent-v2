/**
 * SQLite 客户端封装
 *
 * 使用 Node 内置 `node:sqlite`（实验特性）提供统一数据库操作。
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runSqliteMigrations } from './sqliteMigrations';

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

export class SqliteClient {
  private static readonly require = createRequire(import.meta.url);
  private db: SqliteDatabaseLike | null = null;
  private initialized = false;
  private initializePromise: Promise<void> | null = null;

  constructor(private readonly dbPath: string) {}

  async prepare(): Promise<void> {
    if (this.initialized) return;
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
    const dirPath = path.dirname(this.dbPath);
    await fs.mkdir(dirPath, { recursive: true });

    const sqliteModule = SqliteClient.require('node:sqlite') as {
      DatabaseSync: new (location: string) => SqliteDatabaseLike;
    };
    const DatabaseSync = sqliteModule.DatabaseSync;
    this.db = new DatabaseSync(this.dbPath);

    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA temp_store = MEMORY;');

    await runSqliteMigrations(this);
    this.initialized = true;
  }

  async exec(sql: string): Promise<void> {
    this.requireDb().exec(sql);
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    const stmt = this.requireDb().prepare(sql);
    stmt.run(...params);
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const stmt = this.requireDb().prepare(sql);
    return stmt.get(...params) as T | undefined;
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const stmt = this.requireDb().prepare(sql);
    return stmt.all(...params) as T[];
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

  private requireDb(): SqliteDatabaseLike {
    if (!this.db) {
      throw new Error('SQLite client not initialized. Call prepare() first.');
    }
    return this.db;
  }
}

/**
 * SQLite 迁移定义
 */

import type { SqliteClient } from './sqliteClient';

interface Migration {
  version: number;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        status TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC, session_id DESC);

      CREATE TABLE IF NOT EXISTS contexts (
        session_id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL,
        updated_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_contexts_updated_at ON contexts(updated_at DESC);

      CREATE TABLE IF NOT EXISTS histories (
        session_id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS compactions (
        session_id TEXT PRIMARY KEY,
        data_json TEXT NOT NULL
      );
    `,
  },
];

export async function runSqliteMigrations(client: SqliteClient): Promise<void> {
  await client.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const rows = await client.all<{ version: number }>(
    'SELECT version FROM schema_migrations ORDER BY version ASC'
  );
  const appliedVersions = new Set(rows.map((row) => row.version));

  for (const migration of MIGRATIONS) {
    if (appliedVersions.has(migration.version)) continue;

    await client.transaction(async () => {
      await client.exec(migration.sql);
      await client.run('INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)', [
        migration.version,
        Date.now(),
      ]);
    });
  }
}

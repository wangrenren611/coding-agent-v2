/**
 * File Storage -> SQLite Storage 迁移脚本
 *
 * 用法：
 *   tsx src/storage/scripts/migrate-file-to-sqlite.ts <file_base_path> <sqlite_db_path>
 */

import { createFileStorageBundle } from '../fileStoreBundle';
import { createSqliteStorageBundle } from '../sqliteStoreBundle';

export async function migrateFileStorageToSqlite(
  fileBasePath: string,
  sqliteDbPath: string
): Promise<void> {
  const source = createFileStorageBundle(fileBasePath);
  const target = createSqliteStorageBundle(sqliteDbPath);

  try {
    await Promise.all([
      source.sessions.prepare(),
      source.contexts.prepare(),
      source.histories.prepare(),
      source.compactions.prepare(),
      target.sessions.prepare(),
      target.contexts.prepare(),
      target.histories.prepare(),
      target.compactions.prepare(),
    ]);

    const [sessions, contexts, histories, compactions] = await Promise.all([
      source.sessions.loadAll(),
      source.contexts.loadAll(),
      source.histories.loadAll(),
      source.compactions.loadAll(),
    ]);

    for (const [sessionId, value] of sessions) {
      await target.sessions.save(sessionId, value);
    }
    for (const [sessionId, value] of contexts) {
      await target.contexts.save(sessionId, value);
    }
    for (const [sessionId, value] of histories) {
      await target.histories.save(sessionId, value);
    }
    for (const [sessionId, value] of compactions) {
      await target.compactions.save(sessionId, value);
    }
  } finally {
    await Promise.all([source.close(), target.close()]);
  }
}

async function main(): Promise<void> {
  const [, , fileBasePath, sqliteDbPath] = process.argv;

  if (!fileBasePath || !sqliteDbPath) {
    throw new Error(
      'Usage: tsx src/storage/scripts/migrate-file-to-sqlite.ts <file_base_path> <sqlite_db_path>'
    );
  }

  await migrateFileStorageToSqlite(fileBasePath, sqliteDbPath);
  console.log('[storage:migrate] Migration completed');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('[storage:migrate] Migration failed:', error);
    process.exitCode = 1;
  });
}

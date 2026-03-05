/**
 * SQLite 存储包
 */

import type { IStorageBundle } from './interfaces';
import { SqliteClient } from './sqliteClient';
import { SqliteContextStore } from './sqliteContextStore';
import { SqliteHistoryStore } from './sqliteHistoryStore';
import { SqliteCompactionStore } from './sqliteCompactionStore';
import { SqliteSessionStore } from './sqliteSessionStore';

/**
 * 创建 SQLite 存储包
 *
 * @param dbPath SQLite 数据库文件路径
 */
export function createSqliteStorageBundle(dbPath: string): IStorageBundle {
  const client = new SqliteClient(dbPath);

  const contexts = new SqliteContextStore(client);
  const histories = new SqliteHistoryStore(client);
  const compactions = new SqliteCompactionStore(client);
  const sessions = new SqliteSessionStore(client);

  return {
    contexts,
    histories,
    compactions,
    sessions,
    async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
      return client.transaction(fn);
    },
    async close(): Promise<void> {
      await client.close();
    },
  };
}

export interface SqliteStorageBundleOptions {
  dbPath: string;
}

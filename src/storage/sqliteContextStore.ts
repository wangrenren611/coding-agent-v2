/**
 * SQLite 上下文存储实现
 */

import type { IContextStorage } from './interfaces';
import type { ContextData } from './types';
import type { SqliteClient } from './sqliteClient';

interface ContextRow {
  session_id: string;
  data_json: string;
}

export class SqliteContextStore implements IContextStorage {
  constructor(private readonly client: SqliteClient) {}

  async prepare(): Promise<void> {
    await this.client.prepare();
  }

  async loadAll(): Promise<Map<string, ContextData>> {
    const map = new Map<string, ContextData>();
    const rows = await this.client.all<ContextRow>('SELECT session_id, data_json FROM contexts');
    for (const row of rows) {
      try {
        map.set(row.session_id, JSON.parse(row.data_json) as ContextData);
      } catch (error) {
        console.error(`[SqliteContextStore] Error loading ${row.session_id}:`, error);
      }
    }
    return map;
  }

  async save(sessionId: string, context: ContextData): Promise<void> {
    await this.client.run(
      `
      INSERT INTO contexts(session_id, data_json, updated_at)
      VALUES(?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        data_json = excluded.data_json,
        updated_at = excluded.updated_at
      `,
      [sessionId, JSON.stringify(context), context.updatedAt]
    );
  }

  async delete(sessionId: string): Promise<void> {
    await this.client.run('DELETE FROM contexts WHERE session_id = ?', [sessionId]);
  }
}

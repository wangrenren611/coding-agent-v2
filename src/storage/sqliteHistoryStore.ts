/**
 * SQLite 历史存储实现
 */

import type { IHistoryStorage } from './interfaces';
import type { HistoryMessage } from './types';
import type { SqliteClient } from './sqliteClient';

interface HistoryRow {
  session_id: string;
  data_json: string;
}

export class SqliteHistoryStore implements IHistoryStorage {
  constructor(private readonly client: SqliteClient) {}

  async prepare(): Promise<void> {
    await this.client.prepare();
  }

  async loadAll(): Promise<Map<string, HistoryMessage[]>> {
    const map = new Map<string, HistoryMessage[]>();
    const rows = await this.client.all<HistoryRow>('SELECT session_id, data_json FROM histories');
    for (const row of rows) {
      try {
        map.set(row.session_id, JSON.parse(row.data_json) as HistoryMessage[]);
      } catch (error) {
        console.error(`[SqliteHistoryStore] Error loading ${row.session_id}:`, error);
      }
    }
    return map;
  }

  async save(sessionId: string, history: HistoryMessage[]): Promise<void> {
    await this.client.run(
      `
      INSERT INTO histories(session_id, data_json)
      VALUES(?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        data_json = excluded.data_json
      `,
      [sessionId, JSON.stringify(history)]
    );
  }

  async append(sessionId: string, messages: HistoryMessage[]): Promise<void> {
    if (messages.length === 0) return;

    await this.client.transaction(async () => {
      const row = await this.client.get<{ data_json: string }>(
        'SELECT data_json FROM histories WHERE session_id = ?',
        [sessionId]
      );

      const existing = this.safeParseHistory(row?.data_json);
      existing.push(...messages);
      await this.save(sessionId, existing);
    });
  }

  async delete(sessionId: string): Promise<void> {
    await this.client.run('DELETE FROM histories WHERE session_id = ?', [sessionId]);
  }

  private safeParseHistory(dataJson: string | undefined): HistoryMessage[] {
    if (!dataJson) return [];
    try {
      const parsed = JSON.parse(dataJson) as HistoryMessage[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

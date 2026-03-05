/**
 * SQLite 压缩记录存储实现
 */

import type { ICompactionStorage } from './interfaces';
import type { CompactionRecord } from './types';
import type { SqliteClient } from './sqliteClient';

interface CompactionRow {
  session_id: string;
  data_json: string;
}

export class SqliteCompactionStore implements ICompactionStorage {
  constructor(private readonly client: SqliteClient) {}

  async prepare(): Promise<void> {
    await this.client.prepare();
  }

  async loadAll(): Promise<Map<string, CompactionRecord[]>> {
    const map = new Map<string, CompactionRecord[]>();
    const rows = await this.client.all<CompactionRow>(
      'SELECT session_id, data_json FROM compactions'
    );
    for (const row of rows) {
      try {
        map.set(row.session_id, JSON.parse(row.data_json) as CompactionRecord[]);
      } catch (error) {
        console.error(`[SqliteCompactionStore] Error loading ${row.session_id}:`, error);
      }
    }
    return map;
  }

  async save(sessionId: string, records: CompactionRecord[]): Promise<void> {
    await this.client.run(
      `
      INSERT INTO compactions(session_id, data_json)
      VALUES(?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        data_json = excluded.data_json
      `,
      [sessionId, JSON.stringify(records)]
    );
  }

  async append(sessionId: string, record: CompactionRecord): Promise<void> {
    await this.client.transaction(async () => {
      const row = await this.client.get<{ data_json: string }>(
        'SELECT data_json FROM compactions WHERE session_id = ?',
        [sessionId]
      );

      const existing = this.safeParseRecords(row?.data_json);
      existing.push(record);
      await this.save(sessionId, existing);
    });
  }

  async delete(sessionId: string): Promise<void> {
    await this.client.run('DELETE FROM compactions WHERE session_id = ?', [sessionId]);
  }

  private safeParseRecords(dataJson: string | undefined): CompactionRecord[] {
    if (!dataJson) return [];
    try {
      const parsed = JSON.parse(dataJson) as CompactionRecord[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

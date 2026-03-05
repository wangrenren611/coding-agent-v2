/**
 * SQLite 会话存储实现
 */

import type { ISessionStorage } from './interfaces';
import type { QueryOptions, SessionData, SessionFilter } from './types';
import type { SqliteClient } from './sqliteClient';

interface SessionRow {
  session_id: string;
  data_json: string;
}

export class SqliteSessionStore implements ISessionStorage {
  constructor(private readonly client: SqliteClient) {}

  async prepare(): Promise<void> {
    await this.client.prepare();
  }

  async loadAll(): Promise<Map<string, SessionData>> {
    const map = new Map<string, SessionData>();
    const rows = await this.client.all<SessionRow>('SELECT session_id, data_json FROM sessions');
    for (const row of rows) {
      try {
        map.set(row.session_id, JSON.parse(row.data_json) as SessionData);
      } catch (error) {
        console.error(`[SqliteSessionStore] Error loading ${row.session_id}:`, error);
      }
    }
    return map;
  }

  async save(sessionId: string, session: SessionData): Promise<void> {
    await this.client.run(
      `
      INSERT INTO sessions(session_id, data_json, status, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        data_json = excluded.data_json,
        status = excluded.status,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
      `,
      [sessionId, JSON.stringify(session), session.status, session.createdAt, session.updatedAt]
    );
  }

  async delete(sessionId: string): Promise<void> {
    await this.client.run('DELETE FROM sessions WHERE session_id = ?', [sessionId]);
  }

  async list(options?: QueryOptions, filter?: SessionFilter): Promise<SessionData[]> {
    const whereClauses: string[] = [];
    const params: unknown[] = [];

    if (filter?.sessionId) {
      whereClauses.push('session_id = ?');
      params.push(filter.sessionId);
    }
    if (filter?.status) {
      whereClauses.push('status = ?');
      params.push(filter.status);
    }
    if (filter?.startTime !== undefined) {
      whereClauses.push('created_at >= ?');
      params.push(filter.startTime);
    }
    if (filter?.endTime !== undefined) {
      whereClauses.push('created_at <= ?');
      params.push(filter.endTime);
    }

    const orderByColumn = options?.orderBy === 'createdAt' ? 'created_at' : 'updated_at';
    const orderDirection = options?.orderDirection === 'asc' ? 'ASC' : 'DESC';
    const sessionDirection = options?.orderDirection === 'asc' ? 'ASC' : 'DESC';
    const limit = options?.limit ?? Number.MAX_SAFE_INTEGER;
    const offset = options?.offset ?? 0;

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const sql = `
      SELECT data_json
      FROM sessions
      ${whereSql}
      ORDER BY ${orderByColumn} ${orderDirection}, session_id ${sessionDirection}
      LIMIT ?
      OFFSET ?
    `;

    const rows = await this.client.all<{ data_json: string }>(sql, [...params, limit, offset]);
    return rows
      .map((row) => {
        try {
          return JSON.parse(row.data_json) as SessionData;
        } catch (error) {
          console.error('[SqliteSessionStore] Error parsing session row:', error);
          return null;
        }
      })
      .filter((session): session is SessionData => session !== null);
  }
}

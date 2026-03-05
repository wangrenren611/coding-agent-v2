/**
 * 文件会话存储实现
 */

import type { SessionData, QueryOptions, SessionFilter } from './types';
import type { ISessionStorage } from './interfaces';
import { BaseFileStore } from './base';

/**
 * 文件会话存储
 */
export class FileSessionStore extends BaseFileStore<SessionData> implements ISessionStorage {
  constructor(basePath: string, io?: import('./atomic-json').AtomicJsonStore) {
    super({ basePath, subDir: 'sessions', io });
  }

  /**
   * 列出会话（支持过滤和分页）
   */
  async list(options?: QueryOptions, filter?: SessionFilter): Promise<SessionData[]> {
    const all = await this.loadAll();
    let sessions = Array.from(all.values());

    // 应用过滤条件
    if (filter) {
      if (filter.sessionId) {
        sessions = sessions.filter((s) => s.sessionId === filter.sessionId);
      }
      if (filter.status) {
        sessions = sessions.filter((s) => s.status === filter.status);
      }
      if (filter.startTime !== undefined) {
        sessions = sessions.filter((s) => s.createdAt >= filter.startTime!);
      }
      if (filter.endTime !== undefined) {
        sessions = sessions.filter((s) => s.createdAt <= filter.endTime!);
      }
    }

    // 排序
    const orderBy = options?.orderBy ?? 'updatedAt';
    const orderDirection = options?.orderDirection ?? 'desc';
    sessions.sort((a, b) => {
      const comparison = a[orderBy] - b[orderBy];
      if (comparison !== 0) {
        return orderDirection === 'asc' ? comparison : -comparison;
      }

      const tie = a.sessionId.localeCompare(b.sessionId);
      return orderDirection === 'asc' ? tie : -tie;
    });

    // 分页
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? sessions.length;
    return sessions.slice(offset, offset + limit);
  }
}

/**
 * 文件会话存储实现
 */

import * as path from 'path';
import type { SessionData, QueryOptions, SessionFilter } from './types';
import type { ISessionStorage } from './interfaces';
import { AtomicJsonStore } from './atomic-json';
import { encodeEntityFileName, safeDecodeEntityFileName } from './filename-codec';

export class FileSessionStore implements ISessionStorage {
  private readonly dirPath: string;
  private readonly io: AtomicJsonStore;

  constructor(basePath: string, io?: AtomicJsonStore) {
    this.dirPath = path.join(basePath, 'sessions');
    this.io = io ?? new AtomicJsonStore();
  }

  async prepare(): Promise<void> {
    await this.io.ensureDir(this.dirPath);
  }

  async loadAll(): Promise<Map<string, SessionData>> {
    const items = new Map<string, SessionData>();
    const files = await this.io.listJsonFiles(this.dirPath);

    for (const fileName of files) {
      const sessionId = safeDecodeEntityFileName(fileName);
      if (!sessionId) continue;

      const filePath = this.filePath(sessionId);
      try {
        const session = await this.io.readJsonFile<SessionData>(filePath);
        if (session) {
          items.set(sessionId, session);
        }
      } catch (error) {
        console.error(`Error loading session ${sessionId}:`, error);
      }
    }

    return items;
  }

  async save(sessionId: string, session: SessionData): Promise<void> {
    await this.io.writeJsonFile(this.filePath(sessionId), session);
  }

  async delete(sessionId: string): Promise<void> {
    await this.io.deleteFileIfExists(this.filePath(sessionId));
  }

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
        const startTime = filter.startTime;
        sessions = sessions.filter((s) => s.createdAt >= startTime);
      }
      if (filter.endTime !== undefined) {
        const endTime = filter.endTime;
        sessions = sessions.filter((s) => s.createdAt <= endTime);
      }
    }

    // 排序
    const orderBy = options?.orderBy ?? 'updatedAt';
    const orderDirection = options?.orderDirection ?? 'desc';
    sessions.sort((a, b) => {
      const comparison = a[orderBy] - b[orderBy];
      return orderDirection === 'asc' ? comparison : -comparison;
    });

    // 分页
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? sessions.length;
    return sessions.slice(offset, offset + limit);
  }

  private filePath(sessionId: string): string {
    return path.join(this.dirPath, encodeEntityFileName(sessionId));
  }
}

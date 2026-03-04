/**
 * 文件历史存储实现
 *
 * 支持追加操作，优化写入性能
 */

import * as path from 'path';
import type { HistoryMessage } from './types';
import type { IHistoryStorage } from './interfaces';
import { AtomicJsonStore } from './atomic-json';
import { encodeEntityFileName, safeDecodeEntityFileName } from './filename-codec';

export class FileHistoryStore implements IHistoryStorage {
  private readonly dirPath: string;
  private readonly io: AtomicJsonStore;

  constructor(basePath: string, io?: AtomicJsonStore) {
    this.dirPath = path.join(basePath, 'histories');
    this.io = io ?? new AtomicJsonStore();
  }

  async prepare(): Promise<void> {
    await this.io.ensureDir(this.dirPath);
  }

  async loadAll(): Promise<Map<string, HistoryMessage[]>> {
    const items = new Map<string, HistoryMessage[]>();
    const files = await this.io.listJsonFiles(this.dirPath);

    for (const fileName of files) {
      const sessionId = safeDecodeEntityFileName(fileName);
      if (!sessionId) continue;

      const filePath = this.filePath(sessionId);
      try {
        const history = await this.io.readJsonFile<HistoryMessage[]>(filePath);
        if (history) {
          items.set(sessionId, history);
        }
      } catch (error) {
        console.error(`Error loading history ${sessionId}:`, error);
      }
    }

    return items;
  }

  async save(sessionId: string, history: HistoryMessage[]): Promise<void> {
    await this.io.writeJsonFile(this.filePath(sessionId), history);
  }

  /**
   * 追加消息到历史
   *
   * 当前实现：读取 -> 追加 -> 写入
   * 未来优化：可以使用 append-only 日志格式
   */
  async append(sessionId: string, messages: HistoryMessage[]): Promise<void> {
    if (messages.length === 0) return;

    const filePath = this.filePath(sessionId);

    // 读取现有历史
    let existing: HistoryMessage[] = [];
    try {
      const loaded = await this.io.readJsonFile<HistoryMessage[]>(filePath);
      if (loaded) {
        existing = loaded;
      }
    } catch {
      // 文件不存在，使用空数组
    }

    // 追加新消息
    existing.push(...messages);

    // 写入
    await this.io.writeJsonFile(filePath, existing);
  }

  async delete(sessionId: string): Promise<void> {
    await this.io.deleteFileIfExists(this.filePath(sessionId));
  }

  private filePath(sessionId: string): string {
    return path.join(this.dirPath, encodeEntityFileName(sessionId));
  }
}

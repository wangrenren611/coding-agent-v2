/**
 * 文件压缩记录存储实现
 */

import * as path from 'path';
import type { CompactionRecord } from './types';
import type { ICompactionStorage } from './interfaces';
import { AtomicJsonStore } from './atomic-json';
import { encodeEntityFileName, safeDecodeEntityFileName } from './filename-codec';

export class FileCompactionStore implements ICompactionStorage {
  private readonly dirPath: string;
  private readonly io: AtomicJsonStore;

  constructor(basePath: string, io?: AtomicJsonStore) {
    this.dirPath = path.join(basePath, 'compactions');
    this.io = io ?? new AtomicJsonStore();
  }

  async prepare(): Promise<void> {
    await this.io.ensureDir(this.dirPath);
  }

  async loadAll(): Promise<Map<string, CompactionRecord[]>> {
    const items = new Map<string, CompactionRecord[]>();
    const files = await this.io.listJsonFiles(this.dirPath);

    for (const fileName of files) {
      const sessionId = safeDecodeEntityFileName(fileName);
      if (!sessionId) continue;

      const filePath = this.filePath(sessionId);
      try {
        const records = await this.io.readJsonFile<CompactionRecord[]>(filePath);
        if (records) {
          items.set(sessionId, records);
        }
      } catch (error) {
        console.error(`Error loading compaction records ${sessionId}:`, error);
      }
    }

    return items;
  }

  async save(sessionId: string, records: CompactionRecord[]): Promise<void> {
    await this.io.writeJsonFile(this.filePath(sessionId), records);
  }

  async append(sessionId: string, record: CompactionRecord): Promise<void> {
    const filePath = this.filePath(sessionId);

    // 读取现有记录
    let existing: CompactionRecord[] = [];
    try {
      const loaded = await this.io.readJsonFile<CompactionRecord[]>(filePath);
      if (loaded) {
        existing = loaded;
      }
    } catch {
      // 文件不存在，使用空数组
    }

    // 追加新记录
    existing.push(record);

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

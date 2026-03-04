/**
 * 文件上下文存储实现
 */

import * as path from 'path';
import type { ContextData } from './types';
import type { IContextStorage } from './interfaces';
import { AtomicJsonStore } from './atomic-json';
import { encodeEntityFileName, safeDecodeEntityFileName } from './filename-codec';

/**
 * 文件上下文存储
 */
export class FileContextStorage implements IContextStorage {
  private readonly dirPath: string;
  private readonly io: AtomicJsonStore;

  constructor(basePath: string, io?: AtomicJsonStore) {
    this.dirPath = path.join(basePath, 'contexts');
    this.io = io ?? new AtomicJsonStore();
  }

  async prepare(): Promise<void> {
    await this.io.ensureDir(this.dirPath);
  }

  async loadAll(): Promise<Map<string, ContextData>> {
    const items = new Map<string, ContextData>();
    const files = await this.io.listJsonFiles(this.dirPath);

    for (const fileName of files) {
      const sessionId = safeDecodeEntityFileName(fileName);
      if (!sessionId) continue;

      const filePath = this.filePath(sessionId);
      try {
        const context = await this.io.readJsonFile<ContextData>(filePath);
        if (!context) continue;
        items.set(sessionId, { ...context, sessionId });
      } catch (error) {
        console.error(`[FileContextStorage] Error loading context ${sessionId}:`, error);
      }
    }

    return items;
  }

  async save(sessionId: string, context: ContextData): Promise<void> {
    await this.io.writeJsonFile(this.filePath(sessionId), context);
  }

  async delete(sessionId: string): Promise<void> {
    await this.io.deleteFileIfExists(this.filePath(sessionId));
  }

  private filePath(sessionId: string): string {
    return path.join(this.dirPath, encodeEntityFileName(sessionId));
  }
}

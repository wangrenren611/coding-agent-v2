/**
 * 文件压缩记录存储实现
 */

import type { CompactionRecord } from './types';
import type { ICompactionStorage } from './interfaces';
import { BaseFileStore } from './base';

/**
 * 文件压缩记录存储
 */
export class FileCompactionStore
  extends BaseFileStore<CompactionRecord[]>
  implements ICompactionStorage
{
  constructor(basePath: string, io?: import('./atomic-json').AtomicJsonStore) {
    super({ basePath, subDir: 'compactions', io });
  }

  protected transformData(_sessionId: string, data: CompactionRecord[]): CompactionRecord[] {
    return data ?? [];
  }

  async append(sessionId: string, record: CompactionRecord): Promise<void> {
    const filePath = this.getFilePath(sessionId);
    try {
      await this.io.mutateJsonFile<CompactionRecord[]>(filePath, (current) => [
        ...(current ?? []),
        record,
      ]);
    } catch {
      // 与历史行为保持一致：损坏文件时按空数组恢复并继续追加
      await this.io.writeJsonFile(filePath, [record]);
    }
  }
}

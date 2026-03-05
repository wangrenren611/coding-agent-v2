/**
 * 文件存储包
 *
 * 聚合所有文件存储实现，提供统一的创建接口
 */

import { AtomicJsonStore } from './atomic-json';
import { FileContextStorage } from './fileContextStore';
import { FileHistoryStore } from './fileHistoryStore';
import { FileCompactionStore } from './fileCompactionStore';
import { FileSessionStore } from './fileSessionStore';
import type { IStorageBundle } from './interfaces';

/**
 * 创建文件存储包
 *
 * @param basePath 基础存储路径
 * @returns 存储包
 */
export function createFileStorageBundle(basePath: string): IStorageBundle {
  const io = new AtomicJsonStore();

  const contexts = new FileContextStorage(basePath, io);
  const histories = new FileHistoryStore(basePath, io);
  const compactions = new FileCompactionStore(basePath, io);
  const sessions = new FileSessionStore(basePath, io);

  return {
    contexts,
    histories,
    compactions,
    sessions,
    async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
      return fn();
    },
    async close(): Promise<void> {
      await io.close();
    },
  };
}

/**
 * 文件存储包配置
 */
export interface FileStorageBundleOptions {
  /** 基础存储路径 */
  basePath: string;
  /** 是否使用独立的 IO 实例 */
  sharedIo?: boolean;
}

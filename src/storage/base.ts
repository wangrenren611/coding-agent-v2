/**
 * 文件存储基类
 *
 * 提供通用的文件存储操作，消除重复代码
 */

import * as path from 'path';
import { AtomicJsonStore } from './atomic-json';
import { encodeEntityFileName, safeDecodeEntityFileName } from './filename-codec';

/**
 * 文件存储基类配置
 */
export interface BaseFileStoreConfig {
  /** 基础路径 */
  basePath: string;
  /** 子目录名称 */
  subDir: string;
  /** 可选的共享 IO 实例 */
  io?: AtomicJsonStore;
}

/**
 * 文件存储基类
 */
export abstract class BaseFileStore<T> {
  protected readonly dirPath: string;
  protected readonly io: AtomicJsonStore;

  constructor(config: BaseFileStoreConfig) {
    this.dirPath = path.join(config.basePath, config.subDir);
    this.io = config.io ?? new AtomicJsonStore();
  }

  /**
   * 准备存储目录
   */
  async prepare(): Promise<void> {
    await this.io.ensureDir(this.dirPath);
  }

  /**
   * 加载所有数据
   */
  async loadAll(): Promise<Map<string, T>> {
    const items = new Map<string, T>();
    const files = await this.io.listJsonFiles(this.dirPath);

    for (const fileName of files) {
      const sessionId = safeDecodeEntityFileName(fileName);
      if (!sessionId) continue;

      try {
        const data = await this.io.readJsonFile<T>(this.getFilePath(sessionId));
        if (data !== null) {
          items.set(sessionId, this.transformData(sessionId, data));
        }
      } catch (error) {
        this.onError(sessionId, error);
      }
    }

    return items;
  }

  /**
   * 保存数据
   */
  async save(sessionId: string, data: T): Promise<void> {
    await this.io.writeJsonFile(this.getFilePath(sessionId), data);
  }

  /**
   * 删除数据
   */
  async delete(sessionId: string): Promise<void> {
    await this.io.deleteFileIfExists(this.getFilePath(sessionId));
  }

  /**
   * 获取文件路径
   */
  protected getFilePath(sessionId: string): string {
    return path.join(this.dirPath, encodeEntityFileName(sessionId));
  }

  /**
   * 转换加载的数据（子类可覆盖）
   */
  protected transformData(_sessionId: string, data: T): T {
    return data;
  }

  /**
   * 错误处理（子类可覆盖）
   */
  protected onError(sessionId: string, error: unknown): void {
    console.error(`[${this.constructor.name}] Error loading ${sessionId}:`, error);
  }
}

/**
 * 数组类型文件存储基类
 *
 * 用于存储数组数据，支持追加操作
 */
export abstract class BaseArrayFileStore<T> extends BaseFileStore<T[]> {
  /**
   * 追加数据
   */
  async append(sessionId: string, items: T[]): Promise<void> {
    if (items.length === 0) return;

    const filePath = this.getFilePath(sessionId);
    try {
      await this.io.mutateJsonFile<T[]>(filePath, (current) => {
        const existing = current ?? [];
        return [...existing, ...items];
      });
    } catch {
      // 与历史行为保持一致：损坏文件时按空数组恢复并继续追加
      await this.io.writeJsonFile(filePath, [...items]);
    }
  }

  /**
   * 读取数组文件
   */
  protected async readArray(filePath: string): Promise<T[]> {
    try {
      const loaded = await this.io.readJsonFile<T[]>(filePath);
      return loaded ?? [];
    } catch {
      return [];
    }
  }
}

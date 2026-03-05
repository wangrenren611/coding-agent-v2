/**
 * 原子 JSON 文件存储
 *
 * 提供原子写入、备份恢复、文件操作队列等功能
 * 参考 coding-agent/src/agent-v2/memory/adapters/file/atomic-json.ts
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

// =============================================================================
// 原子 JSON 存储类
// =============================================================================

/**
 * 原子 JSON 文件存储
 *
 * 特性：
 * - 临时文件 + rename 实现原子写入
 * - .bak 备份文件用于崩溃恢复
 * - 文件操作队列确保同一文件串行写入
 */
export class AtomicJsonStore {
  /** 文件操作队列，确保同一文件的写入串行执行 */
  private readonly fileOperationQueue = new Map<string, Promise<void>>();
  /** 所有待处理的文件操作，用于 close() 时等待 */
  private readonly pendingFileOperations = new Set<Promise<void>>();

  // ===========================================================================
  // 公共 API
  // ===========================================================================

  /**
   * 确保目录存在
   */
  async ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }

  /**
   * 列出目录中的 JSON 文件
   */
  async listJsonFiles(dirPath: string): Promise<string[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => []);
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  }

  /**
   * 读取 JSON 文件
   *
   * 如果主文件损坏或不存在，会尝试从备份恢复
   */
  async readJsonFile<T>(filePath: string): Promise<T | null> {
    const raw = await this.readTextIfExists(filePath);
    if (raw === null) {
      // 主文件不存在，尝试从备份恢复
      const backupPath = this.getBackupFilePath(filePath);
      const backupRaw = await this.readTextIfExists(backupPath);
      if (backupRaw !== null) {
        const parsedBackup = this.parseJsonText<T>(backupRaw, backupPath);
        if (parsedBackup.ok) {
          console.error(`[AtomicJsonStore] Restoring missing file from backup: ${filePath}`);
          await this.writeJsonFile(filePath, parsedBackup.value);
          return parsedBackup.value;
        }
        throw parsedBackup.error;
      }
      return null;
    }

    // 主文件存在，尝试解析
    const parsedPrimary = this.parseJsonText<T>(raw, filePath);
    if (parsedPrimary.ok) {
      return parsedPrimary.value;
    }
    const primaryError = parsedPrimary.error;

    // 主文件解析失败，尝试从备份恢复
    const backupPath = this.getBackupFilePath(filePath);
    const backupRaw = await this.readTextIfExists(backupPath);
    if (backupRaw !== null) {
      const parsedBackup = this.parseJsonText<T>(backupRaw, backupPath);
      if (parsedBackup.ok) {
        console.error(`[AtomicJsonStore] Recovered from backup for ${filePath}:`, primaryError);
        await this.archiveCorruptedFile(filePath);
        await this.writeJsonFile(filePath, parsedBackup.value);
        return parsedBackup.value;
      }
    }

    throw primaryError;
  }

  /**
   * 写入 JSON 文件（原子操作）
   *
   * 流程：
   * 1. 备份旧文件
   * 2. 写入临时文件
   * 3. 原子重命名
   */
  async writeJsonFile(filePath: string, value: unknown): Promise<void> {
    await this.enqueueFileOperation(filePath, async () => {
      await this.writeJsonValue(filePath, value);
    });
  }

  /**
   * 原子读取并更新 JSON 文件（读改写在同一队列中执行）
   */
  async mutateJsonFile<T>(
    filePath: string,
    updater: (current: T | null) => T | Promise<T>
  ): Promise<void> {
    await this.enqueueFileOperation(filePath, async () => {
      const current = await this.readJsonFileWithoutRepair<T>(filePath);
      const next = await updater(current);
      await this.writeJsonValue(filePath, next);
    });
  }

  /**
   * 删除文件（同时删除备份）
   */
  async deleteFileIfExists(filePath: string): Promise<void> {
    await this.enqueueFileOperation(filePath, async () => {
      await this.unlinkIfExists(filePath);
      await this.unlinkIfExists(this.getBackupFilePath(filePath));
    });
  }

  /**
   * 关闭存储，等待所有待处理操作完成
   */
  async close(): Promise<void> {
    if (this.pendingFileOperations.size === 0) {
      return;
    }
    await Promise.allSettled([...this.pendingFileOperations]);
  }

  // ===========================================================================
  // 私有方法
  // ===========================================================================

  /**
   * 重命名文件（带重试）
   */
  private async renameWithRetry(
    src: string,
    dest: string,
    maxRetries = 5,
    delayMs = 100
  ): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt += 1) {
      try {
        await fs.rename(src, dest);
        return;
      } catch (error) {
        lastError = error as Error;
        const isEperm =
          error &&
          typeof error === 'object' &&
          'code' in error &&
          (error as { code?: string }).code === 'EPERM';

        if (isEperm && attempt < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
          continue;
        }
        throw error;
      }
    }

    throw lastError;
  }

  /**
   * 归档损坏的文件
   */
  private async archiveCorruptedFile(filePath: string): Promise<void> {
    const archivedPath = `${filePath}.corrupt-${Date.now()}`;
    try {
      await fs.rename(filePath, archivedPath);
    } catch (error) {
      if (this.isNotFound(error)) {
        return;
      }
      throw error;
    }
  }

  /**
   * 获取备份文件路径
   */
  private getBackupFilePath(filePath: string): string {
    return `${filePath}.bak`;
  }

  /**
   * 构建临时文件路径
   */
  private buildTempFilePath(filePath: string): string {
    const base = path.basename(filePath);
    const dir = path.dirname(filePath);
    return path.join(dir, `.${base}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);
  }

  /**
   * 读取 JSON 文件（不触发自动修复写回）
   */
  private async readJsonFileWithoutRepair<T>(filePath: string): Promise<T | null> {
    const raw = await this.readTextIfExists(filePath);
    if (raw === null) {
      const backupRaw = await this.readTextIfExists(this.getBackupFilePath(filePath));
      if (backupRaw === null) return null;

      const parsedBackup = this.parseJsonText<T>(backupRaw, this.getBackupFilePath(filePath));
      if (parsedBackup.ok) return parsedBackup.value;
      throw parsedBackup.error;
    }

    const parsedPrimary = this.parseJsonText<T>(raw, filePath);
    if (parsedPrimary.ok) {
      return parsedPrimary.value;
    }
    const primaryError = parsedPrimary.error;

    const backupRaw = await this.readTextIfExists(this.getBackupFilePath(filePath));
    if (backupRaw !== null) {
      const parsedBackup = this.parseJsonText<T>(backupRaw, this.getBackupFilePath(filePath));
      if (parsedBackup.ok) return parsedBackup.value;
    }

    throw primaryError;
  }

  /**
   * 读取文本文件（如果存在）
   */
  private async readTextIfExists(filePath: string): Promise<string | null> {
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      if (this.isNotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * 解析 JSON 文本
   */
  private parseJsonText<T>(
    raw: string,
    filePath: string
  ): { ok: true; value: T } | { ok: false; error: Error } {
    try {
      const normalized = raw.trim();
      if (normalized.length === 0) {
        return {
          ok: false,
          error: new Error(`JSON file is empty: ${filePath}`),
        };
      }

      return {
        ok: true,
        value: JSON.parse(normalized) as T,
      };
    } catch (error) {
      const wrapped =
        error instanceof Error
          ? new Error(`Failed to parse JSON ${filePath}: ${error.message}`)
          : new Error(`Failed to parse JSON ${filePath}`);
      return {
        ok: false,
        error: wrapped,
      };
    }
  }

  /**
   * 复制文件（如果存在）
   */
  private async copyFileIfExists(fromPath: string, toPath: string): Promise<void> {
    try {
      await fs.copyFile(fromPath, toPath);
    } catch (error) {
      if (this.isNotFound(error)) {
        return;
      }
      throw error;
    }
  }

  /**
   * 删除文件（如果存在）
   */
  private async unlinkIfExists(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (this.isNotFound(error)) {
        return;
      }
      throw error;
    }
  }

  /**
   * 写入 JSON 文件（调用方需保证并发安全）
   */
  private async writeJsonValue(filePath: string, value: unknown): Promise<void> {
    const json = JSON.stringify(value, null, 2);

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await this.copyFileIfExists(filePath, this.getBackupFilePath(filePath));

    const tempFilePath = this.buildTempFilePath(filePath);
    try {
      await fs.writeFile(tempFilePath, json, 'utf-8');
      await this.renameWithRetry(tempFilePath, filePath);
    } finally {
      await this.unlinkIfExists(tempFilePath);
    }
  }

  /**
   * 将文件操作加入队列
   *
   * 确保同一文件的写入串行执行
   */
  private enqueueFileOperation(filePath: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.fileOperationQueue.get(filePath) || Promise.resolve();
    const pending = previous
      .catch(() => {
        // Keep queue chain alive even after previous error.
      })
      .then(operation);

    const tracked = pending.finally(() => {
      if (this.fileOperationQueue.get(filePath) === tracked) {
        this.fileOperationQueue.delete(filePath);
      }
      this.pendingFileOperations.delete(tracked);
    });

    this.fileOperationQueue.set(filePath, tracked);
    this.pendingFileOperations.add(tracked);
    return tracked;
  }

  /**
   * 检查是否是 "文件不存在" 错误
   */
  private isNotFound(error: unknown): boolean {
    return Boolean(
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    );
  }
}

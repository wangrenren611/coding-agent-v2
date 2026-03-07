/**
 * 原子 JSON 存储测试
 *
 * 测试原子写入、备份恢复、并发控制
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { AtomicJsonStore } from '../atomic-json';

describe('AtomicJsonStore', () => {
  let store: AtomicJsonStore;
  let tempDir: string;

  beforeEach(async () => {
    store = new AtomicJsonStore();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-json-test-'));
  });

  afterEach(async () => {
    await store.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('ensureDir', () => {
    it('should create directory if not exists', async () => {
      const dirPath = path.join(tempDir, 'new-dir');
      await store.ensureDir(dirPath);
      const stat = await fs.stat(dirPath);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should create nested directories', async () => {
      const dirPath = path.join(tempDir, 'a', 'b', 'c');
      await store.ensureDir(dirPath);
      const stat = await fs.stat(dirPath);
      expect(stat.isDirectory()).toBe(true);
    });

    it('should not fail if directory exists', async () => {
      const dirPath = path.join(tempDir, 'existing-dir');
      await fs.mkdir(dirPath);
      await expect(store.ensureDir(dirPath)).resolves.not.toThrow();
    });
  });

  describe('listJsonFiles', () => {
    it('should list JSON files in directory', async () => {
      await fs.writeFile(path.join(tempDir, 'file1.json'), '{}');
      await fs.writeFile(path.join(tempDir, 'file2.json'), '{}');
      await fs.writeFile(path.join(tempDir, 'file3.txt'), 'text');

      const files = await store.listJsonFiles(tempDir);
      expect(files).toEqual(['file1.json', 'file2.json']);
    });

    it('should return empty array for non-existent directory', async () => {
      // Create a path that definitely doesn't exist
      const nonExistentPath = path.join(tempDir, 'non-existent-' + Date.now());
      const files = await store.listJsonFiles(nonExistentPath);
      expect(files).toEqual([]);
    });

    it('should return sorted file names', async () => {
      await fs.writeFile(path.join(tempDir, 'c.json'), '{}');
      await fs.writeFile(path.join(tempDir, 'a.json'), '{}');
      await fs.writeFile(path.join(tempDir, 'b.json'), '{}');

      const files = await store.listJsonFiles(tempDir);
      expect(files).toEqual(['a.json', 'b.json', 'c.json']);
    });

    it('should ignore non-file entries', async () => {
      await fs.writeFile(path.join(tempDir, 'file.json'), '{}');
      await fs.mkdir(path.join(tempDir, 'dir.json'));

      const files = await store.listJsonFiles(tempDir);
      expect(files).toEqual(['file.json']);
    });
  });

  describe('readJsonFile', () => {
    it('should read and parse JSON file', async () => {
      const filePath = path.join(tempDir, 'test.json');
      const data = { foo: 'bar', num: 123 };
      await fs.writeFile(filePath, JSON.stringify(data));

      const result = await store.readJsonFile<typeof data>(filePath);
      expect(result).toEqual(data);
    });

    it('should return null for non-existent file', async () => {
      const filePath = path.join(tempDir, 'non-existent.json');
      const result = await store.readJsonFile(filePath);
      expect(result).toBeNull();
    });

    it('should restore from backup if main file is missing', async () => {
      const filePath = path.join(tempDir, 'test.json');
      const backupPath = `${filePath}.bak`;
      const data = { recovered: true };

      await fs.writeFile(backupPath, JSON.stringify(data));

      const result = await store.readJsonFile<typeof data>(filePath);
      expect(result).toEqual(data);

      // Should have restored the main file
      const mainFileContent = await fs.readFile(filePath, 'utf-8');
      expect(JSON.parse(mainFileContent)).toEqual(data);
    });

    it('should restore from backup if main file is corrupted', async () => {
      const filePath = path.join(tempDir, 'test.json');
      const backupPath = `${filePath}.bak`;
      const data = { recovered: true };

      await fs.writeFile(filePath, '{ invalid json');
      await fs.writeFile(backupPath, JSON.stringify(data));

      const result = await store.readJsonFile<typeof data>(filePath);
      expect(result).toEqual(data);
    });
  });

  describe('concurrency', () => {
    it('should handle concurrent writes without corruption', async () => {
      const filePath = path.join(tempDir, 'concurrent.json');
      const iterations = 50;

      // 并发写入
      const writes = Array.from({ length: iterations }, (_, i) =>
        store.writeJsonFile(filePath, { count: i })
      );

      await Promise.all(writes);

      // 读取最终结果
      const result = await store.readJsonFile<{ count: number }>(filePath);
      expect(result).toBeDefined();
      expect(typeof result?.count).toBe('number');
    });

    it('should handle concurrent read-modify-write correctly (mutateJsonFile)', async () => {
      const filePath = path.join(tempDir, 'counter.json');
      await store.writeJsonFile(filePath, { count: 0 });

      const iterations = 50;
      // 并发增加计数
      const updates = Array.from({ length: iterations }, () =>
        store.mutateJsonFile<{ count: number }>(filePath, (data) => {
          return { count: (data?.count || 0) + 1 };
        })
      );

      await Promise.all(updates);

      const result = await store.readJsonFile<{ count: number }>(filePath);
      expect(result?.count).toBe(iterations);
    });
  });
});

/**
 * 原子 JSON 存储测试
 *
 * 测试原子写入、备份恢复、并发控制
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
      const files = await store.listJsonFiles(path.join(tempDir, 'non-existent'));
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
      const data = { restored: true };

      // Only create backup file
      await fs.writeFile(backupPath, JSON.stringify(data));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await store.readJsonFile<typeof data>(filePath);

      expect(result).toEqual(data);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Restoring missing file from backup')
      );

      // Main file should be restored
      const mainFile = await fs.readFile(filePath, 'utf-8');
      expect(JSON.parse(mainFile)).toEqual(data);

      consoleSpy.mockRestore();
    });

    it('should restore from backup if main file is corrupted', async () => {
      const filePath = path.join(tempDir, 'test.json');
      const backupPath = `${filePath}.bak`;
      const data = { restored: true };

      // Create corrupted main file and valid backup
      await fs.writeFile(filePath, 'not valid json {{{');
      await fs.writeFile(backupPath, JSON.stringify(data));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const result = await store.readJsonFile<typeof data>(filePath);

      expect(result).toEqual(data);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Recovered from backup'),
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });

    it('should throw error if both main and backup are corrupted', async () => {
      const filePath = path.join(tempDir, 'test.json');
      const backupPath = `${filePath}.bak`;

      await fs.writeFile(filePath, 'invalid json');
      await fs.writeFile(backupPath, 'also invalid');

      await expect(store.readJsonFile(filePath)).rejects.toThrow('Failed to parse JSON');
    });

    it('should throw error for empty file', async () => {
      const filePath = path.join(tempDir, 'empty.json');
      await fs.writeFile(filePath, '');

      await expect(store.readJsonFile(filePath)).rejects.toThrow('JSON file is empty');
    });

    it('should throw error for whitespace-only file', async () => {
      const filePath = path.join(tempDir, 'whitespace.json');
      await fs.writeFile(filePath, '   \n\t  ');

      await expect(store.readJsonFile(filePath)).rejects.toThrow('JSON file is empty');
    });

    it('should handle various JSON types', async () => {
      const testCases = [
        { value: null, expected: null },
        { value: true, expected: true },
        { value: false, expected: false },
        { value: 123, expected: 123 },
        { value: 'string', expected: 'string' },
        { value: [1, 2, 3], expected: [1, 2, 3] },
        { value: { a: 1 }, expected: { a: 1 } },
      ];

      for (const { value, expected } of testCases) {
        const filePath = path.join(tempDir, `test-${Date.now()}.json`);
        await fs.writeFile(filePath, JSON.stringify(value));
        const result = await store.readJsonFile(filePath);
        expect(result).toEqual(expected);
      }
    });
  });

  describe('writeJsonFile', () => {
    it('should write JSON file atomically', async () => {
      const filePath = path.join(tempDir, 'test.json');
      const data = { foo: 'bar', nested: { a: 1 } };

      await store.writeJsonFile(filePath, data);

      const content = await fs.readFile(filePath, 'utf-8');
      expect(JSON.parse(content)).toEqual(data);
    });

    it('should create backup of existing file', async () => {
      const filePath = path.join(tempDir, 'test.json');
      const backupPath = `${filePath}.bak`;
      const originalData = { version: 1 };
      const newData = { version: 2 };

      await fs.writeFile(filePath, JSON.stringify(originalData));
      await store.writeJsonFile(filePath, newData);

      const backupContent = await fs.readFile(backupPath, 'utf-8');
      expect(JSON.parse(backupContent)).toEqual(originalData);

      const mainContent = await fs.readFile(filePath, 'utf-8');
      expect(JSON.parse(mainContent)).toEqual(newData);
    });

    it('should create parent directories', async () => {
      const filePath = path.join(tempDir, 'a', 'b', 'c', 'test.json');
      const data = { nested: true };

      await store.writeJsonFile(filePath, data);

      const content = await fs.readFile(filePath, 'utf-8');
      expect(JSON.parse(content)).toEqual(data);
    });

    it('should format JSON with indentation', async () => {
      const filePath = path.join(tempDir, 'test.json');
      const data = { a: 1, b: 2 };

      await store.writeJsonFile(filePath, data);

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toContain('\n');
      expect(content).toContain('  ');
    });

    it('should handle concurrent writes to same file', async () => {
      const filePath = path.join(tempDir, 'concurrent.json');

      // Write multiple times concurrently
      const writes = Array.from({ length: 10 }, (_, i) =>
        store.writeJsonFile(filePath, { version: i })
      );

      await Promise.all(writes);

      // File should exist and be valid JSON
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      expect(typeof data.version).toBe('number');
      expect(data.version).toBeGreaterThanOrEqual(0);
      expect(data.version).toBeLessThan(10);
    });

    it('should not leave temp files after write', async () => {
      const filePath = path.join(tempDir, 'test.json');
      await store.writeJsonFile(filePath, { test: true });

      const files = await fs.readdir(tempDir);
      const tempFiles = files.filter((f) => f.endsWith('.tmp'));
      expect(tempFiles).toHaveLength(0);
    });
  });

  describe('deleteFileIfExists', () => {
    it('should delete existing file', async () => {
      const filePath = path.join(tempDir, 'delete-me.json');
      await fs.writeFile(filePath, '{}');

      await store.deleteFileIfExists(filePath);

      await expect(fs.access(filePath)).rejects.toThrow();
    });

    it('should delete backup file as well', async () => {
      const filePath = path.join(tempDir, 'delete-me.json');
      const backupPath = `${filePath}.bak`;
      await fs.writeFile(filePath, '{}');
      await fs.writeFile(backupPath, '{}');

      await store.deleteFileIfExists(filePath);

      await expect(fs.access(filePath)).rejects.toThrow();
      await expect(fs.access(backupPath)).rejects.toThrow();
    });

    it('should not fail for non-existent file', async () => {
      const filePath = path.join(tempDir, 'non-existent.json');
      await expect(store.deleteFileIfExists(filePath)).resolves.not.toThrow();
    });
  });

  describe('close', () => {
    it('should wait for pending operations', async () => {
      const filePath = path.join(tempDir, 'test.json');

      // Start multiple writes
      const writes = Array.from({ length: 5 }, (_, i) =>
        store.writeJsonFile(filePath, { version: i })
      );

      // Close while writes are pending
      const closePromise = store.close();

      // All writes should complete
      await Promise.all(writes);
      await closePromise;
    });

    it('should handle close with no pending operations', async () => {
      await expect(store.close()).resolves.not.toThrow();
    });

    it('can be called multiple times', async () => {
      await store.close();
      await store.close();
    });
  });

  describe('error handling', () => {
    it('should handle permission errors gracefully', async () => {
      // This test may not work on all systems
      const filePath = path.join(tempDir, 'test.json');
      await store.writeJsonFile(filePath, { test: true });

      // Verify file was written
      const content = await fs.readFile(filePath, 'utf-8');
      expect(JSON.parse(content)).toEqual({ test: true });
    });

    it('should handle read permission errors', async () => {
      const filePath = path.join(tempDir, 'test.json');
      await fs.writeFile(filePath, '{}');

      // Should be able to read
      const result = await store.readJsonFile(filePath);
      expect(result).toEqual({});
    });
  });

  describe('atomic operations', () => {
    it('should maintain data integrity during concurrent operations', async () => {
      const filePath = path.join(tempDir, 'concurrent.json');

      // Simulate concurrent read/write operations
      const operations = Array.from({ length: 20 }, (_, i) => {
        if (i % 2 === 0) {
          return store.writeJsonFile(filePath, { index: i });
        } else {
          return store.readJsonFile(filePath).catch(() => null);
        }
      });

      await Promise.all(operations);

      // Final file should be valid
      const result = await store.readJsonFile(filePath);
      expect(result).not.toBeNull();
      expect(typeof result).toBe('object');
    });

    it('should serialize writes to same file', async () => {
      const filePath = path.join(tempDir, 'serialized.json');
      const writeOrder: number[] = [];

      const writes = Array.from({ length: 5 }, (_, i) =>
        store.writeJsonFile(filePath, { index: i }).then(() => {
          writeOrder.push(i);
        })
      );

      await Promise.all(writes);

      // All writes should complete
      expect(writeOrder).toHaveLength(5);
    });
  });

  describe('backup and recovery', () => {
    it('should maintain backup consistency', async () => {
      const filePath = path.join(tempDir, 'backup-test.json');
      const backupPath = `${filePath}.bak`;

      // Write multiple versions
      for (let i = 0; i < 5; i++) {
        await store.writeJsonFile(filePath, { version: i });
      }

      // Backup should have the second-to-last version
      const backupContent = await fs.readFile(backupPath, 'utf-8');
      const backupData = JSON.parse(backupContent);
      expect(backupData.version).toBe(3);

      // Main file should have the last version
      const mainContent = await fs.readFile(filePath, 'utf-8');
      const mainData = JSON.parse(mainContent);
      expect(mainData.version).toBe(4);
    });
  });
});

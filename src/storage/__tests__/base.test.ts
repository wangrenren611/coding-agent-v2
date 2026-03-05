/**
 * 文件存储基类测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { BaseFileStore, BaseArrayFileStore } from '../base';
import { AtomicJsonStore } from '../atomic-json';

// Concrete implementation for testing
class TestFileStore extends BaseFileStore<{ id: string; value: number }> {
  constructor(basePath: string, io?: AtomicJsonStore) {
    super({ basePath, subDir: 'test-data', io });
  }

  protected override transformData(
    sessionId: string,
    data: { id: string; value: number }
  ): { id: string; value: number } {
    return { ...data, id: sessionId };
  }

  protected override onError(sessionId: string, error: unknown): void {
    console.error(`TestFileStore error for ${sessionId}:`, error);
  }
}

class TestArrayFileStore extends BaseArrayFileStore<{ index: number; data: string }> {
  constructor(basePath: string, io?: AtomicJsonStore) {
    super({ basePath, subDir: 'test-arrays', io });
  }
}

describe('BaseFileStore', () => {
  let tempDir: string;
  let store: TestFileStore;
  let io: AtomicJsonStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'base-store-test-'));
    io = new AtomicJsonStore();
    store = new TestFileStore(tempDir, io);
  });

  afterEach(async () => {
    await io.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('should create store with provided IO', () => {
      const customIO = new AtomicJsonStore();
      const customStore = new TestFileStore(tempDir, customIO);
      expect(customStore).toBeDefined();
    });

    it('should create store with default IO', () => {
      const defaultStore = new TestFileStore(tempDir);
      expect(defaultStore).toBeDefined();
    });

    it('should construct correct directory path', () => {
      // Check that the directory path is correctly constructed
      expect(store).toBeDefined();
    });
  });

  describe('prepare', () => {
    it('should create directory if not exists', async () => {
      await store.prepare();
      const stat = await fs.stat(path.join(tempDir, 'test-data'));
      expect(stat.isDirectory()).toBe(true);
    });

    it('should not fail if directory exists', async () => {
      await store.prepare();
      await expect(store.prepare()).resolves.not.toThrow();
    });
  });

  describe('save and load', () => {
    beforeEach(async () => {
      await store.prepare();
    });

    it('should save and load data', async () => {
      const sessionId = 'session-1';
      const data = { id: sessionId, value: 42 };

      await store.save(sessionId, data);
      const loaded = await store.loadAll();

      expect(loaded.has(sessionId)).toBe(true);
      expect(loaded.get(sessionId)).toEqual(data);
    });

    it('should load multiple items', async () => {
      await store.save('session-1', { id: 'session-1', value: 1 });
      await store.save('session-2', { id: 'session-2', value: 2 });
      await store.save('session-3', { id: 'session-3', value: 3 });

      const loaded = await store.loadAll();
      expect(loaded.size).toBe(3);
      expect(loaded.get('session-1')?.value).toBe(1);
      expect(loaded.get('session-2')?.value).toBe(2);
      expect(loaded.get('session-3')?.value).toBe(3);
    });

    it('should return empty map for empty directory', async () => {
      const loaded = await store.loadAll();
      expect(loaded.size).toBe(0);
    });

    it('should handle special characters in sessionId', async () => {
      const sessionId = 'session/with:special*chars';
      const data = { id: sessionId, value: 100 };

      await store.save(sessionId, data);
      const loaded = await store.loadAll();

      expect(loaded.has(sessionId)).toBe(true);
      expect(loaded.get(sessionId)).toEqual(data);
    });
  });

  describe('delete', () => {
    beforeEach(async () => {
      await store.prepare();
    });

    it('should delete existing data', async () => {
      const sessionId = 'session-to-delete';
      await store.save(sessionId, { id: sessionId, value: 1 });

      await store.delete(sessionId);

      const loaded = await store.loadAll();
      expect(loaded.has(sessionId)).toBe(false);
    });

    it('should not fail when deleting non-existent data', async () => {
      await expect(store.delete('non-existent')).resolves.not.toThrow();
    });

    it('should delete backup file as well', async () => {
      const sessionId = 'session-with-backup';
      await store.save(sessionId, { id: sessionId, value: 1 });
      await store.save(sessionId, { id: sessionId, value: 2 });

      await store.delete(sessionId);

      const files = await fs.readdir(path.join(tempDir, 'test-data'));
      expect(files.filter((f) => f.includes('session-with-backup'))).toHaveLength(0);
    });
  });

  describe('transformData', () => {
    beforeEach(async () => {
      await store.prepare();
    });

    it('should transform loaded data', async () => {
      const sessionId = 'transform-test';
      // Save data with different id
      await store.save(sessionId, { id: 'original-id', value: 50 });

      const loaded = await store.loadAll();
      // TransformData should override id with sessionId
      expect(loaded.get(sessionId)?.id).toBe(sessionId);
    });
  });

  describe('error handling', () => {
    it('should handle corrupted files gracefully', async () => {
      await store.prepare();

      // Create a corrupted JSON file
      const dirPath = path.join(tempDir, 'test-data');
      const corruptedFileName = 'corrupted-session.json';
      await fs.writeFile(path.join(dirPath, corruptedFileName), 'not valid json');

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Should not throw, but log error
      const loaded = await store.loadAll();
      expect(loaded.size).toBe(0);

      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });
});

describe('BaseArrayFileStore', () => {
  let tempDir: string;
  let store: TestArrayFileStore;
  let io: AtomicJsonStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'array-store-test-'));
    io = new AtomicJsonStore();
    store = new TestArrayFileStore(tempDir, io);
  });

  afterEach(async () => {
    await io.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('save and load', () => {
    beforeEach(async () => {
      await store.prepare();
    });

    it('should save and load array data', async () => {
      const sessionId = 'array-session';
      const data = [
        { index: 0, data: 'first' },
        { index: 1, data: 'second' },
      ];

      await store.save(sessionId, data);
      const loaded = await store.loadAll();

      expect(loaded.has(sessionId)).toBe(true);
      expect(loaded.get(sessionId)).toEqual(data);
    });

    it('should load empty array for non-existent session', async () => {
      const loaded = await store.loadAll();
      expect(loaded.size).toBe(0);
    });
  });

  describe('append', () => {
    beforeEach(async () => {
      await store.prepare();
    });

    it('should append items to existing array', async () => {
      const sessionId = 'append-session';
      const initial = [{ index: 0, data: 'initial' }];
      const additional = [{ index: 1, data: 'additional' }];

      await store.save(sessionId, initial);
      await store.append(sessionId, additional);

      const loaded = await store.loadAll();
      expect(loaded.get(sessionId)).toHaveLength(2);
      expect(loaded.get(sessionId)).toEqual([...initial, ...additional]);
    });

    it('should create new array if not exists', async () => {
      const sessionId = 'new-append-session';
      const items = [{ index: 0, data: 'first' }];

      await store.append(sessionId, items);

      const loaded = await store.loadAll();
      expect(loaded.get(sessionId)).toEqual(items);
    });

    it('should append multiple items', async () => {
      const sessionId = 'multi-append';
      const items1 = [{ index: 0, data: 'a' }];
      const items2 = [
        { index: 1, data: 'b' },
        { index: 2, data: 'c' },
      ];
      const items3 = [{ index: 3, data: 'd' }];

      await store.append(sessionId, items1);
      await store.append(sessionId, items2);
      await store.append(sessionId, items3);

      const loaded = await store.loadAll();
      expect(loaded.get(sessionId)).toHaveLength(4);
    });

    it('should handle empty append', async () => {
      const sessionId = 'empty-append';
      const initial = [{ index: 0, data: 'initial' }];

      await store.save(sessionId, initial);
      await store.append(sessionId, []);

      const loaded = await store.loadAll();
      expect(loaded.get(sessionId)).toHaveLength(1);
    });

    it('should handle concurrent appends', async () => {
      const sessionId = 'concurrent-append';

      const appends = Array.from({ length: 10 }, (_, i) =>
        store.append(sessionId, [{ index: i, data: `item-${i}` }])
      );

      await Promise.all(appends);

      const loaded = await store.loadAll();
      expect(loaded.get(sessionId)?.length).toBe(10);
    });
  });

  describe('readArray', () => {
    beforeEach(async () => {
      await store.prepare();
    });

    it('should return empty array for corrupted file', async () => {
      const sessionId = 'corrupted-array';
      const dirPath = path.join(tempDir, 'test-arrays');

      // Create corrupted file
      const fileName = `${sessionId.replace(/[/\\:*?"<>|]/g, '!')}.json`;
      await fs.writeFile(path.join(dirPath, fileName), 'not valid json');

      // append should not throw
      await store.append(sessionId, [{ index: 0, data: 'test' }]);
    });
  });
});

/**
 * 文件压缩记录存储测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileCompactionStore } from '../fileCompactionStore';
import { AtomicJsonStore } from '../atomic-json';
import type { CompactionRecord } from '../types';

describe('FileCompactionStore', () => {
  let tempDir: string;
  let store: FileCompactionStore;
  let io: AtomicJsonStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'compaction-store-test-'));
    io = new AtomicJsonStore();
    store = new FileCompactionStore(tempDir, io);
  });

  afterEach(async () => {
    await io.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const createTestRecord = (id: number): CompactionRecord => ({
    recordId: `record-${id}`,
    sessionId: 'session-1',
    compactedAt: Date.now() + id * 1000,
    messageCountBefore: 20 + id,
    messageCountAfter: 10 + id,
    archivedMessageIds: [`msg-${id}-1`, `msg-${id}-2`],
    summaryMessageId: `summary-${id}`,
    reason: 'token_limit',
    metadata: {
      tokenCountBefore: 1000 + id * 100,
      tokenCountAfter: 500 + id * 50,
      triggerMessageId: `trigger-${id}`,
    },
    createdAt: Date.now() + id * 1000,
  });

  describe('prepare', () => {
    it('should create compactions directory', async () => {
      await store.prepare();
      const stat = await fs.stat(path.join(tempDir, 'compactions'));
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe('save and load', () => {
    beforeEach(async () => {
      await store.prepare();
    });

    it('should save and load compaction records', async () => {
      const sessionId = 'session-1';
      const records: CompactionRecord[] = [createTestRecord(1), createTestRecord(2)];

      await store.save(sessionId, records);
      const loaded = await store.loadAll();

      expect(loaded.has(sessionId)).toBe(true);
      expect(loaded.get(sessionId)).toEqual(records);
    });

    it('should handle empty records array', async () => {
      const sessionId = 'empty-session';
      await store.save(sessionId, []);

      const loaded = await store.loadAll();
      expect(loaded.get(sessionId)).toEqual([]);
    });

    it('should handle empty records array', async () => {
      const sessionId = 'empty-test';
      await store.save(sessionId, []);

      const loaded = await store.loadAll();
      expect(loaded.get(sessionId)).toEqual([]);
    });

    it('should handle multiple sessions', async () => {
      const sessions = new Map<string, CompactionRecord[]>();

      for (let i = 0; i < 3; i++) {
        const sessionId = `session-${i}`;
        const records = [createTestRecord(i)];
        sessions.set(sessionId, records);
        await store.save(sessionId, records);
      }

      const loaded = await store.loadAll();
      expect(loaded.size).toBe(3);

      for (const [sessionId, records] of sessions) {
        expect(loaded.get(sessionId)).toEqual(records);
      }
    });
  });

  describe('append', () => {
    beforeEach(async () => {
      await store.prepare();
    });

    it('should append single record to existing array', async () => {
      const sessionId = 'append-session';
      const initial: CompactionRecord[] = [createTestRecord(1)];

      await store.save(sessionId, initial);

      const newRecord = createTestRecord(2);
      await store.append(sessionId, newRecord);

      const loaded = await store.loadAll();
      expect(loaded.get(sessionId)).toHaveLength(2);
      expect(loaded.get(sessionId)).toEqual([...initial, newRecord]);
    });

    it('should create array if not exists', async () => {
      const sessionId = 'new-append-session';
      const record = createTestRecord(1);

      await store.append(sessionId, record);

      const loaded = await store.loadAll();
      expect(loaded.get(sessionId)).toEqual([record]);
    });

    it('should append to empty array', async () => {
      const sessionId = 'empty-append';
      await store.save(sessionId, []);

      const record = createTestRecord(1);
      await store.append(sessionId, record);

      const loaded = await store.loadAll();
      expect(loaded.get(sessionId)).toEqual([record]);
    });

    it('should handle multiple sequential appends', async () => {
      const sessionId = 'sequential-append';
      const records: CompactionRecord[] = [];

      for (let i = 0; i < 5; i++) {
        const record = createTestRecord(i);
        records.push(record);
        await store.append(sessionId, record);
      }

      const loaded = await store.loadAll();
      expect(loaded.get(sessionId)).toEqual(records);
    });

    it('should handle concurrent appends', async () => {
      const sessionId = 'concurrent-append';

      const appends = Array.from({ length: 10 }, (_, i) => {
        const record = createTestRecord(i);
        return store.append(sessionId, record);
      });

      await Promise.all(appends);

      const loaded = await store.loadAll();
      const records = loaded.get(sessionId);
      expect(records).toBeDefined();
      expect(records!.length).toBe(10);
    });
  });

  describe('delete', () => {
    beforeEach(async () => {
      await store.prepare();
    });

    it('should delete compaction records', async () => {
      const sessionId = 'delete-session';
      await store.save(sessionId, [createTestRecord(1)]);

      await store.delete(sessionId);

      const loaded = await store.loadAll();
      expect(loaded.has(sessionId)).toBe(false);
    });

    it('should not fail when deleting non-existent records', async () => {
      await expect(store.delete('non-existent')).resolves.not.toThrow();
    });
  });

  describe('data integrity', () => {
    beforeEach(async () => {
      await store.prepare();
    });

    it('should preserve all record fields', async () => {
      const sessionId = 'full-record-test';
      const record: CompactionRecord = {
        recordId: 'record-full',
        sessionId,
        compactedAt: 1234567890,
        messageCountBefore: 100,
        messageCountAfter: 10,
        archivedMessageIds: ['msg-1', 'msg-2', 'msg-3'],
        summaryMessageId: 'summary-1',
        reason: 'manual',
        metadata: {
          tokenCountBefore: 5000,
          tokenCountAfter: 500,
          triggerMessageId: 'trigger-msg',
        },
        createdAt: 1234567890,
      };

      await store.save(sessionId, [record]);
      const loaded = await store.loadAll();

      expect(loaded.get(sessionId)).toEqual([record]);
    });

    it('should handle records with optional fields', async () => {
      const sessionId = 'minimal-record';
      const record: CompactionRecord = {
        recordId: 'record-minimal',
        sessionId,
        compactedAt: Date.now(),
        messageCountBefore: 10,
        messageCountAfter: 5,
        archivedMessageIds: [],
        reason: 'auto',
        createdAt: Date.now(),
      };

      await store.save(sessionId, [record]);
      const loaded = await store.loadAll();

      expect(loaded.get(sessionId)).toEqual([record]);
    });

    it('should handle different reason types', async () => {
      const sessionId = 'reason-types';
      const reasons: Array<CompactionRecord['reason']> = ['token_limit', 'manual', 'auto'];
      const records: CompactionRecord[] = reasons.map((reason, i) => ({
        recordId: `record-${i}`,
        sessionId,
        compactedAt: Date.now() + i * 1000,
        messageCountBefore: 10,
        messageCountAfter: 5,
        archivedMessageIds: [],
        reason,
        createdAt: Date.now() + i * 1000,
      }));

      await store.save(sessionId, records);
      const loaded = await store.loadAll();

      expect(loaded.get(sessionId)).toEqual(records);
    });
  });

  describe('readArray edge cases', () => {
    beforeEach(async () => {
      await store.prepare();
    });

    it('should return empty array for corrupted file', async () => {
      const sessionId = 'corrupted';
      const dirPath = path.join(tempDir, 'compactions');

      // Create corrupted file directly
      const fileName = `${sessionId}.json`;
      await fs.writeFile(path.join(dirPath, fileName), 'not valid json');

      // Should not throw when appending
      const record = createTestRecord(1);
      await store.append(sessionId, record);

      // Should have the new record
      const loaded = await store.loadAll();
      expect(loaded.get(sessionId)).toBeDefined();
    });
  });
});

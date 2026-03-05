/**
 * 文件历史存储测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileHistoryStore } from '../fileHistoryStore';
import { AtomicJsonStore } from '../atomic-json';
import type { HistoryMessage } from '../types';

describe('FileHistoryStore', () => {
  let tempDir: string;
  let store: FileHistoryStore;
  let io: AtomicJsonStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'history-store-test-'));
    io = new AtomicJsonStore();
    store = new FileHistoryStore(tempDir, io);
  });

  afterEach(async () => {
    await io.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const createTestMessage = (
    sequence: number,
    role: 'user' | 'assistant' = 'user'
  ): HistoryMessage => ({
    messageId: `msg-${sequence}`,
    role,
    content: `Message ${sequence}`,
    sequence,
    turn: Math.ceil(sequence / 2),
    createdAt: Date.now() + sequence * 1000,
  });

  describe('prepare', () => {
    it('should create histories directory', async () => {
      await store.prepare();
      const stat = await fs.stat(path.join(tempDir, 'histories'));
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe('save and load', () => {
    beforeEach(async () => {
      await store.prepare();
    });

    it('should save and load history', async () => {
      const sessionId = 'session-1';
      const messages: HistoryMessage[] = [
        createTestMessage(1, 'user'),
        createTestMessage(2, 'assistant'),
      ];

      await store.save(sessionId, messages);
      const loaded = await store.loadAll();

      expect(loaded.has(sessionId)).toBe(true);
      expect(loaded.get(sessionId)).toEqual(messages);
    });

    it('should handle empty history', async () => {
      const sessionId = 'empty-session';
      await store.save(sessionId, []);

      const loaded = await store.loadAll();
      expect(loaded.get(sessionId)).toEqual([]);
    });

    it('should handle large history', async () => {
      const sessionId = 'large-session';
      const messages: HistoryMessage[] = [];

      for (let i = 1; i <= 100; i++) {
        messages.push(createTestMessage(i, i % 2 === 1 ? 'user' : 'assistant'));
      }

      await store.save(sessionId, messages);
      const loaded = await store.loadAll();

      expect(loaded.get(sessionId)).toHaveLength(100);
    });

    it('should handle multiple sessions', async () => {
      const sessions = new Map<string, HistoryMessage[]>();

      for (let i = 0; i < 5; i++) {
        const sessionId = `session-${i}`;
        const messages = [createTestMessage(1), createTestMessage(2)];
        sessions.set(sessionId, messages);
        await store.save(sessionId, messages);
      }

      const loaded = await store.loadAll();
      expect(loaded.size).toBe(5);

      for (const [sessionId, messages] of sessions) {
        expect(loaded.get(sessionId)).toEqual(messages);
      }
    });
  });

  describe('append', () => {
    beforeEach(async () => {
      await store.prepare();
    });

    it('should append messages to existing history', async () => {
      const sessionId = 'append-session';
      const initial: HistoryMessage[] = [createTestMessage(1), createTestMessage(2)];

      await store.save(sessionId, initial);

      const additional: HistoryMessage[] = [createTestMessage(3), createTestMessage(4)];
      await store.append(sessionId, additional);

      const loaded = await store.loadAll();
      expect(loaded.get(sessionId)).toHaveLength(4);
      expect(loaded.get(sessionId)).toEqual([...initial, ...additional]);
    });

    it('should create history if not exists', async () => {
      const sessionId = 'new-session';
      const messages = [createTestMessage(1)];

      await store.append(sessionId, messages);

      const loaded = await store.loadAll();
      expect(loaded.get(sessionId)).toEqual(messages);
    });

    it('should append to empty history', async () => {
      const sessionId = 'empty-append';
      await store.save(sessionId, []);

      const messages = [createTestMessage(1)];
      await store.append(sessionId, messages);

      const loaded = await store.loadAll();
      expect(loaded.get(sessionId)).toEqual(messages);
    });

    it('should handle empty append', async () => {
      const sessionId = 'empty-append-test';
      const initial = [createTestMessage(1)];

      await store.save(sessionId, initial);
      await store.append(sessionId, []);

      const loaded = await store.loadAll();
      expect(loaded.get(sessionId)).toEqual(initial);
    });

    it('should handle concurrent appends', async () => {
      const sessionId = 'concurrent-append';

      const appends = Array.from({ length: 10 }, (_, i) => {
        const msg = createTestMessage(i + 1);
        return store.append(sessionId, [msg]);
      });

      await Promise.all(appends);

      const loaded = await store.loadAll();
      const history = loaded.get(sessionId);
      expect(history).toBeDefined();
      expect(history!.length).toBeGreaterThan(0);
      expect(history!.length).toBeLessThanOrEqual(10);
    });
  });

  describe('delete', () => {
    beforeEach(async () => {
      await store.prepare();
    });

    it('should delete history', async () => {
      const sessionId = 'delete-session';
      await store.save(sessionId, [createTestMessage(1)]);

      await store.delete(sessionId);

      const loaded = await store.loadAll();
      expect(loaded.has(sessionId)).toBe(false);
    });

    it('should not fail when deleting non-existent history', async () => {
      await expect(store.delete('non-existent')).resolves.not.toThrow();
    });
  });

  describe('data integrity', () => {
    beforeEach(async () => {
      await store.prepare();
    });

    it('should preserve all message fields', async () => {
      const sessionId = 'full-message-test';
      const messages: HistoryMessage[] = [
        {
          messageId: 'msg-full',
          role: 'assistant',
          content: 'Full message',
          sequence: 1,
          turn: 1,
          isSummary: true,
          archivedBy: 'compaction-1',
          excludedFromContext: true,
          excludedReason: 'compression',
          createdAt: 1000,
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: 'test_fn',
                arguments: '{"a": 1}',
              },
            },
          ],
          tool_call_id: 'call-1',
          name: 'test_fn',
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
        },
      ];

      await store.save(sessionId, messages);
      const loaded = await store.loadAll();

      const loadedMsg = loaded.get(sessionId)?.[0];
      expect(loadedMsg).toEqual(messages[0]);
    });

    it('should handle messages with special characters', async () => {
      const sessionId = 'special-chars';
      const messages: HistoryMessage[] = [
        {
          messageId: 'msg-special',
          role: 'user',
          content: 'Message with special chars: <>&"\'\n\t\r',
          sequence: 1,
          createdAt: Date.now(),
        },
      ];

      await store.save(sessionId, messages);
      const loaded = await store.loadAll();

      expect(loaded.get(sessionId)?.[0].content).toBe('Message with special chars: <>&"\'\n\t\r');
    });

    it('should handle unicode content', async () => {
      const sessionId = 'unicode-test';
      const messages: HistoryMessage[] = [
        {
          messageId: 'msg-unicode',
          role: 'user',
          content: '你好世界 🌍 مرحبا العالم',
          sequence: 1,
          createdAt: Date.now(),
        },
      ];

      await store.save(sessionId, messages);
      const loaded = await store.loadAll();

      expect(loaded.get(sessionId)?.[0].content).toBe('你好世界 🌍 مرحبا العالم');
    });
  });

  describe('overwrite behavior', () => {
    beforeEach(async () => {
      await store.prepare();
    });

    it('should overwrite existing history on save', async () => {
      const sessionId = 'overwrite-test';

      await store.save(sessionId, [createTestMessage(1), createTestMessage(2)]);
      await store.save(sessionId, [createTestMessage(10)]);

      const loaded = await store.loadAll();
      expect(loaded.get(sessionId)).toHaveLength(1);
      expect(loaded.get(sessionId)?.[0].sequence).toBe(10);
    });
  });
});

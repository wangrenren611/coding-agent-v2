/**
 * 文件上下文存储测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileContextStorage } from '../fileContextStore';
import { AtomicJsonStore } from '../atomic-json';
import type { ContextData } from '../types';

describe('FileContextStorage', () => {
  let tempDir: string;
  let store: FileContextStorage;
  let io: AtomicJsonStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'context-store-test-'));
    io = new AtomicJsonStore();
    store = new FileContextStorage(tempDir, io);
  });

  afterEach(async () => {
    await io.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const createTestContext = (sessionId: string): ContextData => ({
    contextId: `ctx-${sessionId}`,
    sessionId,
    systemPrompt: 'You are a helpful assistant.',
    messages: [
      {
        messageId: 'msg-1',
        role: 'system',
        content: 'You are a helpful assistant.',
        sequence: 1,
        createdAt: Date.now(),
      },
    ],
    version: 1,
    stats: {
      totalMessagesInHistory: 1,
      compactionCount: 0,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  describe('prepare', () => {
    it('should create contexts directory', async () => {
      await store.prepare();
      const stat = await fs.stat(path.join(tempDir, 'contexts'));
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe('save and load', () => {
    beforeEach(async () => {
      await store.prepare();
    });

    it('should save and load context', async () => {
      const sessionId = 'session-1';
      const context = createTestContext(sessionId);

      await store.save(sessionId, context);
      const loaded = await store.loadAll();

      expect(loaded.has(sessionId)).toBe(true);
      expect(loaded.get(sessionId)).toEqual(context);
    });

    it('should handle multiple contexts', async () => {
      const contexts = new Map<string, ContextData>();

      for (let i = 0; i < 5; i++) {
        const sessionId = `session-${i}`;
        const context = createTestContext(sessionId);
        contexts.set(sessionId, context);
        await store.save(sessionId, context);
      }

      const loaded = await store.loadAll();
      expect(loaded.size).toBe(5);

      for (const [sessionId, context] of contexts) {
        expect(loaded.get(sessionId)).toEqual(context);
      }
    });

    it('should persist context with messages', async () => {
      const sessionId = 'session-with-messages';
      const context: ContextData = {
        contextId: 'ctx-1',
        sessionId,
        systemPrompt: 'System prompt',
        messages: [
          {
            messageId: 'msg-1',
            role: 'system',
            content: 'System prompt',
            sequence: 1,
            createdAt: 1000,
          },
          {
            messageId: 'msg-2',
            role: 'user',
            content: 'Hello',
            sequence: 2,
            createdAt: 2000,
          },
          {
            messageId: 'msg-3',
            role: 'assistant',
            content: 'Hi there!',
            sequence: 3,
            createdAt: 3000,
          },
        ],
        version: 3,
        stats: {
          totalMessagesInHistory: 3,
          compactionCount: 0,
        },
        createdAt: 1000,
        updatedAt: 3000,
      };

      await store.save(sessionId, context);
      const loaded = await store.loadAll();

      const loadedContext = loaded.get(sessionId);
      expect(loadedContext).toBeDefined();
      expect(loadedContext?.messages).toHaveLength(3);
      expect(loadedContext?.messages[0].role).toBe('system');
      expect(loadedContext?.messages[1].role).toBe('user');
      expect(loadedContext?.messages[2].role).toBe('assistant');
    });

    it('should handle context with compaction info', async () => {
      const sessionId = 'compacted-session';
      const context: ContextData = {
        contextId: 'ctx-1',
        sessionId,
        systemPrompt: 'System prompt',
        messages: [
          {
            messageId: 'msg-summary',
            role: 'assistant',
            content: 'Summary of previous messages',
            sequence: 10,
            isSummary: true,
            createdAt: 5000,
          },
        ],
        version: 5,
        lastCompactionId: 'compaction-1',
        stats: {
          totalMessagesInHistory: 20,
          compactionCount: 1,
          lastCompactionAt: 5000,
        },
        createdAt: 1000,
        updatedAt: 5000,
      };

      await store.save(sessionId, context);
      const loaded = await store.loadAll();

      const loadedContext = loaded.get(sessionId);
      expect(loadedContext?.lastCompactionId).toBe('compaction-1');
      expect(loadedContext?.stats.compactionCount).toBe(1);
      expect(loadedContext?.stats.lastCompactionAt).toBe(5000);
    });
  });

  describe('delete', () => {
    beforeEach(async () => {
      await store.prepare();
    });

    it('should delete context', async () => {
      const sessionId = 'session-to-delete';
      await store.save(sessionId, createTestContext(sessionId));

      await store.delete(sessionId);

      const loaded = await store.loadAll();
      expect(loaded.has(sessionId)).toBe(false);
    });

    it('should not fail when deleting non-existent context', async () => {
      await expect(store.delete('non-existent')).resolves.not.toThrow();
    });
  });

  describe('data integrity', () => {
    beforeEach(async () => {
      await store.prepare();
    });

    it('should preserve all message fields', async () => {
      const sessionId = 'full-message-test';
      const context: ContextData = {
        contextId: 'ctx-1',
        sessionId,
        systemPrompt: 'System',
        messages: [
          {
            messageId: 'msg-1',
            role: 'assistant',
            content: 'Response',
            sequence: 1,
            turn: 1,
            isSummary: false,
            archivedBy: undefined,
            excludedFromContext: false,
            excludedReason: undefined,
            createdAt: 1000,
            tool_calls: [
              {
                id: 'call-1',
                type: 'function',
                function: {
                  name: 'test_function',
                  arguments: '{"arg": "value"}',
                },
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
            },
          },
        ],
        version: 1,
        stats: {
          totalMessagesInHistory: 1,
          compactionCount: 0,
        },
        createdAt: 1000,
        updatedAt: 1000,
      };

      await store.save(sessionId, context);
      const loaded = await store.loadAll();

      const loadedMsg = loaded.get(sessionId)?.messages[0];
      expect(loadedMsg?.tool_calls).toBeDefined();
      expect(loadedMsg?.tool_calls).toHaveLength(1);
      expect(loadedMsg?.usage).toEqual({
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      });
    });

    it('should handle concurrent saves', async () => {
      const sessionId = 'concurrent-save';

      const saves = Array.from({ length: 10 }, (_, i) => {
        const context = createTestContext(sessionId);
        context.version = i + 1;
        return store.save(sessionId, context);
      });

      await Promise.all(saves);

      const loaded = await store.loadAll();
      expect(loaded.has(sessionId)).toBe(true);
    });
  });
});

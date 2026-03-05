/**
 * 存储接口测试
 *
 * 测试接口定义和类型约束
 */

import { describe, it, expect } from 'vitest';
import type {
  IBaseStorage,
  IContextStorage,
  IHistoryStorage,
  ICompactionStorage,
  ISessionStorage,
  IStorageBundle,
} from '../interfaces';
import type {
  ContextData,
  HistoryMessage,
  CompactionRecord,
  SessionData,
  QueryOptions,
  SessionFilter,
} from '../types';

describe('interfaces', () => {
  describe('IBaseStorage', () => {
    it('should define prepare method', () => {
      const storage: IBaseStorage = {
        prepare: async () => {},
      };
      expect(typeof storage.prepare).toBe('function');
    });
  });

  describe('IContextStorage', () => {
    it('should extend IBaseStorage', () => {
      const storage: IContextStorage = {
        prepare: async () => {},
        loadAll: async () => new Map<string, ContextData>(),
        save: async () => {},
        delete: async () => {},
      };
      expect(typeof storage.prepare).toBe('function');
      expect(typeof storage.loadAll).toBe('function');
      expect(typeof storage.save).toBe('function');
      expect(typeof storage.delete).toBe('function');
    });

    it('should return correct types', async () => {
      const mockContext: ContextData = {
        contextId: 'ctx-1',
        sessionId: 'sess-1',
        systemPrompt: 'Test prompt',
        messages: [],
        version: 1,
        stats: {
          totalMessagesInHistory: 0,
          compactionCount: 0,
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const storage: IContextStorage = {
        prepare: async () => {},
        loadAll: async () => {
          const map = new Map<string, ContextData>();
          map.set('sess-1', mockContext);
          return map;
        },
        save: async (sessionId: string, context: ContextData) => {
          expect(sessionId).toBe('sess-1');
          expect(context).toEqual(mockContext);
        },
        delete: async (sessionId: string) => {
          expect(sessionId).toBe('sess-1');
        },
      };

      const result = await storage.loadAll();
      expect(result.get('sess-1')).toEqual(mockContext);
    });
  });

  describe('IHistoryStorage', () => {
    it('should extend IBaseStorage with array operations', () => {
      const storage: IHistoryStorage = {
        prepare: async () => {},
        loadAll: async () => new Map<string, HistoryMessage[]>(),
        save: async () => {},
        append: async () => {},
        delete: async () => {},
      };
      expect(typeof storage.prepare).toBe('function');
      expect(typeof storage.loadAll).toBe('function');
      expect(typeof storage.save).toBe('function');
      expect(typeof storage.append).toBe('function');
      expect(typeof storage.delete).toBe('function');
    });

    it('should support append operations', async () => {
      const messages: HistoryMessage[] = [];
      const storage: IHistoryStorage = {
        prepare: async () => {},
        loadAll: async () => {
          const map = new Map<string, HistoryMessage[]>();
          map.set('sess-1', messages);
          return map;
        },
        save: async (sessionId: string, history: HistoryMessage[]) => {
          expect(sessionId).toBe('sess-1');
          messages.length = 0;
          messages.push(...history);
        },
        append: async (sessionId: string, newMessages: HistoryMessage[]) => {
          expect(sessionId).toBe('sess-1');
          messages.push(...newMessages);
        },
        delete: async () => {},
      };

      const msg: HistoryMessage = {
        messageId: 'msg-1',
        role: 'user',
        content: 'Hello',
        sequence: 1,
        createdAt: Date.now(),
      };

      await storage.append('sess-1', [msg]);
      expect(messages).toHaveLength(1);
    });
  });

  describe('ICompactionStorage', () => {
    it('should extend IBaseStorage with record operations', () => {
      const storage: ICompactionStorage = {
        prepare: async () => {},
        loadAll: async () => new Map<string, CompactionRecord[]>(),
        save: async () => {},
        append: async () => {},
        delete: async () => {},
      };
      expect(typeof storage.prepare).toBe('function');
      expect(typeof storage.loadAll).toBe('function');
      expect(typeof storage.save).toBe('function');
      expect(typeof storage.append).toBe('function');
      expect(typeof storage.delete).toBe('function');
    });
  });

  describe('ISessionStorage', () => {
    it('should extend IBaseStorage with list operation', () => {
      const storage: ISessionStorage = {
        prepare: async () => {},
        loadAll: async () => new Map<string, SessionData>(),
        save: async () => {},
        delete: async () => {},
        list: async (_options?: QueryOptions, _filter?: SessionFilter) => [],
      };
      expect(typeof storage.prepare).toBe('function');
      expect(typeof storage.loadAll).toBe('function');
      expect(typeof storage.save).toBe('function');
      expect(typeof storage.delete).toBe('function');
      expect(typeof storage.list).toBe('function');
    });

    it('should support filtering and pagination', async () => {
      const sessions: SessionData[] = [
        {
          sessionId: 'sess-1',
          systemPrompt: 'Prompt 1',
          currentContextId: 'ctx-1',
          totalMessages: 10,
          compactionCount: 0,
          totalUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          status: 'active',
          createdAt: 1000,
          updatedAt: 2000,
        },
        {
          sessionId: 'sess-2',
          systemPrompt: 'Prompt 2',
          currentContextId: 'ctx-2',
          totalMessages: 20,
          compactionCount: 1,
          totalUsage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          status: 'completed',
          createdAt: 3000,
          updatedAt: 4000,
        },
      ];

      const storage: ISessionStorage = {
        prepare: async () => {},
        loadAll: async () => {
          const map = new Map<string, SessionData>();
          sessions.forEach((s) => map.set(s.sessionId, s));
          return map;
        },
        save: async () => {},
        delete: async () => {},
        list: async (options?: QueryOptions, filter?: SessionFilter) => {
          let result = [...sessions];

          if (filter?.status) {
            result = result.filter((s) => s.status === filter.status);
          }

          if (options?.orderBy) {
            result.sort((a, b) => {
              const aVal = a[options.orderBy!];
              const bVal = b[options.orderBy!];
              return options.orderDirection === 'desc' ? bVal - aVal : aVal - bVal;
            });
          }

          if (options?.offset !== undefined || options?.limit !== undefined) {
            const offset = options?.offset ?? 0;
            const limit = options?.limit ?? result.length;
            result = result.slice(offset, offset + limit);
          }

          return result;
        },
      };

      // Test filtering by status
      const activeSessions = await storage.list(undefined, { status: 'active' });
      expect(activeSessions).toHaveLength(1);
      expect(activeSessions[0].sessionId).toBe('sess-1');

      // Test pagination
      const paginated = await storage.list({ limit: 1 });
      expect(paginated).toHaveLength(1);
    });
  });

  describe('IStorageBundle', () => {
    it('should aggregate all storage interfaces', () => {
      const mockContextStorage: IContextStorage = {
        prepare: async () => {},
        loadAll: async () => new Map(),
        save: async () => {},
        delete: async () => {},
      };

      const mockHistoryStorage: IHistoryStorage = {
        prepare: async () => {},
        loadAll: async () => new Map(),
        save: async () => {},
        append: async () => {},
        delete: async () => {},
      };

      const mockCompactionStorage: ICompactionStorage = {
        prepare: async () => {},
        loadAll: async () => new Map(),
        save: async () => {},
        append: async () => {},
        delete: async () => {},
      };

      const mockSessionStorage: ISessionStorage = {
        prepare: async () => {},
        loadAll: async () => new Map(),
        save: async () => {},
        delete: async () => {},
        list: async () => [],
      };

      const bundle: IStorageBundle = {
        contexts: mockContextStorage,
        histories: mockHistoryStorage,
        compactions: mockCompactionStorage,
        sessions: mockSessionStorage,
        close: async () => {},
      };

      expect(bundle.contexts).toBe(mockContextStorage);
      expect(bundle.histories).toBe(mockHistoryStorage);
      expect(bundle.compactions).toBe(mockCompactionStorage);
      expect(bundle.sessions).toBe(mockSessionStorage);
      expect(typeof bundle.close).toBe('function');
    });

    it('should support close operation', async () => {
      let closed = false;
      const bundle: IStorageBundle = {
        contexts: {
          prepare: async () => {},
          loadAll: async () => new Map(),
          save: async () => {},
          delete: async () => {},
        },
        histories: {
          prepare: async () => {},
          loadAll: async () => new Map(),
          save: async () => {},
          append: async () => {},
          delete: async () => {},
        },
        compactions: {
          prepare: async () => {},
          loadAll: async () => new Map(),
          save: async () => {},
          append: async () => {},
          delete: async () => {},
        },
        sessions: {
          prepare: async () => {},
          loadAll: async () => new Map(),
          save: async () => {},
          delete: async () => {},
          list: async () => [],
        },
        close: async () => {
          closed = true;
        },
      };

      await bundle.close();
      expect(closed).toBe(true);
    });
  });
});

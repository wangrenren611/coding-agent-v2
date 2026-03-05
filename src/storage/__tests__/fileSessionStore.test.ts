/**
 * 文件会话存储测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FileSessionStore } from '../fileSessionStore';
import { AtomicJsonStore } from '../atomic-json';
import type { SessionData } from '../types';

describe('FileSessionStore', () => {
  let tempDir: string;
  let store: FileSessionStore;
  let io: AtomicJsonStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'session-store-test-'));
    io = new AtomicJsonStore();
    store = new FileSessionStore(tempDir, io);
  });

  afterEach(async () => {
    await io.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const createTestSession = (
    id: number,
    status: SessionData['status'] = 'active'
  ): SessionData => ({
    sessionId: `session-${id}`,
    title: `Session ${id}`,
    systemPrompt: `System prompt ${id}`,
    currentContextId: `ctx-${id}`,
    totalMessages: id * 10,
    compactionCount: Math.floor(id / 2),
    totalUsage: {
      prompt_tokens: id * 100,
      completion_tokens: id * 50,
      total_tokens: id * 150,
    },
    status,
    createdAt: 1000 + id * 1000,
    updatedAt: 2000 + id * 1000,
  });

  describe('prepare', () => {
    it('should create sessions directory', async () => {
      await store.prepare();
      const stat = await fs.stat(path.join(tempDir, 'sessions'));
      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe('save and load', () => {
    beforeEach(async () => {
      await store.prepare();
    });

    it('should save and load session', async () => {
      const session = createTestSession(1);

      await store.save(session.sessionId, session);
      const loaded = await store.loadAll();

      expect(loaded.has(session.sessionId)).toBe(true);
      expect(loaded.get(session.sessionId)).toEqual(session);
    });

    it('should handle multiple sessions', async () => {
      const sessions: SessionData[] = [];

      for (let i = 0; i < 5; i++) {
        const session = createTestSession(i);
        sessions.push(session);
        await store.save(session.sessionId, session);
      }

      const loaded = await store.loadAll();
      expect(loaded.size).toBe(5);

      for (const session of sessions) {
        expect(loaded.get(session.sessionId)).toEqual(session);
      }
    });

    it('should handle empty directory', async () => {
      const loaded = await store.loadAll();
      expect(loaded.size).toBe(0);
    });
  });

  describe('delete', () => {
    beforeEach(async () => {
      await store.prepare();
    });

    it('should delete session', async () => {
      const session = createTestSession(1);
      await store.save(session.sessionId, session);

      await store.delete(session.sessionId);

      const loaded = await store.loadAll();
      expect(loaded.has(session.sessionId)).toBe(false);
    });

    it('should not fail when deleting non-existent session', async () => {
      await expect(store.delete('non-existent')).resolves.not.toThrow();
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await store.prepare();

      // Create test sessions with different statuses and timestamps
      await store.save('session-1', createTestSession(1, 'active'));
      await store.save('session-2', createTestSession(2, 'active'));
      await store.save('session-3', createTestSession(3, 'completed'));
      await store.save('session-4', createTestSession(4, 'completed'));
      await store.save('session-5', createTestSession(5, 'aborted'));
    });

    it('should list all sessions without filter', async () => {
      const sessions = await store.list();
      expect(sessions).toHaveLength(5);
    });

    describe('filtering', () => {
      it('should filter by sessionId', async () => {
        const sessions = await store.list(undefined, { sessionId: 'session-1' });
        expect(sessions).toHaveLength(1);
        expect(sessions[0].sessionId).toBe('session-1');
      });

      it('should filter by status', async () => {
        const activeSessions = await store.list(undefined, { status: 'active' });
        expect(activeSessions).toHaveLength(2);

        const completedSessions = await store.list(undefined, { status: 'completed' });
        expect(completedSessions).toHaveLength(2);

        const abortedSessions = await store.list(undefined, { status: 'aborted' });
        expect(abortedSessions).toHaveLength(1);
      });

      it('should filter by startTime', async () => {
        // Sessions 1-5 have createdAt: 2000, 3000, 4000, 5000, 6000
        const sessions = await store.list(undefined, { startTime: 3000 });
        expect(sessions).toHaveLength(4); // sessions 2, 3, 4, 5 (>= 3000)
      });

      it('should filter by endTime', async () => {
        const sessions = await store.list(undefined, { endTime: 3000 });
        expect(sessions).toHaveLength(2); // sessions 1, 2 (<= 3000)
      });

      it('should filter by time range', async () => {
        const sessions = await store.list(undefined, {
          startTime: 2000,
          endTime: 4000,
        });
        expect(sessions).toHaveLength(3); // sessions 1, 2, 3 (2000-4000)
      });

      it('should combine filters', async () => {
        const sessions = await store.list(undefined, {
          status: 'completed',
          startTime: 2500,
        });
        expect(sessions).toHaveLength(2); // sessions 3, 4 (completed and >= 2500)
      });
    });

    describe('sorting', () => {
      it('should sort by createdAt ascending', async () => {
        const sessions = await store.list({
          orderBy: 'createdAt',
          orderDirection: 'asc',
        });

        for (let i = 0; i < sessions.length - 1; i++) {
          expect(sessions[i].createdAt).toBeLessThanOrEqual(sessions[i + 1].createdAt);
        }
      });

      it('should sort by createdAt descending', async () => {
        const sessions = await store.list({
          orderBy: 'createdAt',
          orderDirection: 'desc',
        });

        for (let i = 0; i < sessions.length - 1; i++) {
          expect(sessions[i].createdAt).toBeGreaterThanOrEqual(sessions[i + 1].createdAt);
        }
      });

      it('should sort by updatedAt ascending', async () => {
        const sessions = await store.list({
          orderBy: 'updatedAt',
          orderDirection: 'asc',
        });

        for (let i = 0; i < sessions.length - 1; i++) {
          expect(sessions[i].updatedAt).toBeLessThanOrEqual(sessions[i + 1].updatedAt);
        }
      });

      it('should sort by updatedAt descending (default)', async () => {
        const sessions = await store.list();

        for (let i = 0; i < sessions.length - 1; i++) {
          expect(sessions[i].updatedAt).toBeGreaterThanOrEqual(sessions[i + 1].updatedAt);
        }
      });
    });

    describe('pagination', () => {
      it('should apply offset', async () => {
        const sessions = await store.list({ offset: 2 });
        expect(sessions).toHaveLength(3);
      });

      it('should apply limit', async () => {
        const sessions = await store.list({ limit: 3 });
        expect(sessions).toHaveLength(3);
      });

      it('should apply offset and limit', async () => {
        const sessions = await store.list({ offset: 1, limit: 2 });
        expect(sessions).toHaveLength(2);
      });

      it('should handle offset beyond data', async () => {
        const sessions = await store.list({ offset: 100 });
        expect(sessions).toHaveLength(0);
      });

      it('should handle limit larger than data', async () => {
        const sessions = await store.list({ limit: 100 });
        expect(sessions).toHaveLength(5);
      });
    });

    describe('combined operations', () => {
      it('should filter, sort, and paginate', async () => {
        const sessions = await store.list(
          {
            orderBy: 'createdAt',
            orderDirection: 'desc',
            offset: 1,
            limit: 2,
          },
          { status: 'active' }
        );

        expect(sessions).toHaveLength(1); // Only 2 active, offset 1 = 1 result
      });
    });
  });

  describe('data integrity', () => {
    beforeEach(async () => {
      await store.prepare();
    });

    it('should preserve all session fields', async () => {
      const session: SessionData = {
        sessionId: 'full-session',
        title: 'Full Session Test',
        systemPrompt: 'You are a comprehensive test assistant.',
        currentContextId: 'ctx-full',
        totalMessages: 100,
        compactionCount: 5,
        totalUsage: {
          prompt_tokens: 10000,
          completion_tokens: 5000,
          total_tokens: 15000,
        },
        status: 'completed',
        createdAt: 1234567890,
        updatedAt: 1234567900,
      };

      await store.save(session.sessionId, session);
      const loaded = await store.loadAll();

      expect(loaded.get(session.sessionId)).toEqual(session);
    });

    it('should handle all status types', async () => {
      const statuses: SessionData['status'][] = ['active', 'completed', 'aborted', 'error'];

      for (const status of statuses) {
        const session = createTestSession(statuses.indexOf(status), status);
        await store.save(session.sessionId, session);
      }

      const loaded = await store.loadAll();
      expect(loaded.size).toBe(4);

      for (const status of statuses) {
        const session = Array.from(loaded.values()).find((s) => s.status === status);
        expect(session).toBeDefined();
      }
    });

    it('should handle sessions with optional title', async () => {
      const sessionWith = createTestSession(1);
      sessionWith.title = 'Has Title';

      const sessionWithout = createTestSession(2);
      delete sessionWithout.title;

      await store.save(sessionWith.sessionId, sessionWith);
      await store.save(sessionWithout.sessionId, sessionWithout);

      const loaded = await store.loadAll();
      expect(loaded.get(sessionWith.sessionId)?.title).toBe('Has Title');
      expect(loaded.get(sessionWithout.sessionId)?.title).toBeUndefined();
    });

    it('should handle concurrent saves', async () => {
      const sessionId = 'concurrent-save';

      const saves = Array.from({ length: 10 }, (_, i) => {
        const session = createTestSession(i);
        session.sessionId = sessionId;
        return store.save(sessionId, session);
      });

      await Promise.all(saves);

      const loaded = await store.loadAll();
      expect(loaded.has(sessionId)).toBe(true);
    });
  });
});

/**
 * SQLite 存储包集成测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { MemoryManager } from '../memoryManager';
import { createSqliteStorageBundle } from '../sqliteStoreBundle';
import type { SessionData } from '../types';

describe('createSqliteStorageBundle', () => {
  let tempDir: string;
  let dbPath: string;
  let manager: MemoryManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sqlite-storage-test-'));
    dbPath = path.join(tempDir, 'agent-storage.db');
    manager = new MemoryManager(createSqliteStorageBundle(dbPath));
    await manager.initialize();
  });

  afterEach(async () => {
    await manager.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should support session/context/history lifecycle', async () => {
    const sessionId = await manager.createSession('sqlite-session', 'You are helpful.');

    await manager.addMessages(sessionId, [
      { messageId: 'u1', role: 'user', content: 'Hello' },
      { messageId: 'a1', role: 'assistant', content: 'Hi there!' },
    ]);

    const session = manager.getSession(sessionId);
    const context = manager.getContext(sessionId);
    const history = manager.getHistory({ sessionId });

    expect(session).not.toBeNull();
    expect(session?.sessionId).toBe('sqlite-session');
    expect(context).not.toBeNull();
    expect(context?.messages.length).toBe(3);
    expect(history.length).toBe(3);
  });

  it('should persist data after reopening manager', async () => {
    const sessionId = await manager.createSession('persist-session', 'Persist me');
    await manager.addMessages(sessionId, [{ messageId: 'u1', role: 'user', content: 'first' }]);

    await manager.close();

    const reopened = new MemoryManager(createSqliteStorageBundle(dbPath));
    await reopened.initialize();

    try {
      const session = reopened.getSession(sessionId);
      const history = reopened.getHistory({ sessionId });

      expect(session).not.toBeNull();
      expect(session?.systemPrompt).toBe('Persist me');
      expect(history.length).toBe(2);
      expect(history[1].content).toBe('first');
    } finally {
      await reopened.close();
      manager = reopened;
    }
  });

  it('should rollback writes when withTransaction throws', async () => {
    const txDbPath = path.join(tempDir, 'tx-test.db');
    const bundle = createSqliteStorageBundle(txDbPath);

    try {
      await bundle.sessions.prepare();

      const now = Date.now();
      const session: SessionData = {
        sessionId: 'tx-session',
        systemPrompt: 'tx prompt',
        currentContextId: 'ctx-1',
        totalMessages: 1,
        compactionCount: 0,
        totalUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };

      await expect(
        bundle.withTransaction!(async () => {
          await bundle.sessions.save(session.sessionId, session);
          throw new Error('force rollback');
        })
      ).rejects.toThrow('force rollback');

      const sessions = await bundle.sessions.loadAll();
      expect(sessions.has(session.sessionId)).toBe(false);
    } finally {
      await bundle.close();
    }
  });

  it('should handle concurrent addMessages with unique sequences', async () => {
    const sessionId = await manager.createSession('sqlite-concurrent-session', 'System prompt');

    const additions = Array.from({ length: 20 }, (_, i) =>
      manager.addMessages(sessionId, [
        { messageId: `u-${i}`, role: 'user', content: `message-${i}` },
      ])
    );
    await Promise.all(additions);

    const history = manager.getHistory({ sessionId });
    expect(history).toHaveLength(21); // system + 20 user messages

    const sequences = history.map((m) => m.sequence);
    expect(new Set(sequences).size).toBe(history.length);

    const session = manager.getSession(sessionId);
    expect(session).not.toBeNull();
    expect(session?.totalMessages).toBe(history.length);
  });
});

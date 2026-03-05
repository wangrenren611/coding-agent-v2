/**
 * 内存管理器测试
 *
 * 测试 Context/History/Compaction/Session 的统一管理
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { MemoryManager } from '../memoryManager';
import { createFileStorageBundle } from '../fileStoreBundle';
import type { IStorageBundle } from '../index';
import type { Message } from '../types';

describe('MemoryManager', () => {
  let tempDir: string;
  let bundle: IStorageBundle;
  let manager: MemoryManager;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-manager-test-'));
    bundle = createFileStorageBundle(tempDir);
    manager = new MemoryManager(bundle);
  });

  afterEach(async () => {
    await manager.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // =============================================================================
  // 生命周期测试
  // =============================================================================

  describe('lifecycle', () => {
    it('should initialize successfully', async () => {
      await manager.initialize();
      // No error means success
    });

    it('should not initialize twice', async () => {
      await manager.initialize();
      await manager.initialize(); // Should not throw
    });

    it('should handle concurrent initialize calls', async () => {
      const promises = Array.from({ length: 10 }, () => manager.initialize());
      await Promise.all(promises);
      // Should only initialize once
    });

    it('should close successfully', async () => {
      await manager.initialize();
      await manager.close();
    });

    it('should handle close without initialize', async () => {
      await manager.close();
    });

    it('should handle close with pending initialize', async () => {
      const initPromise = manager.initialize();
      await manager.close();
      await initPromise.catch(() => {}); // Ignore potential error
    });
  });

  // =============================================================================
  // 会话管理测试
  // =============================================================================

  describe('session management', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    describe('createSession', () => {
      it('should create session with auto-generated ID', async () => {
        const sessionId = await manager.createSession(undefined, 'System prompt');
        expect(sessionId).toBeDefined();
        expect(typeof sessionId).toBe('string');
        expect(sessionId.length).toBeGreaterThan(0);
      });

      it('should create session with specific ID', async () => {
        const sessionId = await manager.createSession('my-session', 'System prompt');
        expect(sessionId).toBe('my-session');
      });

      it('should throw error if session already exists', async () => {
        await manager.createSession('existing-session', 'System prompt');
        await expect(manager.createSession('existing-session', 'System prompt')).rejects.toThrow(
          'Session already exists'
        );
      });

      it('should create session with system message', async () => {
        const sessionId = await manager.createSession(undefined, 'You are helpful.');

        const session = manager.getSession(sessionId);
        expect(session).toBeDefined();
        expect(session?.systemPrompt).toBe('You are helpful.');

        const context = manager.getContext(sessionId);
        expect(context?.messages).toHaveLength(1);
        expect(context?.messages[0].role).toBe('system');
        expect(context?.messages[0].content).toBe('You are helpful.');
      });

      it('should throw if not initialized', async () => {
        const uninitializedManager = new MemoryManager(bundle);
        await expect(
          uninitializedManager.createSession(undefined, 'System prompt')
        ).rejects.toThrow('not initialized');
      });
    });

    describe('getSession', () => {
      it('should return session data', async () => {
        const sessionId = await manager.createSession('test-session', 'System prompt');
        const session = manager.getSession(sessionId);

        expect(session).toBeDefined();
        expect(session?.sessionId).toBe('test-session');
        expect(session?.systemPrompt).toBe('System prompt');
        expect(session?.status).toBe('active');
      });

      it('should return null for non-existent session', () => {
        const session = manager.getSession('non-existent');
        expect(session).toBeNull();
      });

      it('should return a copy of session data', async () => {
        const sessionId = await manager.createSession('test-session', 'System prompt');
        const session1 = manager.getSession(sessionId);
        const session2 = manager.getSession(sessionId);

        expect(session1).not.toBe(session2); // Different references
        expect(session1).toEqual(session2); // Same content
      });
    });

    describe('querySessions', () => {
      beforeEach(async () => {
        await manager.createSession('session-1', 'Prompt 1');
        await manager.createSession('session-2', 'Prompt 2');
        await manager.createSession('session-3', 'Prompt 3');
      });

      it('should return all sessions', () => {
        const sessions = manager.querySessions();
        expect(sessions).toHaveLength(3);
      });

      it('should filter by sessionId', () => {
        const sessions = manager.querySessions({ sessionId: 'session-1' });
        expect(sessions).toHaveLength(1);
        expect(sessions[0].sessionId).toBe('session-1');
      });

      it('should filter by status', () => {
        const sessions = manager.querySessions({ status: 'active' });
        expect(sessions).toHaveLength(3);
      });

      it('should sort by createdAt ascending', () => {
        const sessions = manager.querySessions(undefined, {
          orderBy: 'createdAt',
          orderDirection: 'asc',
        });
        expect(sessions[0].sessionId).toBe('session-1');
      });

      it('should sort by updatedAt descending (default)', () => {
        const sessions = manager.querySessions();
        // Last created should be first (most recent updatedAt)
        expect(sessions[0].sessionId).toBe('session-3');
      });

      it('should paginate results', () => {
        const page1 = manager.querySessions(undefined, { limit: 2 });
        const page2 = manager.querySessions(undefined, { offset: 2, limit: 2 });

        expect(page1).toHaveLength(2);
        expect(page2).toHaveLength(1);
      });

      it('should return copies', () => {
        const sessions1 = manager.querySessions();
        const sessions2 = manager.querySessions();

        expect(sessions1).not.toBe(sessions2);
        expect(sessions1[0]).not.toBe(sessions2[0]);
      });
    });
  });

  // =============================================================================
  // 上下文管理测试
  // =============================================================================

  describe('context management', () => {
    let sessionId: string;

    beforeEach(async () => {
      await manager.initialize();
      sessionId = await manager.createSession('test-session', 'System prompt');
    });

    describe('getContext', () => {
      it('should return context data', () => {
        const context = manager.getContext(sessionId);
        expect(context).toBeDefined();
        expect(context?.sessionId).toBe(sessionId);
        expect(context?.messages).toHaveLength(1); // System message
      });

      it('should return null for non-existent session', () => {
        const context = manager.getContext('non-existent');
        expect(context).toBeNull();
      });

      it('should return a copy', () => {
        const context1 = manager.getContext(sessionId);
        const context2 = manager.getContext(sessionId);

        expect(context1).not.toBe(context2);
        expect(context1).toEqual(context2);
      });
    });

    describe('getContextMessages', () => {
      it('should return messages for LLM', async () => {
        const messages: Message[] = [
          { messageId: 'msg-1', role: 'user', content: 'Hello' },
          { messageId: 'msg-2', role: 'assistant', content: 'Hi!' },
        ];

        await manager.addMessages(sessionId, messages);

        const contextMessages = manager.getContextMessages(sessionId);
        expect(contextMessages).toHaveLength(3); // system + 2 messages
        expect(contextMessages[0].role).toBe('system');
        expect(contextMessages[1].role).toBe('user');
        expect(contextMessages[2].role).toBe('assistant');
      });

      it('should exclude messages marked as excluded', async () => {
        const messages: Message[] = [
          { messageId: 'msg-1', role: 'user', content: 'Hello' },
          { messageId: 'msg-2', role: 'assistant', content: 'Hi!' },
        ];

        await manager.addMessages(sessionId, messages);
        await manager.removeMessageFromContext(sessionId, 'msg-1');

        const contextMessages = manager.getContextMessages(sessionId);
        expect(contextMessages).toHaveLength(2); // system + 1 message
        expect(contextMessages.find((m) => m.messageId === 'msg-1')).toBeUndefined();
      });

      it('should return empty array for non-existent session', () => {
        const messages = manager.getContextMessages('non-existent');
        expect(messages).toEqual([]);
      });
    });

    describe('addMessages', () => {
      it('should add messages to context and history', async () => {
        const messages: Message[] = [
          { messageId: 'msg-1', role: 'user', content: 'Hello' },
          { messageId: 'msg-2', role: 'assistant', content: 'Hi!' },
        ];

        await manager.addMessages(sessionId, messages);

        const context = manager.getContext(sessionId);
        expect(context?.messages).toHaveLength(3); // system + 2 messages

        const history = manager.getHistory({ sessionId });
        expect(history).toHaveLength(3);
      });

      it('should not add to history if addToHistory is false', async () => {
        const messages: Message[] = [{ messageId: 'msg-1', role: 'user', content: 'Hello' }];

        await manager.addMessages(sessionId, messages, { addToHistory: false });

        const context = manager.getContext(sessionId);
        expect(context?.messages).toHaveLength(2); // system + 1 message

        const history = manager.getHistory({ sessionId });
        expect(history).toHaveLength(1); // Only system message
      });

      it('should update session stats', async () => {
        const messages: Message[] = [{ messageId: 'msg-1', role: 'user', content: 'Hello' }];

        await manager.addMessages(sessionId, messages);

        const session = manager.getSession(sessionId);
        expect(session?.totalMessages).toBe(2); // system + 1
      });

      it('should handle empty messages array', async () => {
        await manager.addMessages(sessionId, []);
        const context = manager.getContext(sessionId);
        expect(context?.messages).toHaveLength(1); // Only system
      });

      it('should assign sequence numbers', async () => {
        const messages: Message[] = [
          { messageId: 'msg-1', role: 'user', content: 'Hello' },
          { messageId: 'msg-2', role: 'assistant', content: 'Hi!' },
        ];

        await manager.addMessages(sessionId, messages);

        const history = manager.getHistory({ sessionId });
        expect(history[1].sequence).toBe(2); // After system
        expect(history[2].sequence).toBe(3);
      });
    });

    describe('updateMessageInContext', () => {
      beforeEach(async () => {
        await manager.addMessages(sessionId, [
          { messageId: 'msg-1', role: 'user', content: 'Original' },
        ]);
      });

      it('should update message in context', async () => {
        await manager.updateMessageInContext(sessionId, 'msg-1', {
          content: 'Updated',
        });

        const context = manager.getContext(sessionId);
        const msg = context?.messages.find((m) => m.messageId === 'msg-1');
        expect(msg?.content).toBe('Updated');
      });

      it('should update message in history', async () => {
        await manager.updateMessageInContext(sessionId, 'msg-1', {
          content: 'Updated',
        });

        const history = manager.getHistory({ sessionId });
        const msg = history.find((m) => m.messageId === 'msg-1');
        expect(msg?.content).toBe('Updated');
      });

      it('should not allow changing messageId', async () => {
        await manager.updateMessageInContext(sessionId, 'msg-1', {
          messageId: 'new-id',
        });

        const context = manager.getContext(sessionId);
        expect(context?.messages.find((m) => m.messageId === 'new-id')).toBeUndefined();
        expect(context?.messages.find((m) => m.messageId === 'msg-1')).toBeDefined();
      });

      it('should throw if message not found', async () => {
        await expect(
          manager.updateMessageInContext(sessionId, 'non-existent', { content: 'Updated' })
        ).rejects.toThrow('Message not found');
      });
    });

    describe('removeMessageFromContext', () => {
      beforeEach(async () => {
        await manager.addMessages(sessionId, [
          { messageId: 'msg-1', role: 'user', content: 'Hello' },
          { messageId: 'msg-2', role: 'assistant', content: 'Hi!' },
        ]);
      });

      it('should remove message from context', async () => {
        const result = await manager.removeMessageFromContext(sessionId, 'msg-1');

        expect(result).toBe(true);
        const context = manager.getContext(sessionId);
        expect(context?.messages.find((m) => m.messageId === 'msg-1')).toBeUndefined();
      });

      it('should keep message in history with exclusion flag', async () => {
        await manager.removeMessageFromContext(sessionId, 'msg-1');

        const history = manager.getHistory({ sessionId });
        const msg = history.find((m) => m.messageId === 'msg-1');
        expect(msg).toBeDefined();
        expect(msg?.excludedFromContext).toBe(true);
        expect(msg?.excludedReason).toBe('manual');
      });

      it('should return false if message not found', async () => {
        const result = await manager.removeMessageFromContext(sessionId, 'non-existent');
        expect(result).toBe(false);
      });

      it('should return false for system message', async () => {
        const systemMsg = manager.getContext(sessionId)?.messages[0];
        const result = await manager.removeMessageFromContext(sessionId, systemMsg!.messageId);
        expect(result).toBe(false);
      });

      it('should support different exclusion reasons', async () => {
        await manager.removeMessageFromContext(sessionId, 'msg-1', 'compression');

        const history = manager.getHistory({ sessionId });
        const msg = history.find((m) => m.messageId === 'msg-1');
        expect(msg?.excludedReason).toBe('compression');
      });
    });

    describe('clearContext', () => {
      beforeEach(async () => {
        await manager.addMessages(sessionId, [
          { messageId: 'msg-1', role: 'user', content: 'Hello' },
          { messageId: 'msg-2', role: 'assistant', content: 'Hi!' },
        ]);
      });

      it('should clear context except system message', async () => {
        await manager.clearContext(sessionId);

        const context = manager.getContext(sessionId);
        expect(context?.messages).toHaveLength(1);
        expect(context?.messages[0].role).toBe('system');
      });

      it('should increment version', async () => {
        const versionBefore = manager.getContext(sessionId)?.version;
        await manager.clearContext(sessionId);
        const versionAfter = manager.getContext(sessionId)?.version;

        expect(versionAfter).toBe(versionBefore! + 1);
      });
    });
  });

  // =============================================================================
  // 压缩管理测试
  // =============================================================================

  describe('compaction', () => {
    let sessionId: string;

    beforeEach(async () => {
      await manager.initialize();
      sessionId = await manager.createSession('test-session', 'System prompt');

      // Add some messages
      for (let i = 1; i <= 10; i++) {
        await manager.addMessages(sessionId, [
          {
            messageId: `msg-${i}`,
            role: i % 2 === 1 ? 'user' : 'assistant',
            content: `Message ${i}`,
          },
        ]);
      }
    });

    describe('applyCompaction', () => {
      it('should apply compaction result', async () => {
        const record = await manager.applyCompaction(sessionId, {
          keepLastN: 3,
          summaryMessage: { messageId: 'summary-1', role: 'assistant', content: 'Summary' },
          removedMessageIds: ['msg-1', 'msg-2', 'msg-3', 'msg-4', 'msg-5'],
          reason: 'token_limit',
        });

        expect(record).toBeDefined();
        expect(record.recordId).toBeDefined();
        expect(record.sessionId).toBe(sessionId);
      });

      it('should mark archived messages in history', async () => {
        await manager.applyCompaction(sessionId, {
          keepLastN: 3,
          summaryMessage: { messageId: 'summary-1', role: 'assistant', content: 'Summary' },
          removedMessageIds: ['msg-1', 'msg-2', 'msg-3'],
        });

        const history = manager.getHistory({ sessionId });
        const archived = history.filter((m) => m.archivedBy);
        expect(archived).toHaveLength(3);
      });

      it('should update context with summary', async () => {
        await manager.applyCompaction(sessionId, {
          keepLastN: 3,
          summaryMessage: { messageId: 'summary-1', role: 'assistant', content: 'Summary' },
          removedMessageIds: ['msg-1', 'msg-2', 'msg-3', 'msg-4', 'msg-5'],
        });

        const context = manager.getContext(sessionId);
        const summary = context?.messages.find((m) => m.messageId === 'summary-1');
        expect(summary).toBeDefined();
        expect(summary?.isSummary).toBe(true);
      });

      it('should remove archived messages from context', async () => {
        await manager.applyCompaction(sessionId, {
          keepLastN: 3,
          summaryMessage: { messageId: 'summary-1', role: 'assistant', content: 'Summary' },
          removedMessageIds: ['msg-1', 'msg-2', 'msg-3', 'msg-4', 'msg-5'],
        });

        const context = manager.getContext(sessionId);
        const archivedInContext = context?.messages.filter((m) =>
          ['msg-1', 'msg-2', 'msg-3', 'msg-4', 'msg-5'].includes(m.messageId)
        );
        expect(archivedInContext).toHaveLength(0);
      });

      it('should update session stats', async () => {
        await manager.applyCompaction(sessionId, {
          keepLastN: 3,
          summaryMessage: { messageId: 'summary-1', role: 'assistant', content: 'Summary' },
          removedMessageIds: ['msg-1', 'msg-2', 'msg-3'],
        });

        const session = manager.getSession(sessionId);
        expect(session?.compactionCount).toBe(1);
      });

      it('should create compaction record', async () => {
        const record = await manager.applyCompaction(sessionId, {
          keepLastN: 3,
          summaryMessage: { messageId: 'summary-1', role: 'assistant', content: 'Summary' },
          removedMessageIds: ['msg-1', 'msg-2', 'msg-3'],
          tokenCountBefore: 1000,
          tokenCountAfter: 500,
        });

        expect(record.archivedMessageIds).toEqual(['msg-1', 'msg-2', 'msg-3']);
        expect(record.metadata?.tokenCountBefore).toBe(1000);
        expect(record.metadata?.tokenCountAfter).toBe(500);
      });
    });

    describe('getCompactionRecords', () => {
      it('should return empty array for no compactions', () => {
        const records = manager.getCompactionRecords(sessionId);
        expect(records).toEqual([]);
      });

      it('should return compaction records', async () => {
        await manager.applyCompaction(sessionId, {
          keepLastN: 3,
          summaryMessage: { messageId: 'summary-1', role: 'assistant', content: 'Summary 1' },
          removedMessageIds: ['msg-1', 'msg-2'],
        });

        const records = manager.getCompactionRecords(sessionId);
        expect(records).toHaveLength(1);
      });

      it('should return copies', async () => {
        await manager.applyCompaction(sessionId, {
          keepLastN: 3,
          summaryMessage: { messageId: 'summary-1', role: 'assistant', content: 'Summary' },
          removedMessageIds: ['msg-1'],
        });

        const records1 = manager.getCompactionRecords(sessionId);
        const records2 = manager.getCompactionRecords(sessionId);

        expect(records1).not.toBe(records2);
        expect(records1[0]).not.toBe(records2[0]);
      });
    });
  });

  // =============================================================================
  // 历史管理测试
  // =============================================================================

  describe('history management', () => {
    let sessionId: string;

    beforeEach(async () => {
      await manager.initialize();
      sessionId = await manager.createSession('test-session', 'System prompt');
    });

    describe('getHistory', () => {
      beforeEach(async () => {
        for (let i = 1; i <= 10; i++) {
          await manager.addMessages(sessionId, [
            {
              messageId: `msg-${i}`,
              role: i % 2 === 1 ? 'user' : 'assistant',
              content: `Message ${i}`,
            },
          ]);
        }
      });

      it('should return all history', () => {
        const history = manager.getHistory({ sessionId });
        expect(history).toHaveLength(11); // system + 10 messages
      });

      it('should filter by messageIds', () => {
        const history = manager.getHistory({ sessionId, messageIds: ['msg-1', 'msg-5'] });
        expect(history).toHaveLength(2);
      });

      it('should filter by sequence range', () => {
        const history = manager.getHistory({ sessionId, sequenceStart: 3, sequenceEnd: 5 });
        expect(history).toHaveLength(3);
      });

      it('should exclude summaries', async () => {
        await manager.applyCompaction(sessionId, {
          keepLastN: 3,
          summaryMessage: { messageId: 'summary-1', role: 'assistant', content: 'Summary' },
          removedMessageIds: ['msg-1', 'msg-2'],
        });

        const history = manager.getHistory({ sessionId, includeSummary: false });
        const summaries = history.filter((m) => m.isSummary);
        expect(summaries).toHaveLength(0);
      });

      it('should sort by sequence', () => {
        const history = manager.getHistory({ sessionId });
        for (let i = 0; i < history.length - 1; i++) {
          expect(history[i].sequence).toBeLessThan(history[i + 1].sequence);
        }
      });

      it('should support pagination', () => {
        const page1 = manager.getHistory({ sessionId }, { limit: 5 });
        const page2 = manager.getHistory({ sessionId }, { offset: 5, limit: 10 });

        expect(page1).toHaveLength(5);
        expect(page2).toHaveLength(6); // 11 - 5
      });

      it('should return copies', () => {
        const history1 = manager.getHistory({ sessionId });
        const history2 = manager.getHistory({ sessionId });

        expect(history1).not.toBe(history2);
        expect(history1[0]).not.toBe(history2[0]);
      });
    });
  });

  // =============================================================================
  // 持久化测试
  // =============================================================================

  describe('persistence', () => {
    it('should persist and restore data', async () => {
      await manager.initialize();

      // Create session and add data
      const sessionId = await manager.createSession('persist-test', 'System prompt');
      await manager.addMessages(sessionId, [
        { messageId: 'msg-1', role: 'user', content: 'Hello' },
        { messageId: 'msg-2', role: 'assistant', content: 'Hi!' },
      ]);

      await manager.close();

      // Create new manager with same storage
      const newBundle = createFileStorageBundle(tempDir);
      const newManager = new MemoryManager(newBundle);
      await newManager.initialize();

      // Verify data is restored
      const session = newManager.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session?.totalMessages).toBe(3);

      const context = newManager.getContext(sessionId);
      expect(context?.messages).toHaveLength(3);

      await newManager.close();
    });

    it('should persist compaction records', async () => {
      await manager.initialize();

      const sessionId = await manager.createSession('compaction-persist', 'System prompt');
      await manager.addMessages(sessionId, [
        { messageId: 'msg-1', role: 'user', content: 'Hello' },
      ]);

      await manager.applyCompaction(sessionId, {
        keepLastN: 1,
        summaryMessage: { messageId: 'summary-1', role: 'assistant', content: 'Summary' },
        removedMessageIds: ['msg-1'],
      });

      await manager.close();

      // Restore
      const newBundle = createFileStorageBundle(tempDir);
      const newManager = new MemoryManager(newBundle);
      await newManager.initialize();

      const records = newManager.getCompactionRecords(sessionId);
      expect(records).toHaveLength(1);

      await newManager.close();
    });
  });

  // =============================================================================
  // 原子写入测试
  // =============================================================================

  describe('atomic writes', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should not pollute cache when addMessages persistence fails', async () => {
      const sessionId = await manager.createSession('atomic-add', 'System prompt');
      await manager.addMessages(sessionId, [
        { messageId: 'msg-1', role: 'user', content: 'hello' },
      ]);

      const beforeContext = manager.getContext(sessionId);
      const beforeHistory = manager.getHistory({ sessionId });
      const beforeSession = manager.getSession(sessionId);

      const originalSave = bundle.contexts.save.bind(bundle.contexts);
      bundle.contexts.save = async () => {
        throw new Error('simulated persist failure');
      };

      await expect(
        manager.addMessages(sessionId, [{ messageId: 'msg-2', role: 'assistant', content: 'fail' }])
      ).rejects.toThrow('simulated persist failure');

      bundle.contexts.save = originalSave;

      expect(manager.getContext(sessionId)).toEqual(beforeContext);
      expect(manager.getHistory({ sessionId })).toEqual(beforeHistory);
      expect(manager.getSession(sessionId)).toEqual(beforeSession);

      await manager.addMessages(sessionId, [
        { messageId: 'msg-3', role: 'assistant', content: 'recovered' },
      ]);
      expect(manager.getHistory({ sessionId })).toHaveLength(beforeHistory.length + 1);
    });

    it('should not create half-written session when persistence fails', async () => {
      const originalSave = bundle.sessions.save.bind(bundle.sessions);
      bundle.sessions.save = async () => {
        throw new Error('session save failed');
      };

      await expect(manager.createSession('atomic-create', 'System prompt')).rejects.toThrow(
        'session save failed'
      );

      bundle.sessions.save = originalSave;
      expect(manager.getSession('atomic-create')).toBeNull();
      expect(manager.getContext('atomic-create')).toBeNull();
      expect(manager.getHistory({ sessionId: 'atomic-create' })).toHaveLength(0);
    });
  });

  // =============================================================================
  // 并发测试
  // =============================================================================

  describe('concurrency', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    it('should handle concurrent message additions', async () => {
      const sessionId = await manager.createSession('concurrent-test', 'System prompt');

      const additions = Array.from({ length: 10 }, (_, i) =>
        manager.addMessages(sessionId, [
          { messageId: `msg-${i}`, role: 'user', content: `Message ${i}` },
        ])
      );

      await Promise.all(additions);

      const history = manager.getHistory({ sessionId });
      // All messages should be added
      expect(history.length).toBe(11); // system + 10
    });

    it('should handle concurrent context updates', async () => {
      const sessionId = await manager.createSession('concurrent-update', 'System prompt');

      await manager.addMessages(sessionId, [
        { messageId: 'msg-1', role: 'user', content: 'Hello' },
      ]);

      // Concurrent updates to same message
      const updates = Array.from({ length: 5 }, (_, i) =>
        manager.updateMessageInContext(sessionId, 'msg-1', { content: `Updated ${i}` })
      );

      await Promise.all(updates);

      // Message should exist with one of the updates
      const context = manager.getContext(sessionId);
      const msg = context?.messages.find((m) => m.messageId === 'msg-1');
      expect(msg).toBeDefined();
    });
  });
});

/**
 * Storage 模块测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MemoryManager,
  createFileStorageBundle,
  encodeEntityFileName,
  safeDecodeEntityFileName,
} from './index.js';
import type { HistoryMessage, ContextData, CompactionRecord } from './index.js';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// =============================================================================
// 工具函数测试
// =============================================================================

describe('Utility Functions', () => {
  describe('encodeEntityFileName / safeDecodeEntityFileName', () => {
    it('should encode and decode simple strings', () => {
      const input = 'simple-test';
      const encoded = encodeEntityFileName(input);
      const decoded = safeDecodeEntityFileName(encoded);

      expect(decoded).toBe(input);
    });

    it('should handle special characters', () => {
      const input = 'test/with:special<chars>|"*?';
      const encoded = encodeEntityFileName(input);
      const decoded = safeDecodeEntityFileName(encoded);

      expect(decoded).toBe(input);
    });

    it('should handle unicode characters', () => {
      const input = '测试-会话-123';
      const encoded = encodeEntityFileName(input);
      const decoded = safeDecodeEntityFileName(encoded);

      expect(decoded).toBe(input);
    });

    it('should return null for invalid escape sequence', () => {
      const result = safeDecodeEntityFileName('test!invalid!.json');
      expect(result).toBeNull();
    });

    it('should add .json suffix when encoding', () => {
      const encoded = encodeEntityFileName('test');
      expect(encoded.endsWith('.json')).toBe(true);
    });

    it('should handle .json suffix when decoding', () => {
      const input = 'test-session';
      const encoded = encodeEntityFileName(input);
      expect(safeDecodeEntityFileName(encoded)).toBe(input);
      // Also works without .json
      expect(safeDecodeEntityFileName('test-session.json')).toBe('test-session');
    });
  });
});

// =============================================================================
// MemoryManager 测试
// =============================================================================

describe('MemoryManager', () => {
  let tempDir: string;
  let manager: MemoryManager;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `manager-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    const bundle = createFileStorageBundle(tempDir);
    manager = new MemoryManager(bundle);
    await manager.initialize();
  });

  afterEach(async () => {
    await manager.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  // ===========================================================================
  // 会话管理测试
  // ===========================================================================

  describe('Session Management', () => {
    it('should create a session', async () => {
      const sessionId = await manager.createSession(undefined, 'You are helpful.');

      expect(sessionId).toBeDefined();
      expect(typeof sessionId).toBe('string');

      const session = manager.getSession(sessionId);
      expect(session).not.toBeNull();
      expect(session?.systemPrompt).toBe('You are helpful.');
      expect(session?.status).toBe('active');
    });

    it('should throw when creating duplicate session', async () => {
      await manager.createSession('duplicate-id', 'System prompt');

      await expect(manager.createSession('duplicate-id', 'Another prompt')).rejects.toThrow();
    });

    it('should query sessions with filter', async () => {
      await manager.createSession('session-1', 'Prompt 1');
      await manager.createSession('session-2', 'Prompt 2');

      const allSessions = manager.querySessions();
      expect(allSessions).toHaveLength(2);

      const filteredSessions = manager.querySessions({ sessionId: 'session-1' });
      expect(filteredSessions).toHaveLength(1);
      expect(filteredSessions[0].sessionId).toBe('session-1');
    });

    it('should query sessions with pagination', async () => {
      await manager.createSession('session-1', 'Prompt 1');
      await manager.createSession('session-2', 'Prompt 2');
      await manager.createSession('session-3', 'Prompt 3');

      const page1 = manager.querySessions(undefined, { limit: 2, offset: 0 });
      expect(page1).toHaveLength(2);

      const page2 = manager.querySessions(undefined, { limit: 2, offset: 2 });
      expect(page2).toHaveLength(1);
    });
  });

  // ===========================================================================
  // 上下文管理测试
  // ===========================================================================

  describe('Context Management', () => {
    let sessionId: string;

    beforeEach(async () => {
      sessionId = await manager.createSession(undefined, 'You are helpful.');
    });

    it('should get context messages', () => {
      const messages = manager.getContextMessages(sessionId);
      expect(messages).toHaveLength(1); // System message
      expect(messages[0].role).toBe('system');
      expect(messages[0].content).toBe('You are helpful.');
    });

    it('should add messages to context', async () => {
      await manager.addMessages(sessionId, [
        { messageId: 'msg-1', role: 'user', content: 'Hello' },
        { messageId: 'msg-2', role: 'assistant', content: 'Hi there!' },
      ]);

      const messages = manager.getContextMessages(sessionId);
      expect(messages).toHaveLength(3); // system + user + assistant
      expect(messages[1].role).toBe('user');
      expect(messages[2].role).toBe('assistant');
    });

    it('should get context data', () => {
      const context = manager.getContext(sessionId);
      expect(context).not.toBeNull();
      expect(context?.sessionId).toBe(sessionId);
      expect(context?.messages).toHaveLength(1);
    });

    it('should update message in context', async () => {
      await manager.addMessages(sessionId, [
        { messageId: 'msg-1', role: 'user', content: 'Hello' },
      ]);

      await manager.updateMessageInContext(sessionId, 'msg-1', {
        content: 'Updated content',
      });

      const messages = manager.getContextMessages(sessionId);
      expect(messages[1].content).toBe('Updated content');
    });

    it('should remove message from context', async () => {
      await manager.addMessages(sessionId, [
        { messageId: 'msg-1', role: 'user', content: 'Hello' },
      ]);

      const removed = await manager.removeMessageFromContext(sessionId, 'msg-1');
      expect(removed).toBe(true);

      const messages = manager.getContextMessages(sessionId);
      expect(messages).toHaveLength(1); // Only system message
    });

    it('should not remove system message', async () => {
      const context = manager.getContext(sessionId);
      const systemMessageId = context?.messages[0].messageId;

      const removed = await manager.removeMessageFromContext(sessionId, systemMessageId!);
      expect(removed).toBe(false);
    });

    it('should clear context', async () => {
      await manager.addMessages(sessionId, [
        { messageId: 'msg-1', role: 'user', content: 'Hello' },
      ]);

      await manager.clearContext(sessionId);

      const messages = manager.getContextMessages(sessionId);
      expect(messages).toHaveLength(1); // Only system message
    });
  });

  // ===========================================================================
  // 历史管理测试
  // ===========================================================================

  describe('History Management', () => {
    let sessionId: string;

    beforeEach(async () => {
      sessionId = await manager.createSession(undefined, 'You are helpful.');
    });

    it('should get history', async () => {
      await manager.addMessages(sessionId, [
        { messageId: 'msg-1', role: 'user', content: 'Hello' },
      ]);

      const history = manager.getHistory({ sessionId });
      expect(history).toHaveLength(2); // system + user
    });

    it('should filter history by message IDs', async () => {
      await manager.addMessages(sessionId, [
        { messageId: 'msg-1', role: 'user', content: 'Hello' },
        { messageId: 'msg-2', role: 'assistant', content: 'Hi' },
      ]);

      const history = manager.getHistory({ sessionId, messageIds: ['msg-1'] });
      expect(history).toHaveLength(1);
      expect(history[0].messageId).toBe('msg-1');
    });

    it('should filter history by sequence range', async () => {
      await manager.addMessages(sessionId, [
        { messageId: 'msg-1', role: 'user', content: 'Hello' },
        { messageId: 'msg-2', role: 'assistant', content: 'Hi' },
      ]);

      const history = manager.getHistory({ sessionId, sequenceStart: 2 });
      expect(history).toHaveLength(2); // user + assistant
    });
  });

  // ===========================================================================
  // 压缩功能测试
  // ===========================================================================

  describe('Compaction', () => {
    let sessionId: string;

    beforeEach(async () => {
      sessionId = await manager.createSession(undefined, 'You are helpful.');
    });

    it('should apply compaction', async () => {
      // 添加一些消息
      await manager.addMessages(sessionId, [
        { messageId: 'msg-1', role: 'user', content: 'Hello' },
        { messageId: 'msg-2', role: 'assistant', content: 'Hi' },
        { messageId: 'msg-3', role: 'user', content: 'How are you?' },
        { messageId: 'msg-4', role: 'assistant', content: 'I am fine' },
      ]);

      const record = await manager.applyCompaction(sessionId, {
        keepLastN: 2,
        summaryMessage: {
          messageId: 'summary-1',
          role: 'assistant',
          content: '[Conversation Summary]\nSummary content',
        },
        removedMessageIds: ['msg-1', 'msg-2'],
        reason: 'token_limit',
        tokenCountBefore: 100,
        tokenCountAfter: 50,
      });

      expect(record.recordId).toBeDefined();
      expect(record.archivedMessageIds).toEqual(['msg-1', 'msg-2']);

      // 检查上下文
      const messages = manager.getContextMessages(sessionId);
      expect(messages.length).toBeLessThan(5); // 压缩后消息数减少

      // 检查压缩记录
      const records = manager.getCompactionRecords(sessionId);
      expect(records).toHaveLength(1);
    });

    it('should preserve history after compaction', async () => {
      await manager.addMessages(sessionId, [
        { messageId: 'msg-1', role: 'user', content: 'Hello' },
        { messageId: 'msg-2', role: 'assistant', content: 'Hi' },
      ]);

      await manager.applyCompaction(sessionId, {
        keepLastN: 1,
        summaryMessage: {
          messageId: 'summary-1',
          role: 'assistant',
          content: '[Conversation Summary]\nSummary',
        },
        removedMessageIds: ['msg-1'],
        reason: 'manual',
      });

      // 历史应该包含所有消息 + 摘要
      const history = manager.getHistory({ sessionId });
      expect(history.length).toBe(4); // system + msg-1 + msg-2 + summary

      // 检查被归档的消息标记
      const archivedMsg = history.find((h) => h.messageId === 'msg-1');
      expect(archivedMsg?.excludedFromContext).toBe(true);
      expect(archivedMsg?.excludedReason).toBe('compression');
    });
  });

  // ===========================================================================
  // 持久化测试
  // ===========================================================================

  describe('Persistence', () => {
    it('should persist and restore data', async () => {
      const sessionId = await manager.createSession(undefined, 'Test system prompt');

      await manager.addMessages(sessionId, [
        { messageId: 'msg-1', role: 'user', content: 'Hello' },
        { messageId: 'msg-2', role: 'assistant', content: 'Hi' },
      ]);

      // 关闭并重新创建 manager
      await manager.close();

      const bundle = createFileStorageBundle(tempDir);
      const newManager = new MemoryManager(bundle);
      await newManager.initialize();

      // 验证数据恢复
      const session = newManager.getSession(sessionId);
      expect(session).not.toBeNull();
      expect(session?.systemPrompt).toBe('Test system prompt');

      const messages = newManager.getContextMessages(sessionId);
      expect(messages).toHaveLength(3); // system + user + assistant

      await newManager.close();
    });
  });
});

// =============================================================================
// File Store 测试
// =============================================================================

describe('File Stores', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `filestore-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should create storage bundle', () => {
    const bundle = createFileStorageBundle(tempDir);

    expect(bundle.contexts).toBeDefined();
    expect(bundle.histories).toBeDefined();
    expect(bundle.compactions).toBeDefined();
    expect(bundle.sessions).toBeDefined();
    expect(bundle.close).toBeDefined();
  });

  it('should prepare and load stores', async () => {
    const bundle = createFileStorageBundle(tempDir);

    await bundle.contexts.prepare();
    await bundle.histories.prepare();
    await bundle.compactions.prepare();
    await bundle.sessions.prepare();

    const allContexts = await bundle.contexts.loadAll();
    expect(allContexts).toBeInstanceOf(Map);
    expect(allContexts.size).toBe(0);

    await bundle.close();
  });

  it('should save and load context', async () => {
    const bundle = createFileStorageBundle(tempDir);
    await bundle.contexts.prepare();

    const context: ContextData = {
      contextId: 'ctx-1',
      sessionId: 'session-1',
      systemPrompt: 'Test prompt',
      messages: [
        {
          messageId: 'msg-1',
          role: 'system',
          content: 'Test prompt',
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
    };

    await bundle.contexts.save('session-1', context);

    const allContexts = await bundle.contexts.loadAll();
    expect(allContexts.size).toBe(1);
    expect(allContexts.get('session-1')?.contextId).toBe('ctx-1');

    await bundle.close();
  });

  it('should save and load history', async () => {
    const bundle = createFileStorageBundle(tempDir);
    await bundle.histories.prepare();

    const history: HistoryMessage[] = [
      {
        messageId: 'msg-1',
        role: 'user',
        content: 'Hello',
        sequence: 1,
        createdAt: Date.now(),
      },
    ];

    await bundle.histories.save('session-1', history);

    const allHistories = await bundle.histories.loadAll();
    expect(allHistories.size).toBe(1);
    expect(allHistories.get('session-1')).toHaveLength(1);
    expect(allHistories.get('session-1')![0].content).toBe('Hello');

    await bundle.close();
  });

  it('should append compaction records', async () => {
    const bundle = createFileStorageBundle(tempDir);
    await bundle.compactions.prepare();

    const record: CompactionRecord = {
      recordId: 'rec-1',
      sessionId: 'session-1',
      compactedAt: Date.now(),
      messageCountBefore: 10,
      messageCountAfter: 5,
      archivedMessageIds: ['msg-1', 'msg-2'],
      reason: 'token_limit',
      createdAt: Date.now(),
    };

    await bundle.compactions.append('session-1', record);

    const allRecords = await bundle.compactions.loadAll();
    expect(allRecords.size).toBe(1);
    expect(allRecords.get('session-1')).toHaveLength(1);
    expect(allRecords.get('session-1')![0].recordId).toBe('rec-1');

    await bundle.close();
  });
});

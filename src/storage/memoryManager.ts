/**
 * 内存管理器
 *
 * 核心功能：
 * 1. 内存缓存 + 异步持久化
 * 2. Context 和 History 分离存储
 * 3. 压缩记录管理
 * 4. 会话管理
 *
 * 压缩逻辑由 Agent 的 compaction.ts 处理，存储模块只负责：
 * - 记录压缩结果
 * - 标记被归档的消息
 * - 保存压缩记录
 */

import { randomUUID } from 'crypto';
import type { Message } from '../core/types';
import type { IStorageBundle } from './interfaces';
import type {
  HistoryMessage,
  ContextData,
  CompactionRecord,
  SessionData,
  CompactContextOptions,
  HistoryFilter,
  HistoryQueryOptions,
  SessionFilter,
  QueryOptions,
  ContextExclusionReason,
} from './types';

// =============================================================================
// 内存缓存
// =============================================================================

/**
 * 内存缓存结构
 */
interface MemoryCache {
  sessions: Map<string, SessionData>;
  contexts: Map<string, ContextData>;
  histories: Map<string, HistoryMessage[]>;
  compactions: Map<string, CompactionRecord[]>;
}

/**
 * 创建空的内存缓存
 */
function createMemoryCache(): MemoryCache {
  return {
    sessions: new Map(),
    contexts: new Map(),
    histories: new Map(),
    compactions: new Map(),
  };
}

// =============================================================================
// MemoryManager 类
// =============================================================================

/**
 * 内存管理器
 *
 * 统一管理 Context、History、Compaction、Session 的存储和缓存
 */
export class MemoryManager {
  private initialized = false;
  private initializePromise: Promise<void> | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly cache = createMemoryCache();

  constructor(private readonly stores: IStorageBundle) {}

  // ===========================================================================
  // 生命周期
  // ===========================================================================

  /**
   * 初始化存储
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.initializePromise) {
      return this.initializePromise;
    }

    this.initializePromise = this.doInitialize();
    try {
      await this.initializePromise;
    } finally {
      this.initializePromise = null;
    }
  }

  private async doInitialize(): Promise<void> {
    await Promise.all([
      this.stores.contexts.prepare(),
      this.stores.histories.prepare(),
      this.stores.compactions.prepare(),
      this.stores.sessions.prepare(),
    ]);

    const [sessions, contexts, histories, compactions] = await Promise.all([
      this.stores.sessions.loadAll(),
      this.stores.contexts.loadAll(),
      this.stores.histories.loadAll(),
      this.stores.compactions.loadAll(),
    ]);

    this.cache.sessions = sessions;
    this.cache.contexts = contexts;
    this.cache.histories = histories;
    this.cache.compactions = compactions;

    this.initialized = true;
  }

  /**
   * 关闭存储
   */
  async close(): Promise<void> {
    if (this.initializePromise) {
      await this.initializePromise.catch(() => undefined);
    }
    await this.stores.close();
    this.initialized = false;
  }

  // ===========================================================================
  // 会话管理
  // ===========================================================================

  /**
   * 创建新会话
   */
  async createSession(sessionId: string | undefined, systemPrompt: string): Promise<string> {
    return this.enqueueMutation(async () => {
      this.ensureInitialized();

      const sid = sessionId ?? randomUUID();
      if (this.cache.sessions.has(sid)) {
        throw new Error(`Session already exists: ${sid}`);
      }

      const now = Date.now();
      const contextId = randomUUID();

      // 创建会话数据
      const session: SessionData = {
        sessionId: sid,
        systemPrompt,
        currentContextId: contextId,
        totalMessages: 1,
        compactionCount: 0,
        totalUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };

      // 创建系统消息
      const systemMessage: HistoryMessage = {
        messageId: randomUUID(),
        role: 'system',
        content: systemPrompt,
        sequence: 1,
        turn: 0,
        createdAt: now,
      };

      // 创建上下文
      const context: ContextData = {
        contextId,
        sessionId: sid,
        systemPrompt,
        messages: [systemMessage],
        version: 1,
        stats: {
          totalMessagesInHistory: 1,
          compactionCount: 0,
        },
        createdAt: now,
        updatedAt: now,
      };

      // 创建历史
      const history: HistoryMessage[] = [systemMessage];
      const records: CompactionRecord[] = [];

      await this.withBundleTransaction(async () => {
        await Promise.all([
          this.stores.sessions.save(sid, session),
          this.stores.contexts.save(sid, context),
          this.stores.histories.save(sid, history),
          this.stores.compactions.save(sid, records),
        ]);
      });

      // 仅在持久化成功后更新缓存
      this.cache.sessions.set(sid, session);
      this.cache.contexts.set(sid, context);
      this.cache.histories.set(sid, history);
      this.cache.compactions.set(sid, records);

      return sid;
    });
  }

  /**
   * 获取会话
   */
  getSession(sessionId: string): SessionData | null {
    const session = this.cache.sessions.get(sessionId);
    return session ? this.clone(session) : null;
  }

  /**
   * 查询会话列表
   */
  querySessions(filter?: SessionFilter, options?: QueryOptions): SessionData[] {
    let sessions = Array.from(this.cache.sessions.values());

    if (filter) {
      if (filter.sessionId) {
        sessions = sessions.filter((s) => s.sessionId === filter.sessionId);
      }
      if (filter.status) {
        sessions = sessions.filter((s) => s.status === filter.status);
      }
      if (filter.startTime !== undefined) {
        sessions = sessions.filter((s) => s.createdAt >= filter.startTime!);
      }
      if (filter.endTime !== undefined) {
        sessions = sessions.filter((s) => s.createdAt <= filter.endTime!);
      }
    }

    const orderBy = options?.orderBy ?? 'updatedAt';
    const orderDirection = options?.orderDirection ?? 'desc';
    sessions.sort((a, b) => {
      const comparison = a[orderBy] - b[orderBy];
      if (comparison !== 0) {
        return orderDirection === 'asc' ? comparison : -comparison;
      }

      const tie = a.sessionId.localeCompare(b.sessionId);
      return orderDirection === 'asc' ? tie : -tie;
    });

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? sessions.length;
    return sessions.slice(offset, offset + limit).map((s) => this.clone(s));
  }

  // ===========================================================================
  // 上下文管理
  // ===========================================================================

  /**
   * 获取当前上下文
   */
  getContext(sessionId: string): ContextData | null {
    const context = this.cache.contexts.get(sessionId);
    return context ? this.clone(context) : null;
  }

  /**
   * 获取 LLM 格式的消息列表
   */
  getContextMessages(sessionId: string): Message[] {
    const context = this.cache.contexts.get(sessionId);
    if (!context) return [];

    return context.messages
      .filter((m) => !m.excludedFromContext)
      .map((m) => ({
        messageId: m.messageId,
        role: m.role,
        content: m.content,
        reasoning_content: m.reasoning_content,
        tool_calls: m.tool_calls,
        tool_call_id: m.tool_call_id,
        name: m.name,
        id: m.id,
        type: m.type,
        finish_reason: m.finish_reason,
        usage: m.usage,
      }));
  }

  /**
   * 添加消息到上下文和历史
   */
  async addMessages(
    sessionId: string,
    messages: Message[],
    options?: { addToHistory?: boolean }
  ): Promise<void> {
    await this.enqueueMutation(async () => {
      this.ensureInitialized();

      if (messages.length === 0) return;

      const session = this.clone(this.requireSession(sessionId));
      const context = this.clone(this.requireContext(sessionId));
      const now = Date.now();
      const shouldAddToHistory = options?.addToHistory !== false;
      const history = shouldAddToHistory
        ? this.clone(this.cache.histories.get(sessionId) ?? [])
        : null;

      const nextSequence = this.getNextSequenceFromHistory(
        history ?? this.cache.histories.get(sessionId) ?? []
      );
      const historyMessages: HistoryMessage[] = messages.map((msg, idx) => ({
        ...msg,
        sequence: nextSequence + idx,
        turn: context.stats.compactionCount + 1,
        createdAt: now,
      }));

      context.messages.push(...historyMessages);
      context.version += 1;
      context.updatedAt = now;
      session.updatedAt = now;

      if (history) {
        history.push(...historyMessages);
        session.totalMessages = history.length;
        context.stats.totalMessagesInHistory = history.length;
      }

      await this.withBundleTransaction(async () => {
        const writes: Promise<void>[] = [
          this.stores.contexts.save(sessionId, context),
          this.stores.sessions.save(sessionId, session),
        ];

        if (history) {
          writes.push(this.stores.histories.save(sessionId, history));
        }

        await Promise.all(writes);
      });

      this.cache.contexts.set(sessionId, context);
      this.cache.sessions.set(sessionId, session);
      if (history) {
        this.cache.histories.set(sessionId, history);
      }
    });
  }

  /**
   * 更新上下文中的消息
   */
  async updateMessageInContext(
    sessionId: string,
    messageId: string,
    updates: Partial<HistoryMessage>
  ): Promise<void> {
    await this.enqueueMutation(async () => {
      this.ensureInitialized();

      const session = this.clone(this.requireSession(sessionId));
      const context = this.clone(this.requireContext(sessionId));

      const contextIndex = context.messages.findIndex((m) => m.messageId === messageId);
      if (contextIndex === -1) {
        throw new Error(`Message not found in context: ${messageId}`);
      }

      const safeUpdates = this.clone(updates);
      delete (safeUpdates as Record<string, unknown>).messageId;
      delete (safeUpdates as Record<string, unknown>).sequence;

      context.messages[contextIndex] = {
        ...context.messages[contextIndex],
        ...safeUpdates,
      };

      const history = this.cache.histories.has(sessionId)
        ? this.clone(this.cache.histories.get(sessionId) ?? [])
        : null;
      let historyChanged = false;
      if (history) {
        const historyIndex = history.findIndex((h) => h.messageId === messageId);
        if (historyIndex !== -1) {
          history[historyIndex] = {
            ...history[historyIndex],
            ...safeUpdates,
          };
          historyChanged = true;
        }
      }

      const now = Date.now();
      context.updatedAt = now;
      session.updatedAt = now;

      await this.withBundleTransaction(async () => {
        const writes: Promise<void>[] = [
          this.stores.contexts.save(sessionId, context),
          this.stores.sessions.save(sessionId, session),
        ];

        if (historyChanged && history) {
          writes.push(this.stores.histories.save(sessionId, history));
        }

        await Promise.all(writes);
      });

      this.cache.contexts.set(sessionId, context);
      this.cache.sessions.set(sessionId, session);
      if (historyChanged && history) {
        this.cache.histories.set(sessionId, history);
      }
    });
  }

  /**
   * 从上下文中移除消息（但保留在历史中）
   */
  async removeMessageFromContext(
    sessionId: string,
    messageId: string,
    reason: ContextExclusionReason = 'manual'
  ): Promise<boolean> {
    return this.enqueueMutation(async () => {
      this.ensureInitialized();

      const session = this.clone(this.requireSession(sessionId));
      const context = this.clone(this.requireContext(sessionId));
      const history = this.cache.histories.has(sessionId)
        ? this.clone(this.cache.histories.get(sessionId) ?? [])
        : null;

      const contextIndex = context.messages.findIndex((m) => m.messageId === messageId);
      const historyIndex = history ? history.findIndex((h) => h.messageId === messageId) : -1;

      if (contextIndex === -1) return false;

      const target = context.messages[contextIndex];
      if (target.role === 'system') return false;

      context.messages.splice(contextIndex, 1);
      context.version += 1;

      let historyChanged = false;
      if (history && historyIndex !== -1) {
        const historyItem = history[historyIndex];
        if (historyItem.role !== 'system') {
          history[historyIndex] = {
            ...historyItem,
            excludedFromContext: true,
            excludedReason: reason,
          };
          historyChanged = true;
        }
      }

      const now = Date.now();
      context.updatedAt = now;
      session.updatedAt = now;

      await this.withBundleTransaction(async () => {
        const writes: Promise<void>[] = [
          this.stores.contexts.save(sessionId, context),
          this.stores.sessions.save(sessionId, session),
        ];

        if (historyChanged && history) {
          writes.push(this.stores.histories.save(sessionId, history));
        }

        await Promise.all(writes);
      });

      this.cache.contexts.set(sessionId, context);
      this.cache.sessions.set(sessionId, session);
      if (historyChanged && history) {
        this.cache.histories.set(sessionId, history);
      }

      return true;
    });
  }

  /**
   * 清空上下文（保留系统消息）
   */
  async clearContext(sessionId: string): Promise<void> {
    await this.enqueueMutation(async () => {
      this.ensureInitialized();

      const session = this.clone(this.requireSession(sessionId));
      const context = this.clone(this.requireContext(sessionId));

      const systemMessage = context.messages.find((m) => m.role === 'system');
      context.messages = systemMessage ? [systemMessage] : [];
      context.version += 1;

      const now = Date.now();
      context.updatedAt = now;
      session.updatedAt = now;

      await this.withBundleTransaction(async () => {
        await Promise.all([
          this.stores.contexts.save(sessionId, context),
          this.stores.sessions.save(sessionId, session),
        ]);
      });

      this.cache.contexts.set(sessionId, context);
      this.cache.sessions.set(sessionId, session);
    });
  }

  /**
   * 应用压缩结果
   *
   * 由 Agent 的 compact 函数生成压缩结果后调用
   */
  async applyCompaction(
    sessionId: string,
    options: CompactContextOptions
  ): Promise<CompactionRecord> {
    return this.enqueueMutation(async () => {
      this.ensureInitialized();

      const session = this.clone(this.requireSession(sessionId));
      const context = this.clone(this.requireContext(sessionId));
      const history = this.clone(this.cache.histories.get(sessionId) ?? []);
      const records = this.clone(this.cache.compactions.get(sessionId) ?? []);

      const now = Date.now();
      const recordId = randomUUID();

      // 创建摘要消息
      const summaryMessage: HistoryMessage = {
        ...options.summaryMessage,
        sequence: this.getNextSequenceFromHistory(history),
        isSummary: true,
        createdAt: now,
      };

      // 标记历史中被归档的消息
      const archivedIdSet = new Set(options.removedMessageIds);
      for (const msg of history) {
        if (archivedIdSet.has(msg.messageId)) {
          msg.archivedBy = recordId;
          msg.excludedFromContext = true;
          msg.excludedReason = 'compression';
        }
      }

      // 添加摘要到历史
      history.push(summaryMessage);

      // 更新上下文 - 移除被归档的消息，添加摘要
      const systemMessage = context.messages.find((m) => m.role === 'system');
      context.messages = context.messages.filter(
        (m) => !archivedIdSet.has(m.messageId) && m.role !== 'system'
      );
      if (systemMessage) {
        context.messages.unshift(systemMessage);
      }
      // 在 system 消息后插入摘要
      const insertIndex = systemMessage ? 1 : 0;
      context.messages.splice(insertIndex, 0, summaryMessage);

      context.version += 1;
      context.lastCompactionId = recordId;
      context.updatedAt = now;
      context.stats = {
        totalMessagesInHistory: history.length,
        compactionCount: session.compactionCount + 1,
        lastCompactionAt: now,
      };

      // 更新会话
      session.compactionCount += 1;
      session.totalMessages = history.length;
      session.updatedAt = now;

      // 创建压缩记录
      const record: CompactionRecord = {
        recordId,
        sessionId,
        compactedAt: now,
        messageCountBefore: history.length - 1, // 减去新添加的摘要
        messageCountAfter: context.messages.length,
        archivedMessageIds: options.removedMessageIds,
        summaryMessageId: summaryMessage.messageId,
        reason: options.reason ?? 'manual',
        metadata: {
          tokenCountBefore: options.tokenCountBefore,
          tokenCountAfter: options.tokenCountAfter,
          triggerMessageId: options.triggerMessageId,
        },
        createdAt: now,
      };
      records.push(record);

      await this.withBundleTransaction(async () => {
        await Promise.all([
          this.stores.contexts.save(sessionId, context),
          this.stores.histories.save(sessionId, history),
          this.stores.sessions.save(sessionId, session),
          this.stores.compactions.save(sessionId, records),
        ]);
      });

      this.cache.contexts.set(sessionId, context);
      this.cache.histories.set(sessionId, history);
      this.cache.sessions.set(sessionId, session);
      this.cache.compactions.set(sessionId, records);

      return this.clone(record);
    });
  }

  // ===========================================================================
  // 历史管理
  // ===========================================================================

  /**
   * 获取完整历史
   */
  getHistory(filter: HistoryFilter, options?: HistoryQueryOptions): HistoryMessage[] {
    let result = [...(this.cache.histories.get(filter.sessionId) || [])];

    if (filter.messageIds && filter.messageIds.length > 0) {
      const messageIdSet = new Set(filter.messageIds);
      result = result.filter((m) => messageIdSet.has(m.messageId));
    }
    if (filter.sequenceStart !== undefined) {
      result = result.filter((m) => m.sequence >= filter.sequenceStart!);
    }
    if (filter.sequenceEnd !== undefined) {
      result = result.filter((m) => m.sequence <= filter.sequenceEnd!);
    }
    if (filter.includeSummary === false) {
      result = result.filter((m) => !m.isSummary);
    }
    if (filter.archivedBy) {
      result = result.filter((m) => m.archivedBy === filter.archivedBy);
    }

    const direction = options?.orderDirection ?? 'asc';
    result.sort((a, b) => {
      const comparison = a.sequence - b.sequence;
      return direction === 'asc' ? comparison : -comparison;
    });

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? result.length;
    return result.slice(offset, offset + limit).map((m) => this.clone(m));
  }

  /**
   * 获取压缩记录
   */
  getCompactionRecords(sessionId: string): CompactionRecord[] {
    const records = this.cache.compactions.get(sessionId) || [];
    return records.map((r) => this.clone(r));
  }

  // ===========================================================================
  // 私有方法
  // ===========================================================================

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('MemoryManager not initialized. Call initialize() first.');
    }
  }

  private requireSession(sessionId: string): SessionData {
    const session = this.cache.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return session;
  }

  private requireContext(sessionId: string): ContextData {
    const context = this.cache.contexts.get(sessionId);
    if (!context) {
      throw new Error(`Context not found: ${sessionId}`);
    }
    return context;
  }

  private getNextSequenceFromHistory(history: HistoryMessage[]): number {
    if (!history || history.length === 0) return 1;
    return Math.max(...history.map((m) => m.sequence)) + 1;
  }

  private async withBundleTransaction<T>(fn: () => Promise<T>): Promise<T> {
    const tx = this.stores.withTransaction;
    if (typeof tx === 'function') {
      return tx(fn);
    }
    return fn();
  }

  private enqueueMutation<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.then(fn, fn);
    this.mutationQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  /**
   * 安全克隆对象
   *
   * 优先使用 structuredClone，失败时回退到 JSON 序列化
   */
  private clone<T>(obj: T): T {
    // 优先使用 structuredClone（支持更多类型）
    if (typeof structuredClone === 'function') {
      try {
        return structuredClone(obj);
      } catch {
        // 回退到 JSON 方式
      }
    }

    // JSON 序列化方式（不支持 Function、Symbol、undefined 等）
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (error) {
      throw new Error(
        `Failed to clone data: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

// 导出类型
export type { ContextExclusionReason } from './types';

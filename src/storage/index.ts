/**
 * Agent 消息存储模块
 *
 * 提供灵活的消息存储机制：
 * - 内存缓存 + 异步持久化
 * - Context/History 分离存储
 * - 压缩记录管理
 *
 * ## 使用方式
 *
 * ```typescript
 * import { MemoryManager, createFileStorageBundle } from './storage';
 *
 * const bundle = createFileStorageBundle('./data');
 * const manager = new MemoryManager(bundle);
 * await manager.initialize();
 *
 * // 创建会话
 * const sessionId = await manager.createSession(undefined, 'You are helpful.');
 *
 * // 添加消息
 * await manager.addMessages(sessionId, [
 *   { messageId: '1', role: 'user', content: 'Hello' },
 *   { messageId: '2', role: 'assistant', content: 'Hi!' },
 * ]);
 *
 * // 获取 LLM 格式的消息列表
 * const messages = manager.getContextMessages(sessionId);
 *
 * // 压缩后应用结果（压缩由 Agent 的 compact 函数执行）
 * import { compact } from './agent/compaction';
 * const result = await compact(messages, { provider, keepMessagesNum: 10 });
 * await manager.applyCompaction(sessionId, {
 *   keepLastN: 10,
 *   summaryMessage: result.summaryMessage,
 *   removedMessageIds: result.removedMessageIds,
 * });
 * ```
 */

// =============================================================================
// 类型定义
// =============================================================================

export type {
  Message,
  HistoryMessage,
  ContextExclusionReason,
  ContextData,
  ContextStats,
  CompactionRecord,
  SessionData,
  SessionStatus,
  QueryOptions,
  HistoryQueryOptions,
  HistoryFilter,
  SessionFilter,
  CompactContextOptions,
} from './types';

// =============================================================================
// 接口定义
// =============================================================================

export type {
  IBaseStorage,
  IContextStorage,
  IHistoryStorage,
  ICompactionStorage,
  ISessionStorage,
  IStorageBundle,
} from './interfaces';

// =============================================================================
// 核心类
// =============================================================================

export { MemoryManager } from './memoryManager';
export { AtomicJsonStore } from './atomic-json';
export { FileContextStorage } from './fileContextStore';
export { FileHistoryStore } from './fileHistoryStore';
export { FileCompactionStore } from './fileCompactionStore';
export { FileSessionStore } from './fileSessionStore';
export { createFileStorageBundle } from './fileStoreBundle';
export type { FileStorageBundleOptions } from './fileStoreBundle';
export { SqliteClient } from './sqliteClient';
export { createSqliteStorageBundle } from './sqliteStoreBundle';
export type { SqliteStorageBundleOptions } from './sqliteStoreBundle';

// =============================================================================
// 工具函数
// =============================================================================

export { encodeEntityFileName, safeDecodeEntityFileName } from './filename-codec';

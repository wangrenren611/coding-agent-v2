/**
 * 存储接口定义
 *
 * 定义各种存储的接口，支持不同的后端实现
 */

import type {
  ContextData,
  HistoryMessage,
  CompactionRecord,
  SessionData,
  QueryOptions,
  SessionFilter,
} from './types';

// =============================================================================
// 基础存储接口
// =============================================================================

/**
 * 基础存储接口
 */
export interface IBaseStorage {
  /** 初始化存储（创建目录等） */
  prepare(): Promise<void>;
}

// =============================================================================
// 上下文存储接口
// =============================================================================

/**
 * 上下文存储接口
 *
 * 存储当前活跃的上下文，用于 LLM 对话
 */
export interface IContextStorage extends IBaseStorage {
  /**
   * 加载所有上下文到 Map
   */
  loadAll(): Promise<Map<string, ContextData>>;

  /**
   * 保存上下文
   */
  save(sessionId: string, context: ContextData): Promise<void>;

  /**
   * 删除上下文
   */
  delete(sessionId: string): Promise<void>;
}

// =============================================================================
// 历史存储接口
// =============================================================================

/**
 * 历史存储接口
 *
 * 存储完整的消息历史，支持追加和查询
 */
export interface IHistoryStorage extends IBaseStorage {
  /**
   * 加载所有历史到 Map
   */
  loadAll(): Promise<Map<string, HistoryMessage[]>>;

  /**
   * 保存完整历史（覆盖）
   */
  save(sessionId: string, history: HistoryMessage[]): Promise<void>;

  /**
   * 追加消息到历史
   */
  append(sessionId: string, messages: HistoryMessage[]): Promise<void>;

  /**
   * 删除历史
   */
  delete(sessionId: string): Promise<void>;
}

// =============================================================================
// 压缩记录存储接口
// =============================================================================

/**
 * 压缩记录存储接口
 */
export interface ICompactionStorage extends IBaseStorage {
  /**
   * 加载所有压缩记录到 Map
   */
  loadAll(): Promise<Map<string, CompactionRecord[]>>;

  /**
   * 保存压缩记录列表
   */
  save(sessionId: string, records: CompactionRecord[]): Promise<void>;

  /**
   * 追加压缩记录
   */
  append(sessionId: string, record: CompactionRecord): Promise<void>;

  /**
   * 删除压缩记录
   */
  delete(sessionId: string): Promise<void>;
}

// =============================================================================
// 会话存储接口
// =============================================================================

/**
 * 会话存储接口
 */
export interface ISessionStorage extends IBaseStorage {
  /**
   * 加载所有会话到 Map
   */
  loadAll(): Promise<Map<string, SessionData>>;

  /**
   * 保存会话
   */
  save(sessionId: string, session: SessionData): Promise<void>;

  /**
   * 删除会话
   */
  delete(sessionId: string): Promise<void>;

  /**
   * 列出会话
   */
  list(options?: QueryOptions, filter?: SessionFilter): Promise<SessionData[]>;
}

// =============================================================================
// 存储包接口
// =============================================================================

/**
 * 存储包接口 - 聚合所有存储
 */
export interface IStorageBundle {
  /** 上下文存储 */
  contexts: IContextStorage;
  /** 历史存储 */
  histories: IHistoryStorage;
  /** 压缩记录存储 */
  compactions: ICompactionStorage;
  /** 会话存储 */
  sessions: ISessionStorage;

  /**
   * 关闭存储，释放资源
   */
  close(): Promise<void>;
}

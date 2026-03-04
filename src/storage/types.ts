/**
 * 存储类型定义
 *
 * 核心概念：
 * 1. Context（当前上下文）- 用于 LLM 对话的活跃消息，可能被压缩
 * 2. History（完整历史）- 所有原始消息，包含被压缩替换的消息
 * 3. Compaction（压缩记录）- 记录何时发生了压缩以及影响范围
 * 4. Session（会话）- 会话元数据
 *
 * 消息类型使用 Agent 的 Message 类型
 */

import type { Message } from '../agent/types';
import type { Usage } from '../providers';

// =============================================================================
// 重新导出 Agent 的 Message 类型
// =============================================================================

export type { Message } from '../agent/types';

// =============================================================================
// 历史消息类型
// =============================================================================

/**
 * 排除原因
 */
export type ContextExclusionReason =
  | 'compression'
  | 'invalid_response'
  | 'invalid_input'
  | 'manual';

/**
 * 历史消息项 - 扩展自 Agent 的 Message 类型
 *
 * 添加存储相关的元数据
 */
export interface HistoryMessage extends Message {
  /** 消息序号，用于排序 */
  sequence: number;
  /** 会话轮次 */
  turn?: number;
  /** 是否是压缩后的摘要消息 */
  isSummary?: boolean;
  /** 被哪个压缩记录归档 */
  archivedBy?: string;
  /** 是否从 current context 中排除（但历史保留） */
  excludedFromContext?: boolean;
  /** 排除原因 */
  excludedReason?: ContextExclusionReason;
  /** 创建时间 */
  createdAt?: number;
}

// =============================================================================
// 上下文类型
// =============================================================================

/**
 * 当前上下文数据 - 用于 LLM 对话
 */
export interface ContextData {
  /** 上下文 ID */
  contextId: string;
  /** 会话 ID */
  sessionId: string;
  /** 系统提示词 */
  systemPrompt: string;
  /** 当前活跃消息（可能包含摘要消息） */
  messages: HistoryMessage[];
  /** 当前上下文版本号，每次修改递增 */
  version: number;
  /** 最后压缩记录 ID */
  lastCompactionId?: string;
  /** 统计信息 */
  stats: ContextStats;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

/**
 * 上下文统计信息
 */
export interface ContextStats {
  /** 历史中的总消息数 */
  totalMessagesInHistory: number;
  /** 压缩次数 */
  compactionCount: number;
  /** 最后压缩时间 */
  lastCompactionAt?: number;
}

// =============================================================================
// 压缩记录类型
// =============================================================================

/**
 * 压缩记录 - 记录上下文压缩事件
 */
export interface CompactionRecord {
  /** 记录 ID */
  recordId: string;
  /** 会话 ID */
  sessionId: string;
  /** 压缩发生时间 */
  compactedAt: number;
  /** 压缩前消息数量 */
  messageCountBefore: number;
  /** 压缩后消息数量 */
  messageCountAfter: number;
  /** 被归档的消息 ID 列表 */
  archivedMessageIds: string[];
  /** 摘要消息 ID */
  summaryMessageId?: string;
  /** 压缩原因 */
  reason: 'token_limit' | 'manual' | 'auto';
  /** 元数据 */
  metadata?: {
    tokenCountBefore?: number;
    tokenCountAfter?: number;
    triggerMessageId?: string;
  };
  /** 创建时间 */
  createdAt: number;
}

// =============================================================================
// 会话类型
// =============================================================================

/**
 * 会话状态
 */
export type SessionStatus = 'active' | 'completed' | 'aborted' | 'error';

/**
 * 会话数据接口
 */
export interface SessionData {
  /** 会话 ID */
  sessionId: string;
  /** 会话标题 */
  title?: string;
  /** 系统提示词 */
  systemPrompt: string;
  /** 当前上下文 ID */
  currentContextId: string;
  /** 完整历史消息数量 */
  totalMessages: number;
  /** 压缩记录数量 */
  compactionCount: number;
  /** Token 使用统计 */
  totalUsage: Usage;
  /** 会话状态 */
  status: SessionStatus;
  /** 创建时间 */
  createdAt: number;
  /** 更新时间 */
  updatedAt: number;
}

// =============================================================================
// 查询选项
// =============================================================================

/**
 * 通用查询选项
 */
export interface QueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'updatedAt';
  orderDirection?: 'asc' | 'desc';
}

/**
 * 历史查询选项
 */
export interface HistoryQueryOptions {
  limit?: number;
  offset?: number;
  orderBy?: 'sequence';
  orderDirection?: 'asc' | 'desc';
}

/**
 * 历史消息查询过滤条件
 */
export interface HistoryFilter {
  sessionId: string;
  /** 查询特定消息 ID */
  messageIds?: string[];
  /** 查询范围 */
  sequenceStart?: number;
  sequenceEnd?: number;
  /** 是否包含摘要消息 */
  includeSummary?: boolean;
  /** 查询被特定压缩记录归档的消息 */
  archivedBy?: string;
}

/**
 * 会话查询过滤条件
 */
export interface SessionFilter {
  sessionId?: string;
  status?: SessionStatus;
  startTime?: number;
  endTime?: number;
}

// =============================================================================
// 压缩上下文参数
// =============================================================================

/**
 * 压缩上下文参数 - 与 Agent 的 CompactResult 配合
 */
export interface CompactContextOptions {
  /** 保留最近 N 条非 system 消息 */
  keepLastN: number;
  /** 摘要消息（由 Agent 的 compact 函数生成） */
  summaryMessage: Message;
  /** 被丢弃的消息 ID 列表（由 Agent 的 compact 函数返回） */
  removedMessageIds: string[];
  /** 压缩原因 */
  reason?: CompactionRecord['reason'];
  /** 触发压缩的消息 ID */
  triggerMessageId?: string;
  /** 压缩前 token 数量 */
  tokenCountBefore?: number;
  /** 压缩后 token 数量 */
  tokenCountAfter?: number;
}

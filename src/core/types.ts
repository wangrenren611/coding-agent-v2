/**
 * 核心共享类型定义
 *
 * 这些类型被多个模块共享使用，避免循环依赖
 */

import type {
  Role,
  MessageContent,
  BaseLLMMessage,
  Usage,
  ToolCall,
  FinishReason,
} from '../providers';

// =============================================================================
// 从 providers 重新导出常用类型
// =============================================================================

export type { ToolCall, FinishReason, Usage, Role, MessageContent, BaseLLMMessage };

// =============================================================================
// 消息类型
// =============================================================================

/**
 * 消息类型标记
 */
export type MessageType = 'text' | 'tool-call' | 'tool-result' | 'summary';

/**
 * Agent 消息类型
 *
 * 扩展自 LLM 消息格式，添加额外元数据
 */
export interface Message extends BaseLLMMessage {
  /** 消息唯一 ID */
  messageId: string;
  /** 消息角色 */
  role: Role;
  /** 消息内容 */
  content: MessageContent;
  /** 消息类型标记 */
  type?: MessageType;
  /** 完成原因 */
  finish_reason?: FinishReason;
  /** Provider 原始消息 ID（仅存储/追踪，不参与 Agent 逻辑判断） */
  id?: string;
  /** Token 使用情况 */
  usage?: Usage;
}

// =============================================================================
// 工具执行相关类型
// =============================================================================

/**
 * 工具执行结果
 */
export interface ToolResult {
  /** 是否成功 */
  success: boolean;
  /** 返回数据 */
  data?: unknown;
  /** 错误信息 */
  error?: string;
  /** 元数据（如执行时间等） */
  metadata?: Record<string, unknown>;
}

/**
 * 工具流式事件类型
 */
export type ToolStreamEventType =
  | 'start'
  | 'stdout'
  | 'stderr'
  | 'progress'
  | 'artifact'
  | 'info'
  | 'end'
  | 'error';

/**
 * 工具流式事件
 */
export interface ToolStreamEvent {
  /** 工具调用 ID */
  toolCallId: string;
  /** 工具名称 */
  toolName: string;
  /** 事件类型 */
  type: ToolStreamEventType;
  /** 事件序号（同一 toolCall 内单调递增） */
  sequence: number;
  /** 事件时间戳（毫秒） */
  timestamp: number;
  /** 文本内容（stdout/stderr/info 等） */
  content?: string;
  /** 结构化数据（progress/artifact/end/error 等） */
  data?: unknown;
}

/**
 * 工具事件输入（供工具发射，框架自动补全上下文字段）
 */
export interface ToolStreamEventInput {
  /** 事件类型 */
  type: ToolStreamEventType;
  /** 文本内容 */
  content?: string;
  /** 结构化数据 */
  data?: unknown;
  /** 自定义序号（可选） */
  sequence?: number;
  /** 自定义时间戳（可选） */
  timestamp?: number;
}

/**
 * Agent 级工具上下文（统一注入给工具）
 */
export interface AgentToolContext {
  /** 会话 ID */
  sessionId: string;
  /** 循环索引 */
  loopIndex: number;
  /** 步骤索引 */
  stepIndex: number;
  /** 工具流式事件发射器（可选） */
  emitToolEvent?: (event: ToolStreamEventInput) => void | Promise<void>;
}

/**
 * 工具执行上下文
 *
 * 传递给工具执行时的上下文信息
 */
export interface ToolExecutionContext {
  /** 工具调用 ID */
  toolCallId: string;
  /** 循环索引 */
  loopIndex: number;
  /** 步骤索引 */
  stepIndex: number;
  /** Agent 实例引用 */
  agent: import('../agent/agent').Agent;
  /** Agent 级上下文 */
  agentContext?: AgentToolContext;
  /** 工具流式事件发射器（可选） */
  emitToolEvent?: (event: ToolStreamEventInput) => void | Promise<void>;
  /** 工具执行中断信号（超时/取消时触发） */
  toolAbortSignal?: AbortSignal;
}

// =============================================================================
// Agent 状态类型
// =============================================================================

/**
 * Agent 循环状态
 *
 * 在 Agent 执行过程中跟踪当前状态
 */
export interface AgentLoopState {
  /** 当前循环索引 */
  loopIndex: number;
  /** 当前步骤索引 */
  stepIndex: number;
  /** 当前累积的文本 */
  currentText: string;
  /** 当前步骤的工具调用 */
  currentToolCalls: ToolCall[];
  /** 累积的 Token 使用 */
  totalUsage: Usage;
  /** 当前步骤的 Token 使用 */
  stepUsage: Usage;
  /** 重试次数 */
  retryCount: number;
  /** 最后一次错误 */
  lastError?: Error;
  /** 是否需要重试 */
  needsRetry: boolean;
  /** 是否已中止 */
  aborted: boolean;
  /** 循环结果状态 */
  resultStatus: 'continue' | 'stop';
}

// =============================================================================
// Hook 上下文类型
// =============================================================================

/**
 * Hook 执行上下文
 *
 * 传递给 Hook 函数的上下文信息
 */
export interface HookContext {
  /** 循环索引 */
  loopIndex: number;
  /** 步骤索引 */
  stepIndex: number;
  /** 会话 ID */
  sessionId: string;
  /** Agent 状态 */
  state: AgentLoopState;
}

/**
 * Agent 类型定义
 */

import type {
  LLMGenerateOptions,
  LLMRequestMessage,
  Chunk,
  Usage,
  BackoffConfig,
  ToolCall,
  FinishReason,
  Role,
  MessageContent,
  BaseLLMMessage,
} from '../providers';

// 从 providers 重新导出需要使用的类型
export type { ToolCall, FinishReason } from '../providers';
import type { MemoryManager } from '../storage';
import type { ToolManager } from '../tool';

// =============================================================================
// 事件类型
// =============================================================================

/**
 * Agent 循环事件类型
 */
export type AgentEventType =
  | 'text-delta' // 文本增量
  | 'text-complete' // 文本完成
  | 'tool-call' // 工具调用开始
  | 'tool-result' // 工具执行结果
  | 'error' // 错误发生
  | 'step-start' // 步骤开始
  | 'step-complete' // 步骤完成
  | 'loop-start' // 循环开始
  | 'loop-complete' // 循环完成
  | 'retry' // 重试
  | 'usage' // Token 使用信息
  | 'compaction' // 上下文压缩
  | 'abort'; // 中止

/**
 * Agent 事件
 */
export interface AgentEvent {
  type: AgentEventType;
  data?: unknown;
  timestamp: number;
  loopIndex: number;
  stepIndex: number;
}

/**
 * Agent 事件回调
 */
export type AgentEventCallback = (event: AgentEvent) => void | Promise<void>;

// =============================================================================
// 工具相关类型
// =============================================================================

/**
 * 工具执行器函数类型
 */
export type ToolExecutor = (
  name: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext
) => Promise<ToolResult>;

/**
 * 工具执行上下文
 */
export interface ToolExecutionContext {
  toolCallId: string;
  loopIndex: number;
  stepIndex: number;
  agent: import('./agent').Agent;
}

/**
 * 工具执行结果
 */
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  /** 元数据（如执行时间等） */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// 状态与配置类型
// =============================================================================

/**
 * Agent 循环状态
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
  resultStatus: 'continue' | 'compact' | 'stop';
}

/**
 * Agent 配置
 */
export interface AgentConfig {
  /** Provider 实例 */
  provider: import('../providers').LLMProvider;
  /** 系统提示词 */
  systemPrompt?: string;

  // ---------------------------------------------------------------------------
  // 工具配置
  // ---------------------------------------------------------------------------

  /**
   * 工具管理器
   *
   * 统一管理工具的注册、schema生成、执行
   */
  toolManager: ToolManager;

  // ---------------------------------------------------------------------------
  // 压缩配置
  // ---------------------------------------------------------------------------

  /** 是否启用压缩 */
  enableCompaction?: boolean;
  /** 压缩触发的 token 阈值 */
  compactionThreshold?: number;
  /** 压缩时保留的最近消息数 */
  compactionKeepMessages?: number;
  /** 摘要语言 */
  summaryLanguage?: string;

  // ---------------------------------------------------------------------------
  // 其他配置
  // ---------------------------------------------------------------------------

  /** 最大循环次数 */
  maxLoops?: number;
  /** 最大步骤次数（每次LLM调用为一个步骤） */
  maxSteps?: number;
  /** 最大重试次数 */
  maxRetries?: number;
  /** 退避配置 */
  backoffConfig?: BackoffConfig;
  /** 生成选项 */
  generateOptions?: LLMGenerateOptions;
  /** 完成检测器 */
  completionDetector?: CompletionDetector;
  /** 事件回调 */
  onEvent?: AgentEventCallback;
  /** 调试模式 */
  debug?: boolean;
  /** 会话 ID（用于消息存储） */
  sessionId?: string;
  /** 内存管理器（用于消息存储） */
  memoryManager?: MemoryManager;
}

// =============================================================================
// 完成检测类型
// =============================================================================

/**
 * 完成检测结果
 */
export interface CompletionResult {
  done: boolean;
  reason: 'stop' | 'length' | 'tool_calls_complete' | 'user_abort' | 'error' | 'limit_exceeded';
  message?: string;
}

/**
 * 完成检测器
 */
export type CompletionDetector = (
  state: AgentLoopState,
  messages: LLMRequestMessage[],
  lastResponse?: AgentStepResult
) => Promise<CompletionResult> | CompletionResult;

// =============================================================================
// 结果类型
// =============================================================================

/**
 * 步骤执行结果
 */
export interface AgentStepResult {
  /** 生成的文本 */
  text: string;
  /** 工具调用列表 */
  toolCalls: ToolCall[];
  /** 工具执行结果 */
  toolResults: Array<{ toolCallId: string; result: ToolResult }>;
  /** 完成原因 */
  finishReason: FinishReason;
  /** Token 使用 */
  usage: Usage;
  /** 原始响应块 */
  rawChunks: Chunk[];
}

/**
 * Agent 运行结果
 */
export interface AgentResult {
  /** 最终文本 */
  text: string;
  /** 完整消息历史 */
  messages: LLMRequestMessage[];
  /** 所有步骤结果 */
  steps: AgentStepResult[];
  /** 总 Token 使用 */
  totalUsage: Usage;
  /** 完成原因 */
  completionReason: CompletionResult['reason'];
  /** 完成消息 */
  completionMessage?: string;
  /** 循环次数 */
  loopCount: number;
}
export type MessageType = 'text' | 'tool-call' | 'tool-result' | 'summary';

export type Message = {
  messageId: string; //agent相关都使用这个消息id
  role: Role;
  content: MessageContent;
  type?: MessageType;
  finish_reason?: FinishReason;
  id?: string; //程序不用，大模型要用
  /** 该消息的 Token 使用情况 */
  usage?: Usage;
} & BaseLLMMessage;

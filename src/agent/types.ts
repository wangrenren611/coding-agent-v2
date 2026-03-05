/**
 * Agent 类型定义
 */

import type { LLMGenerateOptions, LLMRequestMessage, Chunk, BackoffConfig } from '../providers';

// 从 core 重新导出共享类型
export type {
  ToolCall,
  FinishReason,
  Usage,
  Message,
  MessageType,
  ToolResult,
  ToolExecutionContext,
  AgentLoopState,
} from '../core/types';

// 从 core 导入类型供内部使用
import type { ToolCall, FinishReason, Usage, ToolResult, AgentLoopState } from '../core/types';

import type { MemoryManager } from '../storage';
import type { ToolManager } from '../tool';
import type { ToolConfirmDecision, ToolConfirmRequest } from '../tool/types';
import type { Plugin } from '../hook';
import type { Logger } from '../logger';

// =============================================================================
// Agent 配置类型
// =============================================================================

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
  /** 压缩时保留的最近消息数 */
  compactionKeepMessages?: number;
  /** 摘要语言 */
  summaryLanguage?: string;
  /** 触发压缩的阈值比例（默认 0.9，即达到可用限制的 90% 时触发） */
  compactionTriggerRatio?: number;

  // ---------------------------------------------------------------------------
  // 其他配置
  // ---------------------------------------------------------------------------

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
  /** 自定义 completionDetector 返回 done=false 时，是否继续执行默认完成检测器 */
  useDefaultCompletionDetector?: boolean;
  /** 插件列表 */
  plugins?: Plugin[];
  /** 工具确认回调（用于等待用户确认） */
  onToolConfirm?: (
    request: ToolConfirmRequest
  ) => ToolConfirmDecision | Promise<ToolConfirmDecision>;
  /** 调试模式 */
  debug?: boolean;
  /** 日志记录器 */
  logger?: Logger;
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
  reason: 'stop' | 'length' | 'user_abort' | 'limit_exceeded';
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

/**
 * Agent 模块导出
 */

// 核心类
export { Agent, createAgent } from './agent.js';

// 类型导出
export type {
  CompletionResult,
  AgentConfig,
  CompletionDetector,
  AgentStepResult,
  AgentResult,
} from './types';

// 从 core 重新导出共享类型
export type {
  ToolCall,
  FinishReason,
  Usage,
  Message,
  MessageType,
  ToolResult,
  ToolStreamEventType,
  ToolStreamEvent,
  ToolStreamEventInput,
  AgentToolContext,
  ToolExecutionContext,
  AgentLoopState,
} from '../core/types';

// 重新导出 Plugin 类型（方便使用）
export type { Plugin } from '../hook';

// 错误类
export { AgentLoopExceededError, AgentAbortedError, AgentMaxRetriesExceededError } from './errors';

// 状态管理
export {
  DEFAULT_AGENT_CONFIG,
  createInitialState,
  createEmptyUsage,
  mergeAgentConfig,
} from './state';

// 完成检测器
export { defaultCompletionDetector } from './completion';

// 上下文压缩器
export { compact, estimateTokens, estimateMessagesTokens } from './compaction';
export type { CompactOptions, CompactResult } from './compaction';

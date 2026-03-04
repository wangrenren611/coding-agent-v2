/**
 * Agent 模块导出
 */

// 核心类
export { Agent, createAgent } from './agent.js';

// 类型导出
export type {
  AgentEventType,
  AgentEvent,
  AgentEventCallback,
  ToolExecutor,
  ToolExecutionContext,
  ToolResult,
  CompletionResult,
  AgentLoopState,
  AgentConfig,
  CompletionDetector,
  AgentStepResult,
  AgentResult,
} from './types';

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
export {
  createTextCompletionDetector,
  createToolCompletionDetector,
  combineCompletionDetectors,
  defaultCompletionDetector,
} from './completion';

// 上下文压缩器
export { compact, estimateTokens, estimateMessagesTokens } from './compaction';
export type { CompactOptions, CompactResult } from './compaction';

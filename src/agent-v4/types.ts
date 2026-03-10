/* v8 ignore file */
/* c8 ignore file */
/**
 * 企业级无状态 Agent 核心类型定义
 * 参考: ENTERPRISE_REALTIME.md
 */

import { LLMGenerateOptions, MessageContent, Tool, ToolCall, Usage } from '../providers';

// ============================================================
// 消息类型
// ============================================================
export type MessageType =
  | 'system'
  | 'user'
  | 'tool-call'
  | 'tool-result'
  | 'summary'
  | 'assistant-text';

export interface Message {
  messageId: string;
  type: MessageType;
  /** @deprecated 请使用 messageId 字段代替 */
  id?: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: MessageContent;
  reasoning_content?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  timestamp: number;
  metadata?: Record<string, unknown>;
  usage?: Usage;
}

// ============================================================
// Agent 输入输出
// ============================================================

export interface AgentInput {
  executionId: string;
  conversationId: string;
  messages: Message[];
  systemPrompt?: string;
  tools?: Tool[];
  config?: LLMGenerateOptions;
  maxSteps?: number;
  abortSignal?: AbortSignal;
  timeoutBudgetMs?: number;
  llmTimeoutRatio?: number;
  contextLimitTokens?: number;
}

export interface AgentOutput {
  messages: Message[];
  finishReason: 'stop' | 'max_steps' | 'error';
  steps: number;
}

// ============================================================
// 回调接口
// ============================================================

export interface ErrorDecision {
  retry: boolean;
  message?: string;
}

export interface AgentMetric {
  name: string;
  value: number;
  unit?: 'ms' | 'count';
  timestamp: number;
  tags?: Record<string, string | number | boolean>;
}

export interface AgentTraceEvent {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  phase: 'start' | 'end';
  timestamp: number;
  attributes?: Record<string, unknown>;
}

export interface AgentContextUsage {
  stepIndex: number;
  messageCount: number;
  contextTokens: number;
  contextLimitTokens: number;
  contextUsagePercent: number;
}

export interface AgentCallbacks {
  onMessage: (message: Message) => void | Promise<void>;
  onCheckpoint: (checkpoint: ExecutionCheckpoint) => void | Promise<void>;
  onProgress?: (progress: ExecutionProgress) => void | Promise<void>;
  onCompaction?: (compaction: CompactionInfo) => void | Promise<void>;
  onContextUsage?: (usage: AgentContextUsage) => void | Promise<void>;
  onMetric?: (metric: AgentMetric) => void | Promise<void>;
  onTrace?: (event: AgentTraceEvent) => void | Promise<void>;
  onToolPolicy?: (info: ToolPolicyCheckInfo) => ToolPolicyDecision | Promise<ToolPolicyDecision>;
  onError?: (error: Error) => ErrorDecision | void | Promise<ErrorDecision | void>;
}

export interface CompactionInfo {
  executionId: string;
  stepIndex: number;
  removedMessageIds: string[];
  messageCountBefore: number;
  messageCountAfter: number;
}

export interface ExecutionCheckpoint {
  executionId: string;
  stepIndex: number;
  lastMessageId: string;
  lastMessageTime: number;
  canResume: boolean;
}

export interface ExecutionProgress {
  executionId: string;
  stepIndex: number;
  currentAction: 'llm' | 'tool' | 'waiting';
  messageCount: number;
}

export interface ToolStreamChunk {
  type: 'stdout' | 'stderr' | 'progress';
  data: string;
}

export interface ExecuteOptions {
  onChunk?: (chunk: ToolStreamChunk) => void;
  onConfirm?: (info: ToolConfirmInfo) => Promise<ToolDecision>;
}

export interface ToolConfirmInfo {
  toolCallId: string;
  toolName: string;
  arguments: string;
}

export interface ToolDecision {
  approved: boolean;
  message?: string;
}

export interface ToolPolicyCheckInfo {
  toolCallId: string;
  toolName: string;
  arguments: string;
  parsedArguments: Record<string, unknown>;
}

export interface ToolPolicyDecision {
  allowed: boolean;
  code?: string;
  message?: string;
  audit?: Record<string, unknown>;
}

// ============================================================
// 流式事件
// ============================================================

export interface StreamEvent {
  type:
    | 'chunk'
    | 'reasoning_chunk'
    | 'tool_call'
    | 'tool_result'
    | 'tool_stream'
    | 'progress'
    | 'checkpoint'
    | 'compaction'
    | 'done'
    | 'error';
  data: unknown;
}

// ============================================================
// 执行状态
// ============================================================

export type ExecutionStatus =
  | 'CREATED'
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface Execution {
  executionId: string;
  conversationId: string;
  status: ExecutionStatus;
  stepIndex?: number;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  result?: string;
  error?: string;
}

// ============================================================
// 任务
// ============================================================

export interface Task {
  executionId: string;
  conversationId: string;
  message: {
    role: 'user';
    content: string;
  };
  createdAt: number;
}

// ============================================================
// 上下文
// ============================================================

export interface ConversationContext {
  messages: Message[];
  systemPrompt?: string;
  tools?: Tool[];
}

export const AGENT_V4_TYPES_MODULE = 'agent-v4-types';

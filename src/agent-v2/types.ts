import { ToolCall, Usage } from '../providers';

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
  sessionId: string;
  stepIndex: number;
  emitToolEvent?: (event: ToolStreamEventInput) => void | Promise<void>;
}

/**
 * 工具执行上下文
 *
 * 传递给工具执行时的上下文信息
 */
export interface ToolExecutionContext {
  toolCallId: string;
  stepIndex: number;
  agent: import('../agent/agent').Agent;
  agentContext?: AgentToolContext;
  emitToolEvent?: (event: ToolStreamEventInput) => void | Promise<void>;
  toolAbortSignal?: AbortSignal;
}

/**
 * Agent 循环状态
 *
 * 在 Agent 执行过程中跟踪当前状态
 */
export interface AgentLoopState {
  stepIndex: number;
  currentText: string;
  currentToolCalls: ToolCall[];
  totalUsage: Usage;
  stepUsage: Usage;
  retryCount: number;
  lastError?: Error;
  needsRetry: boolean;
  aborted: boolean;
  resultStatus: 'continue' | 'stop';
}

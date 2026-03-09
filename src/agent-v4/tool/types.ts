/* v8 ignore file */
/* c8 ignore file */
export interface Tool {
  name: string;
  description: string;
  parameters: unknown;
}

export interface LLMTool{
  type: 'function';
  function: Tool;
}

export interface ToolCallFunction {
  name: string;
  arguments: string;
}

export interface ToolCall {
  id: string;
  type: string;
  index: number;
  function: ToolCallFunction;
}

export interface ToolStreamChunk {
  type: 'stdout' | 'stderr' | 'progress';
  data: string;
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

export type ToolConcurrencyMode = 'parallel-safe' | 'exclusive';

export interface ToolConcurrencyPolicy {
  mode: ToolConcurrencyMode;
  lockKey?: string;
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
 * 工具事件输入
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
 * 工具执行上下文
 *
 * 传递给工具执行时的上下文信息
 */
export interface ToolExecutionContext {
  /** 工具调用 ID */
  toolCallId: string;
  /** 循环索引 */
  loopIndex: number;
  /** Agent 实例引用 */
  agent: unknown;
  /** 工具流式事件发射器（可选） */
  onChunk?: (event: ToolStreamEventInput) => void | Promise<void>;
  onConfirm?: (info: ToolConfirmInfo) => Promise<ToolDecision>;
  onPolicyCheck?: (
    info: ToolPolicyCheckInfo
  ) => ToolPolicyDecision | Promise<ToolPolicyDecision>;
  /** 工具执行中断信号（超时/取消时触发） */
  toolAbortSignal?: AbortSignal;
}

export const AGENT_V4_TOOL_TYPES_MODULE = 'agent-v4-tool-types';

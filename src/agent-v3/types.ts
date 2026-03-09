/**
 * 企业级无状态 Agent 核心类型定义
 * 参考: ENTERPRISE_REALTIME.md
 */

// ============================================================
// 消息类型
// ============================================================

export interface Message {
  messageId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface ToolCall {
  id: string;
  type: 'function';
  name: string;
  arguments: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: any;
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
  config?: LLMConfig;
  maxSteps?: number;
  startStep?: number;
}

export interface AgentOutput {
  messages: Message[];
  finishReason: 'stop' | 'max_steps' | 'error';
  steps: number;
}

// ============================================================
// LLM 配置
// ============================================================

export interface LLMConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

export interface LLMResponse {
  message: Message;
  toolCalls?: ToolCall[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  finishReason?: string;
}

export interface Chunk {
  id: string;
  choices: Array<{
    index: number;
    delta: {
      content?: string;
      tool_calls?: ToolCall[];
    };
    finish_reason?: string;
  }>;
}

// ============================================================
// 回调接口
// ============================================================

export interface AgentCallbacks {
  onMessage: (message: Message) => void | Promise<void>;
  onCheckpoint: (checkpoint: ExecutionCheckpoint) => void | Promise<void>;
  onProgress?: (progress: ExecutionProgress) => void | Promise<void>;
  onError?: (error: Error) => void | Promise<void>;
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

// ============================================================
// 流式事件
// ============================================================

export interface StreamEvent {
  type: 'chunk' | 'tool_call' | 'tool_result' | 'progress' | 'checkpoint' | 'done' | 'error';
  data: any;
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

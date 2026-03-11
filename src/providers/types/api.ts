/**
 * LLM API 相关类型定义
 *
 * 统一的 API 类型定义，包含请求、响应、消息、工具调用等核心类型
 */

/**
 * 工具调用
 */
export type ToolCall = {
  id: string;
  type: string;
  index: number;
  function: {
    name: string;
    arguments: string;
  };
};

/**
 * 消息角色类型
 */
export type Role = 'system' | 'assistant' | 'user' | 'tool';

/**
 * 多模态消息内容片段（OpenAI Chat Completions 风格）
 */
export interface TextContentPart {
  type: 'text';
  text: string;
}

export interface ImageUrlContentPart {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

export interface InputAudioContentPart {
  type: 'input_audio';
  input_audio: {
    data: string;
    format: 'wav' | 'mp3';
  };
}

export interface InputVideoContentPart {
  type: 'input_video';
  input_video: {
    url?: string;
    file_id?: string;
    data?: string;
    format?: 'mp4' | 'mov' | 'webm';
  };
}

export interface FileContentPart {
  type: 'file';
  file: {
    file_id?: string;
    file_data?: string;
    filename?: string;
  };
}

export type InputContentPart =
  | TextContentPart
  | ImageUrlContentPart
  | InputAudioContentPart
  | InputVideoContentPart
  | FileContentPart;

/**
 * 消息内容：纯文本或多模态数组
 */
export type MessageContent = string | InputContentPart[];

/**
 * Token 使用情况（统一类型，移除重复定义）
 */
export interface Usage {
  /** 用户 prompt 所包含的 token 数 */
  prompt_tokens: number;
  /** 模型 completion 产生的 token 数 */
  completion_tokens: number;
  /** 该请求中，所有 token 的数量（prompt + completion） */
  total_tokens: number;
  /** 用户 prompt 中未命中缓存的 token 数（可选，部分提供商支持） */
  prompt_cache_miss_tokens?: number;
  /** 用户 prompt 中命中缓存的 token 数（可选，部分提供商支持） */
  prompt_cache_hit_tokens?: number;
}

/**
 * 流式输出选项
 */
export interface StreamOptions {
  /**
   * 请求服务端在流结束时返回 usage 信息
   * 兼容 OpenAI `stream_options.include_usage` 语义
   */
  include_usage?: boolean;
  [key: string]: unknown;
}

/**
 * 基础消息类型
 */
export interface BaseLLMMessage {
  /** 消息 ID */
  content: MessageContent;
  role: Role;
  reasoning_content?: string;
  [key: string]: unknown; // 添加索引签名以兼容 Record<string, unknown>
}

/**
 * LLM 响应消息
 */
export interface LLMResponseMessage extends BaseLLMMessage {
  tool_calls?: ToolCall[];
}

/**
 * LLM 请求消息
 */
export interface LLMRequestMessage extends BaseLLMMessage {
  tool_call_id?: string;
}

/**
 * 完成原因
 * - stop: 正常完成
 * - length: 达到 token 限制
 * - content_filter: 内容过滤
 * - tool_calls: 工具调用
 * - abort: 请求被中断
 */
export type FinishReason = 'stop' | 'length' | 'content_filter' | 'tool_calls' | 'abort' | null;

/**
 * LLM 响应
 */
export interface LLMResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: LLMResponseMessage;
    finish_reason?: FinishReason;
  }>;
  usage?: Usage;
  [key: string]: unknown; // 添加索引签名以兼容 Record<string, unknown>
}

/**
 * 流式错误对象（部分 OpenAI 兼容服务会在 SSE chunk 中返回）
 */
export interface StreamChunkError {
  code?: string | null;
  param?: string | null;
  message?: string;
  type?: string;
  [key: string]: unknown;
}

/**
 * 流式响应块
 */
export interface Chunk {
  id?: string;
  index: number;
  choices?: Array<{
    index: number;
    delta: LLMResponseMessage;
    finish_reason?: FinishReason;
  }>;
  usage?: Usage;
  model?: string;
  object?: string;
  created?: number;
  error?: StreamChunkError;
}

/**
 * 流式回调函数
 */
export type StreamCallback = (chunk: Chunk) => void;

/**
 * 工具定义
 */
export type Tool = {
  type: string;
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/**
 * LLM 生成选项（传给 generate 方法的可选参数）
 */
export interface LLMGenerateOptions {
  /** 模型名称（覆盖默认模型） */
  model?: string;
  /** 最大生成 token 数 */
  max_tokens?: number;
  /** 温度参数 */
  temperature?: number;
  /** 思考模式（部分 Provider 支持） */
  thinking?: boolean;
  /** 是否启用流式响应 */
  stream?: boolean;
  /** 是否启用工具流式输出（与 stream 一致的布尔语义） */
  tool_stream?: boolean;
  /** 推理强度（部分 Provider 支持） */
  model_reasoning_effort?: 'low' | 'medium' | 'high';
  /** 流式输出选项 */
  stream_options?: StreamOptions;
  /** 中止信号 */
  abortSignal?: AbortSignal;
  /** 工具列表 */
  tools?: Tool[];
  [key: string]: unknown; // 添加索引签名以兼容 Record<string, unknown>
}

/**
 * 完整的 LLM 请求（包含消息）
 */
export interface LLMRequest extends LLMGenerateOptions {
  /** 模型名称 */
  model: string;
  /** 对话消息列表 */
  messages: LLMRequestMessage[];
}

/**
 * Anthropic 流式事件类型
 */
export interface AnthropicStreamEvent {
  type: string;
  message?: {
    id: string;
    type: 'message';
    role: 'assistant';
    content: Array<{ type: string; text?: string }>;
    model: string;
    stop_reason: string | null;
    stop_sequence: string | null;
    usage: { input_tokens: number; output_tokens: number };
  };
  index?: number;
  content_block?: {
    type: 'text' | 'image' | 'tool_use' | 'tool_result';
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
  };
  delta?: {
    type: string;
    text?: string;
    stop_reason?: string;
    partial_json?: string;
  };
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

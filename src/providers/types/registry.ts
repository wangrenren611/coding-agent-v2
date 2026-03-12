/**
 * Registry 相关类型定义
 *
 * Provider Registry 相关的类型定义
 */

/**
 * Provider 厂商类型
 */
export type ProviderType =
  | 'anthropic'
  | 'kimi'
  | 'deepseek'
  | 'glm'
  | 'minimax'
  | 'openai'
  | 'qwen';

/**
 * 模型唯一标识
 */
export type ModelId =
  // Anthropic 系列
  | 'claude-opus-4.6'
  // GLM 系列
  | 'glm-4.7'
  // MiniMax 系列
  | 'minimax-2.5'
  // Kimi 系列
  | 'kimi-k2.5'
  // DeepSeek 系列
  // | 'deepseek-chat'
  // GLM 5.0 系列
  | 'glm-5'
  // Qwen 系列
  | 'qwen3.5-plus'
  | 'qwen-kimi-k2.5'
  | 'qwen-glm-5'
  | 'wr-claude-4.6'
  | 'qwen3.5-max'
  | 'qwen-minimax-2.5'
  | 'deepseek-reasoner'
  | 'gpt-5.3'
  | 'gpt-5.4'
  | 'openrouter/hunter-alpha';

/**
 * 模型配置
 */
export interface ModelConfig {
  /** 模型唯一标识 */
  id: ModelId;
  /** 所属厂商 */
  provider: ProviderType;
  /** 显示名称 */
  name: string;
  /** API 端点路径 */
  endpointPath: string;
  /** API Key 环境变量名 */
  envApiKey: string;
  /** Base URL 环境变量名 */
  envBaseURL: string;
  /** API 基础 URL */
  baseURL: string;
  /** API 模型名称 */
  model: string;
  /** 最大输出 token 数 */
  max_tokens: number;
  /** 最大上下文 token 数 */
  LLMMAX_TOKENS: number;
  /** 支持的特性 */
  features: string[];
  /** 多模态输入能力 */
  modalities?: {
    image?: boolean;
    audio?: boolean;
    video?: boolean;
  };
  /** API 密钥（可选） */
  apiKey?: string;
  /** 温度（可选） */
  temperature?: number;
  /** 默认工具流式输出（可选） */
  tool_stream?: boolean;
  thinking?: boolean;
  timeout?: number;
  model_reasoning_effort?: 'low' | 'medium' | 'high';
}

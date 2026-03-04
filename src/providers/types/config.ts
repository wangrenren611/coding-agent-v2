/**
 * 配置相关类型定义
 *
 * 统一的配置类型，包括基础配置、Provider 配置和 OpenAI 兼容配置
 */

/**
 * 基础 API 配置接口
 */
export interface BaseAPIConfig {
  /** API 基础 URL */
  baseURL: string;
  /** 模型名称 */
  model: string;
  /** 最大生成 token 数 */
  max_tokens: number;
  /** 最大上下文 token 数 */
  LLMMAX_TOKENS: number;
  /** 温度参数 */
  temperature: number;
  /** 请求超时时间（毫秒） */
  timeout?: number;
  /** 最大重试次数（由上层重试策略使用） */
  maxRetries?: number;
  /** 启用调试日志 */
  debug?: boolean;
}

/**
 * Provider 基础配置
 */
export interface BaseProviderConfig extends BaseAPIConfig {
  /** API 密钥或凭证 */
  apiKey: string;
  /** 思考模式（部分 Provider 支持） */
  thinking?: boolean;
  /** 其他扩展字段 */
  [key: string]: unknown;
}

/**
 * OpenAI 兼容服务配置
 */
export interface OpenAICompatibleConfig extends BaseProviderConfig {
  /** 可选的组织 ID（部分提供商需要） */
  organization?: string;
  /** 聊天补全接口路径，默认为 '/chat/completions' */
  chatCompletionsPath?: string;
  /** 是否在流式请求中默认要求返回 usage（默认 true） */
  enableStreamUsage?: boolean;
  /** 默认是否启用工具流式输出（请求级可被 generate options 覆盖） */
  tool_stream?: boolean;
}

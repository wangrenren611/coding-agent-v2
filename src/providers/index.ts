/**
 * Providers 统一导出
 */

// Registry 相关
export { Models, MODEL_CONFIGS, ProviderRegistry } from './registry';
export type { ProviderType, BuiltinModelId, ModelId } from './registry';

// Provider 相关
export { LLMProvider } from './types';
export type { BaseProviderConfig, ProviderLogger } from './types';

// OpenAI Compatible Provider
export { OpenAICompatibleProvider } from './openai-compatible';
export type { OpenAICompatibleConfig } from './openai-compatible';

// 适配器
export { BaseAPIAdapter } from './adapters/base';
export { StandardAdapter, type StandardTransformOptions } from './adapters/standard';

// HTTP 客户端
export { HTTPClient, type HttpClientOptions, type RequestInitWithOptions } from './http/client';
export { StreamParser } from './http/stream-parser';

// 错误类型
export {
  PERMANENT_STREAM_ERROR_CODE_MARKERS,
  PERMANENT_STREAM_ERROR_MESSAGE_PATTERNS,
  isPermanentStreamChunkError,
  abortReasonToText,
  isIdleTimeoutReasonText,
  isTimeoutReasonText,
  classifyAbortReason,
  LLMError,
  LLMRetryableError,
  LLMRateLimitError,
  LLMPermanentError,
  LLMAuthError,
  LLMNotFoundError,
  LLMBadRequestError,
  LLMAbortedError,
  createErrorFromStatus,
  isRetryableError,
  isPermanentError,
  isAbortedError,
  calculateBackoff,
  DEFAULT_BACKOFF_CONFIG,
} from './types';

export type { BackoffConfig } from './types';

// 类型定义
export type {
  ToolCall,
  Role,
  TextContentPart,
  ImageUrlContentPart,
  InputAudioContentPart,
  InputVideoContentPart,
  FileContentPart,
  InputContentPart,
  MessageContent,
  Usage,
  StreamOptions,
  BaseLLMMessage,
  LLMRequestMessage,
  FinishReason,
  LLMResponse,
  StreamChunkError,
  Chunk,
  StreamCallback,
  Tool,
  LLMGenerateOptions,
  LLMRequest,
  AnthropicStreamEvent,
} from './types';

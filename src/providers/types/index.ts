/**
 * Types 统一导出
 *
 * 统一导出所有类型定义，提供单一的导入入口
 */

// API 相关类型
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
  LLMResponseMessage,
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
} from './api';

// 配置相关类型
export type {
  BaseAPIConfig,
  BaseProviderConfig,
  OpenAICompatibleConfig,
  ProviderLogger,
} from './config';

// Provider 相关类型
export { LLMProvider } from './provider';

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
} from './errors';
export type { BackoffConfig } from './errors';

// Registry 相关类型
export type { ProviderType, BuiltinModelId, ModelId, ModelConfig } from './registry';

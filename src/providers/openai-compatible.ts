/**
 * 通用 OpenAI 兼容 Provider 基类
 *
 * 提供统一的请求/流处理逻辑，配合不同 Adapter 与元数据即可支持多家兼容服务。
 *
 * 超时控制说明：
 * - Provider 的 timeout 属性仅作为 Agent.requestTimeout 的默认回退值
 * - 实际超时信号通常由 Agent/LLMCaller 层创建，通过 options.abortSignal 传入
 * - standalone 调用未传 abortSignal 时，HTTPClient 使用 provider timeout 作为兜底
 *
 * @example
 * ```typescript
 * const provider = new OpenAICompatibleProvider({
 *     apiKey: 'sk-xxx',
 *     baseURL: 'https://api.example.com',
 *     model: 'gpt-4',
 *     temperature: 0.7,
 *     max_tokens: 4096,
 *     LLMMAX_TOKENS: 128000,
 *     chatCompletionsPath: '/v1/chat/completions',
 * });
 *
 * const stream = provider.generateStream(messages);
 * for await (const chunk of stream) {
 *   // consume chunk
 * }
 * ```
 */

import { BaseAPIAdapter } from './adapters/base';
import { StandardAdapter } from './adapters/standard';
import { HTTPClient } from './http/client';
import { StreamParser } from './http/stream-parser';
import {
  LLMBadRequestError,
  LLMError,
  LLMPermanentError,
  LLMRetryableError,
  isPermanentStreamChunkError,
} from './types';
import {
  LLMProvider,
  OpenAICompatibleConfig,
  Chunk,
  LLMGenerateOptions,
  LLMRequestMessage,
  LLMResponse,
} from './types';

/** Provider 默认超时时间（毫秒），作为 Agent.requestTimeout 的回退值 */
const PROVIDER_DEFAULT_TIMEOUT = 1000 * 60 * 10; // 10分钟

/**
 * OpenAI 兼容 Provider 基类
 *
 * 支持所有兼容 OpenAI API 格式的服务，包括：
 * - OpenAI 官方 API
 * - Azure OpenAI
 * - 各种兼容第三方服务（如 DeepSeek、Qwen、通义千问等）
 */
export class OpenAICompatibleProvider extends LLMProvider {
  declare config: OpenAICompatibleConfig;
  readonly httpClient: HTTPClient;
  readonly adapter: BaseAPIAdapter;

  /**
   * 默认请求超时（毫秒）
   * 作为 Agent.requestTimeout 的回退值，实际超时由 Agent 层控制
   */
  private readonly defaultTimeout: number;

  constructor(config: OpenAICompatibleConfig, adapter?: BaseAPIAdapter) {
    super(config);

    // 规范化 baseURL（移除末尾斜杠）
    const normalizedBaseURL = config.baseURL.replace(/\/$/, '');
    this.config = { ...config, baseURL: normalizedBaseURL };

    // 保存默认超时（供 Agent 回退使用）
    this.defaultTimeout = config.timeout ?? PROVIDER_DEFAULT_TIMEOUT;

    // 初始化 HTTP 客户端（standalone 调用时使用 provider timeout 兜底）
    this.httpClient = new HTTPClient({
      debug: config.debug ?? false,
      defaultTimeoutMs: this.defaultTimeout,
    });

    // 初始化 Adapter（未提供则使用标准适配器）
    this.adapter =
      adapter ??
      new StandardAdapter({
        defaultModel: config.model,
        endpointPath: config.chatCompletionsPath ?? '/chat/completions',
      });
  }

  /**
   * 生成非流式 LLM 响应
   *
   * @param messages - 对话消息列表
   * @param options - 可选参数（模型、温度等）
   * @returns LLM 响应
   */
  async generate(
    messages: LLMRequestMessage[],
    options?: LLMGenerateOptions
  ): Promise<LLMResponse> {
    this.ensureMessages(messages);
    if (options?.stream === true) {
      throw new LLMBadRequestError(
        'stream=true is not supported in generate(); use generateStream() instead'
      );
    }

    const requestParams = this.buildRequestParams(messages, options, false);
    return this._generateNonStream(requestParams);
  }

  /**
   * 生成流式 LLM 响应
   *
   * @param messages - 对话消息列表
   * @param options - 可选参数（模型、温度等）
   * @returns 流式响应生成器
   */
  async *generateStream(
    messages: LLMRequestMessage[],
    options?: LLMGenerateOptions
  ): AsyncGenerator<Chunk> {
    this.ensureMessages(messages);
    if (options?.stream === false) {
      throw new LLMBadRequestError(
        'stream=false is not supported in generateStream(); use generate() instead'
      );
    }

    const requestParams = this.buildRequestParams(messages, options, true);
    yield* this._generateStream(requestParams);
  }

  private ensureMessages(messages: LLMRequestMessage[]): void {
    if (messages.length === 0) {
      throw new LLMBadRequestError('messages must not be empty', {
        messages: 'at least one message is required',
      });
    }
  }

  private buildRequestParams(
    messages: LLMRequestMessage[],
    options: LLMGenerateOptions | undefined,
    streamMode: boolean
  ): {
    url: string;
    body: Record<string, unknown>;
    headers: Headers;
    abortSignal?: AbortSignal;
  } {
    const resolvedOptions = this.resolveGenerateOptions({
      ...(options ?? {}),
      stream: streamMode,
    });
    const {
      abortSignal,
      model,
      max_tokens,
      temperature,
      stream,
      tool_stream,
      stream_options,
      tools,
      thinking,
      ...extraOptions
    } = resolvedOptions;

    const requestBody = this.adapter.transformRequest({
      ...extraOptions,
      model: model ?? this.config.model,
      max_tokens: max_tokens ?? this.config.max_tokens,
      temperature: temperature ?? this.config.temperature,
      messages,
      stream,
      tool_stream: tool_stream ?? this.config.tool_stream,
      stream_options,
      tools,
      thinking: thinking ?? this.config.thinking,
    });

    return {
      url: this._resolveEndpoint(),
      body: requestBody,
      headers: this.adapter.getHeaders(this.config.apiKey),
      abortSignal,
    };
  }

  /**
   * 统一处理生成选项，补齐流式 usage 配置
   */
  private resolveGenerateOptions(options?: LLMGenerateOptions): LLMGenerateOptions {
    if (!options) return {};

    const resolved: LLMGenerateOptions = { ...options };

    if (resolved.stream && this.shouldIncludeStreamUsage(resolved)) {
      resolved.stream_options = {
        ...(resolved.stream_options || {}),
        include_usage: true,
      };
    }

    return resolved;
  }

  private shouldIncludeStreamUsage(options: LLMGenerateOptions): boolean {
    if (!options.stream) return false;
    if (options.stream_options?.include_usage === false) return false;
    return this.config.enableStreamUsage !== false;
  }

  /**
   * 解析完整的端点 URL
   */
  private _resolveEndpoint(): string {
    return `${this.config.baseURL}${this.adapter.getEndpointPath()}`;
  }

  /**
   * 处理非流式请求
   */
  private async _generateNonStream(params: {
    url: string;
    body: Record<string, unknown>;
    headers: Headers;
    abortSignal?: AbortSignal;
  }): Promise<LLMResponse> {
    const response = await this.httpClient.fetch(params.url, {
      method: 'POST',
      headers: params.headers,
      body: JSON.stringify(params.body),
      signal: params.abortSignal,
    });

    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      throw new LLMError(
        `Failed to parse response as JSON: ${error instanceof Error ? error.message : String(error)}`,
        'INVALID_JSON'
      );
    }

    return this.adapter.transformResponse(data);
  }

  /**
   * 处理流式请求
   *
   * 直接返回 AsyncGenerator<Chunk>，由调用者消费流式数据。
   */
  private async *_generateStream(params: {
    url: string;
    body: Record<string, unknown>;
    headers: Headers;
    abortSignal?: AbortSignal;
  }): AsyncGenerator<Chunk> {
    const response = await this.httpClient.fetch(params.url, {
      method: 'POST',
      headers: params.headers,
      body: JSON.stringify(params.body),
      signal: params.abortSignal,
    });

    if (!response.body) {
      throw new LLMError('Response body is not readable', 'NO_BODY');
    }

    const streamIterator = this.adapter.parseStreamAsync
      ? this.adapter.parseStreamAsync(response.body.getReader())
      : StreamParser.parseAsync(response.body.getReader());

    for await (const chunk of streamIterator) {
      const chunkError = this.extractStreamChunkError(chunk);
      if (chunkError) {
        throw this.createStreamChunkError(chunkError, chunk.id);
      }
      yield chunk;
    }
  }

  private extractStreamChunkError(chunk: Chunk): NonNullable<Chunk['error']> | null {
    if (!chunk.error || typeof chunk.error !== 'object') {
      return null;
    }
    return chunk.error;
  }

  private createStreamChunkError(chunkError: NonNullable<Chunk['error']>, chunkId?: string): Error {
    const rawMessage =
      typeof chunkError.message === 'string' && chunkError.message.trim().length > 0
        ? chunkError.message.trim()
        : 'LLM stream returned an error chunk';

    const message = chunkId ? `${rawMessage} (chunk: ${chunkId})` : rawMessage;

    const rawCode =
      typeof chunkError.code === 'string' && chunkError.code
        ? chunkError.code
        : typeof chunkError.type === 'string' && chunkError.type
          ? chunkError.type
          : 'STREAM_CHUNK_ERROR';

    if (isPermanentStreamChunkError(rawCode, message)) {
      return new LLMPermanentError(message, undefined, rawCode);
    }
    return new LLMRetryableError(message, undefined, rawCode);
  }

  /**
   * 获取默认请求超时时间
   *
   * 作为 Agent.requestTimeout 的回退值
   */
  getTimeTimeout(): number {
    return this.defaultTimeout;
  }

  getLLMMaxTokens(): number {
    return this.config.LLMMAX_TOKENS;
  }

  getMaxOutputTokens(): number {
    return this.config.max_tokens;
  }
}

// 重新导出配置类型
export type { OpenAICompatibleConfig } from './types';

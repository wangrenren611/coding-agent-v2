/**
 * HTTP 客户端工具
 *
 * 提供统一的 HTTP 客户端，具有以下功能：
 * - 单次请求执行（不包含重试）
 * - Abort 信号支持（优先使用上层传入 signal）
 * - 可选默认超时兜底（调用方未传 signal 时生效）
 * - 与 LLM 错误类型集成的错误处理
 *
 * 超时控制设计：
 * - Agent 层通过 LLMCaller 创建 AbortSignal.timeout() 控制主链路超时
 * - 当调用方未传 signal 且配置了 defaultTimeoutMs，本层会创建兜底超时信号
 * - 这样兼顾统一控制与 standalone 调用安全性
 */

import { LLMError, LLMAbortedError, LLMRetryableError, createErrorFromStatus } from '../types';
import { classifyAbortReason } from '../types';

export interface HttpClientOptions {
  /** 启用调试日志 */
  debug?: boolean;
  /** 默认超时（毫秒，仅在调用方未传 signal 时生效） */
  defaultTimeoutMs?: number;
}

export type RequestInitWithOptions = RequestInit;

/**
 * HTTP 客户端
 *
 * 超时优先由调用方通过 options.signal 传入；
 * 如未传入且配置了 defaultTimeoutMs，会自动应用默认超时信号。
 */
export class HTTPClient {
  readonly debug: boolean;
  readonly defaultTimeoutMs?: number;

  constructor(options: HttpClientOptions = {}) {
    this.debug = options.debug ?? false;
    this.defaultTimeoutMs = this.normalizeTimeoutMs(options.defaultTimeoutMs);
  }

  /**
   * 单次 Fetch（重试由上层 Agent 负责）
   *
   * @param url - 请求 URL
   * @param options - 请求选项，signal 应已包含超时逻辑
   */
  async fetch(url: string, options: RequestInitWithOptions = {}): Promise<Response> {
    const requestOptions = this.applyDefaultSignal(options);
    try {
      const response = await this.executeFetch(url, requestOptions);

      // 检查 HTTP 错误
      if (!response.ok) {
        const errorText = await response.text();
        // 提取 Retry-After 响应头（用于 429 等错误）
        const retryAfterMs = this.extractRetryAfterMs(response);
        throw createErrorFromStatus(response.status, response.statusText, errorText, retryAfterMs);
      }

      return response;
    } catch (rawError) {
      throw this.normalizeError(rawError, requestOptions.signal ?? undefined);
    }
  }

  /**
   * 执行 Fetch 请求
   *
   * 直接使用传入的 signal，不创建额外的超时信号
   */
  private async executeFetch(url: string, options: RequestInit): Promise<Response> {
    const upstreamSignal = options.signal;

    try {
      if (this.debug) {
        console.log(`[HTTPClient] Sending request: ${options.method || 'GET'} ${url}`);
      }

      const response = await fetch(url, {
        ...options,
        signal: upstreamSignal,
      });

      if (this.debug) {
        console.log(`[HTTPClient] Response received: ${options.method || 'GET'} ${url}`);
      }

      return response;
    } catch (error) {
      if (this.debug) {
        console.log(`[HTTPClient] Request failed: ${options.method || 'GET'} ${url}`);
      }

      // 检查是否为超时或中止错误
      if (upstreamSignal?.aborted) {
        const reason = this.getAbortReason(upstreamSignal);
        if (reason === 'timeout') {
          throw new LLMRetryableError('Request timeout', undefined, 'TIMEOUT');
        }
        throw new LLMAbortedError('Request was cancelled by upstream signal');
      }

      throw error;
    }
  }

  /**
   * 获取 AbortSignal 的中止原因
   */
  private getAbortReason(signal: AbortSignal): 'timeout' | 'abort' | 'unknown' {
    try {
      const reason = classifyAbortReason(signal.reason);
      if (reason === 'idle_timeout' || reason === 'timeout') {
        return 'timeout';
      }
      if (reason === 'abort') {
        return 'abort';
      }
    } catch {
      // 忽略访问 reason 的错误
    }
    return 'unknown';
  }

  /**
   * 从响应头中提取 Retry-After 值（毫秒）
   *
   * Retry-After 可以是秒数或日期字符串
   * @see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After
   */
  private extractRetryAfterMs(response: Response): number | undefined {
    const retryAfterMsHeader = response.headers.get('retry-after-ms');
    if (retryAfterMsHeader) {
      const ms = Number(retryAfterMsHeader);
      if (Number.isFinite(ms) && ms > 0) {
        return ms;
      }
    }

    const retryAfter = response.headers.get('Retry-After');
    if (!retryAfter) {
      return undefined;
    }

    // 尝试解析为秒数（支持小数，避免精度损失）
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) {
      return Math.ceil(seconds * 1000);
    }

    // 尝试解析为日期字符串
    const dateMs = Date.parse(retryAfter);
    if (Number.isFinite(dateMs)) {
      const diffMs = dateMs - Date.now();
      if (diffMs > 0) {
        return Math.ceil(diffMs);
      }
    }

    return undefined;
  }

  /**
   * 归一化错误
   */
  private normalizeError(error: unknown, signal?: AbortSignal): Error {
    // 已经是 LLM 错误，直接返回
    if (error instanceof LLMError) {
      return error;
    }

    // 检查中止信号
    if (signal?.aborted) {
      const reason = this.getAbortReason(signal);
      if (reason === 'timeout') {
        return new LLMRetryableError('Request timeout', undefined, 'TIMEOUT');
      }
      return new LLMAbortedError('Request was cancelled');
    }

    // Body 超时类错误
    if (this.isBodyTimeoutLikeError(error)) {
      return new LLMRetryableError('Response body timeout', undefined, 'BODY_TIMEOUT');
    }

    // 网络类错误
    if (this.isNetworkLikeError(error)) {
      const message = error instanceof Error ? error.message : String(error);
      return new LLMRetryableError(
        `Network request failed: ${message}`,
        undefined,
        'NETWORK_ERROR'
      );
    }

    if (error instanceof Error) {
      return error;
    }

    return new LLMError(String(error));
  }

  private isBodyTimeoutLikeError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    const code = this.getErrorCode(error);
    const message = `${error.name} ${error.message}`.toLowerCase();

    return (
      code === 'UND_ERR_BODY_TIMEOUT' ||
      message.includes('body timeout') ||
      message.includes('terminated')
    );
  }

  private isNetworkLikeError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;

    const code = this.getErrorCode(error);
    if (!code) {
      // Node fetch/undici 常见网络失败会以 TypeError 抛出
      return error instanceof TypeError;
    }

    return [
      'ECONNRESET',
      'ECONNREFUSED',
      'ENOTFOUND',
      'EAI_AGAIN',
      'ETIMEDOUT',
      'UND_ERR_SOCKET',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_ABORTED',
    ].includes(code);
  }

  private getErrorCode(error: Error): string | undefined {
    const withCode = error as Error & { code?: unknown; cause?: unknown };
    if (typeof withCode.code === 'string') {
      return withCode.code;
    }
    const cause = withCode.cause as { code?: unknown } | undefined;
    if (cause && typeof cause.code === 'string') {
      return cause.code;
    }
    return undefined;
  }

  private applyDefaultSignal(options: RequestInitWithOptions): RequestInitWithOptions {
    if (options.signal || !this.defaultTimeoutMs) {
      return options;
    }
    return {
      ...options,
      signal: AbortSignal.timeout(this.defaultTimeoutMs),
    };
  }

  private normalizeTimeoutMs(value: number | undefined): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return undefined;
    }
    return value;
  }
}

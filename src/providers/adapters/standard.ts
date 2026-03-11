/**
 * 标准 OpenAI 兼容适配器
 *
 * 为常见的 OpenAI 兼容操作提供基础实现。
 * 特定适配器可以根据需要覆盖方法。
 */

import type { LLMRequest, LLMResponse } from '../types';
import { BaseAPIAdapter } from './base';

export interface StandardTransformOptions extends LLMRequest {
  /** 如果未指定，则使用的默认模型 */
  defaultModel?: string;
}

/**
 * OpenAI 兼容 API 的标准适配器
 *
 * 处理常见的请求/响应转换逻辑。
 * 子类可以覆盖特定方法以实现自定义行为。
 */
export class StandardAdapter extends BaseAPIAdapter {
  readonly endpointPath: string;
  readonly defaultModel: string;

  constructor(options: { endpointPath?: string; defaultModel?: string } = {}) {
    super();
    this.endpointPath = options.endpointPath ?? '/chat/completions';
    this.defaultModel = options.defaultModel ?? 'gpt-4o';
  }

  /**
   * 转换请求 - 基础实现
   */
  transformRequest(options?: LLMRequest): Record<string, unknown> {
    const {
      model,
      max_tokens,
      messages,
      temperature,
      stream,
      tool_stream,
      tools,
      thinking,
      abortSignal,
      ...rest
    } = options || ({} as LLMRequest & { abortSignal?: AbortSignal; thinking?: unknown });
    void thinking;
    void abortSignal;

    const extras = Object.fromEntries(
      Object.entries(rest).filter(([, value]) => value !== undefined)
    );

    const body: LLMRequest = {
      ...extras,
      model: model || this.defaultModel,
      messages: this.cleanMessage(messages || []),
      max_tokens: max_tokens,
      temperature: temperature,
      stream: stream ?? false,
    };
    
    if (tool_stream !== undefined) {
      body.tool_stream = tool_stream;
    }

    // 如果提供了工具，则添加
    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    // 允许子类添加自定义转换
    return this.enrichRequestBody(body, options);
  }

  /**
   * 子类的钩子方法，用于向请求体添加自定义字段
   * 覆盖此方法以添加特定于提供商的字段。
   */
  protected enrichRequestBody(
    body: LLMRequest,
    _options?: StandardTransformOptions
  ): Record<string, unknown> {
    return body;
  }

  /**
   * 转换响应 - 基础实现
   */
  transformResponse(response: Record<string, unknown>): LLMResponse {
    const data = response as LLMResponse;

    if (!data.choices || data.choices.length === 0) {
      // 提供更详细的错误信息，帮助调试
      const responseStr = JSON.stringify(response, null, 2);
      throw new Error(`Empty choices in response. Response: ${responseStr}`);
    }

    return data;
  }

  /**
   * 获取标准 HTTP 头
   */
  getHeaders(apiKey: string): Headers {
    return new Headers({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    });
  }

  /**
   * 获取端点路径
   */
  getEndpointPath(): string {
    return this.endpointPath;
  }
}

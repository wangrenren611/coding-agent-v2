/**
 * LLM Provider 接口
 * 参考: ENTERPRISE_REALTIME.md
 */

import { Message, LLMConfig, LLMResponse, Chunk } from './types';

export interface LLMProvider {
  /**
   * 生成响应 (非流式)
   */
  generate(messages: Message[], config?: LLMConfig): Promise<LLMResponse>;

  /**
   * 生成响应 (流式)
   */
  generateStream(messages: Message[], config?: LLMConfig): AsyncGenerator<Chunk, void, unknown>;
}

/**
 * OpenAI Provider 实现
 * TODO: 实现具体的 OpenAI API 调用
 */
export class OpenAIProvider implements LLMProvider {
  constructor(
    private apiKey: string,
    private baseUrl?: string
  ) {
    // TODO: 初始化 HTTP 客户端
  }

  async generate(messages: Message[], config?: LLMConfig): Promise<LLMResponse> {
    // TODO: 调用 OpenAI Chat API
    // 1. 构建请求
    // 2. 发送 HTTP 请求
    // 3. 解析响应
    // 4. 返回 LLMResponse
    throw new Error('Not implemented');
  }

  async *generateStream(
    messages: Message[],
    config?: LLMConfig
  ): AsyncGenerator<Chunk, void, unknown> {
    // TODO: 实现流式调用
    // 1. 构建请求 (stream: true)
    // 2. 发送 HTTP 请求
    // 3. 解析 SSE 流
    // 4. yield 每个 Chunk
    throw new Error('Not implemented');
  }
}

/**
 * Anthropic Provider 实现
 * TODO: 实现 Anthropic Claude API 调用
 */
export class AnthropicProvider implements LLMProvider {
  constructor(private apiKey: string) {
    // TODO: 初始化
  }

  async generate(messages: Message[], config?: LLMConfig): Promise<LLMResponse> {
    throw new Error('Not implemented');
  }

  async *generateStream(
    messages: Message[],
    config?: LLMConfig
  ): AsyncGenerator<Chunk, void, unknown> {
    throw new Error('Not implemented');
  }
}

/**
 * 创建 LLM Provider 工厂函数
 */
export function createLLMProvider(
  provider: 'openai' | 'anthropic' | 'custom',
  config: { apiKey: string; baseUrl?: string }
): LLMProvider {
  switch (provider) {
    case 'openai':
      return new OpenAIProvider(config.apiKey, config.baseUrl);
    case 'anthropic':
      return new AnthropicProvider(config.apiKey);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

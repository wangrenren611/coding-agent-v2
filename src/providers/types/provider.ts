/**
 * Provider 接口类型定义
 *
 * Provider 相关的接口和类型定义
 */

import { BaseProviderConfig } from './config';
import { Chunk, LLMGenerateOptions, LLMRequestMessage, LLMResponse } from './api';

/**
 * Provider 抽象基类
 */
export abstract class LLMProvider {
  config: BaseProviderConfig;

  protected constructor(config: BaseProviderConfig) {
    this.config = config;
  }

  /**
   * 从提供商生成非流式响应
   * @param messages 对话消息列表
   * @param options 可选参数
   * @returns LLM 响应
   */
  abstract generate(
    messages: LLMRequestMessage[],
    options?: LLMGenerateOptions
  ): Promise<LLMResponse>;

  /**
   * 从提供商生成流式响应
   * @param messages 对话消息列表
   * @param options 可选参数
   * @returns 流式 chunk 生成器
   */
  abstract generateStream(
    messages: LLMRequestMessage[],
    options?: LLMGenerateOptions
  ): AsyncGenerator<Chunk>;

  abstract getTimeTimeout(): number;
  abstract getLLMMaxTokens(): number;
  abstract getMaxOutputTokens(): number;
}

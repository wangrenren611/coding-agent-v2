/**
 * Provider 工厂
 *
 * 负责创建 Provider 实例，将创建逻辑从 Registry 中分离
 */

import { StandardAdapter } from '../adapters/standard';
import { AnthropicAdapter } from '../adapters/anthropic';
import { OpenAICompatibleProvider, OpenAICompatibleConfig } from '../openai-compatible';
import type { BaseProviderConfig, ModelId } from '../types';
import type { BaseAPIAdapter } from '../adapters/base';
import { MODEL_DEFINITIONS } from './model-config';
import { KimiAdapter } from '../adapters/kimi';
import { ResponsesAdapter } from '../adapters/responses';

/**
 * Provider 工厂类
 */
export class ProviderFactory {
  /**
   * 从环境变量创建 Provider
   *
   * @param modelId 模型唯一标识
   * @param overrides 可选的配置覆盖
   * @returns OpenAI Compatible Provider 实例
   */
  static createFromEnv(
    modelId: ModelId,
    overrides?: Partial<OpenAICompatibleConfig>
  ): OpenAICompatibleProvider {
    if (!modelId) {
      throw new Error('ModelId is required.');
    }

    const modelConfig = MODEL_DEFINITIONS[modelId];
    if (!modelConfig) {
      throw new Error(`Unknown model: ${modelId}`);
    }

    const apiKey = process.env[modelConfig.envApiKey] || '';
    const baseURL = process.env[modelConfig.envBaseURL] || modelConfig.baseURL;

    // Config overrides take precedence over env vars / model defaults
    const finalConfig: OpenAICompatibleConfig = {
      apiKey: overrides?.apiKey ?? apiKey,
      baseURL: overrides?.baseURL ?? baseURL,
      model: overrides?.model ?? modelConfig.model,
      temperature: overrides?.temperature ?? modelConfig.temperature ?? 0.1,
      max_tokens: overrides?.max_tokens ?? modelConfig.max_tokens,
      LLMMAX_TOKENS: overrides?.LLMMAX_TOKENS ?? modelConfig.LLMMAX_TOKENS,
      timeout: overrides?.timeout,
      maxRetries: overrides?.maxRetries,
      logger: overrides?.logger,
      organization: overrides?.organization,
      chatCompletionsPath: overrides?.chatCompletionsPath ?? modelConfig.endpointPath,
      enableStreamUsage: overrides?.enableStreamUsage,
      tool_stream: overrides?.tool_stream ?? modelConfig.tool_stream,
      thinking: overrides?.thinking ?? modelConfig.thinking,
      model_reasoning_effort:
        overrides?.model_reasoning_effort ?? modelConfig.model_reasoning_effort,
    };

    const adapter = ProviderFactory.createAdapter(modelId, finalConfig.logger);

    return new OpenAICompatibleProvider(finalConfig, adapter);
  }

  /**
   * 创建指定类型的 Provider
   *
   * @param modelId 模型唯一标识
   * @param config Provider 配置
   * @returns OpenAI Compatible Provider 实例
   */
  static create(modelId: ModelId, config: BaseProviderConfig): OpenAICompatibleProvider {
    const modelConfig = MODEL_DEFINITIONS[modelId];
    if (!modelConfig) {
      throw new Error(`Unknown model: ${modelId}`);
    }

    const adapter = ProviderFactory.createAdapter(modelId, config.logger);
    return new OpenAICompatibleProvider(config as OpenAICompatibleConfig, adapter);
  }

  /**
   * 创建适配器
   *
   * @param modelId 模型唯一标识
   * @returns API 适配器实例
   */
  static createAdapter(
    modelId: ModelId,
    logger?: OpenAICompatibleConfig['logger']
  ): BaseAPIAdapter {
    const modelConfig = MODEL_DEFINITIONS[modelId];
    if (modelConfig.provider === 'anthropic') {
      return new AnthropicAdapter({
        defaultModel: modelConfig.model,
        endpointPath: modelConfig.endpointPath || '/v1/messages',
        logger,
      });
    }

    if (modelConfig.provider === 'kimi') {
      return new KimiAdapter({
        defaultModel: modelConfig.model,
        endpointPath: modelConfig.endpointPath || '/chat/completions',
      });
    }

    if (modelConfig.endpointPath === '/responses') {
      return new ResponsesAdapter({
        defaultModel: modelConfig.model,
        endpointPath: modelConfig.endpointPath,
      });
    }

    return new StandardAdapter({
      defaultModel: modelConfig.model,
      endpointPath: modelConfig.endpointPath || '/chat/completions',
    });
  }
}

/**
 * Provider Registry
 *
 * 模型级别的 Provider 工厂和注册表
 * 支持从环境变量创建 Provider，以具体模型为单位
 */

import { ProviderFactory } from './registry/provider-factory';
import { MODEL_DEFINITIONS } from './registry/model-config';
import type { ModelConfig, ModelId, ProviderType } from './types';

// 导出类型
export type { ProviderType, ModelId, ModelConfig } from './types';

// 导出模型配置
export { MODEL_DEFINITIONS as MODEL_CONFIGS } from './registry/model-config';

/**
 * Provider Registry 类
 *
 * 简化为只负责查询和委托创建
 */
export class ProviderRegistry {
  /**
   * 从环境变量创建 Provider（以模型为单位）
   *
   * @param modelId 模型唯一标识，如 'glm-4.7', 'minimax-2.1'
   * @param config 可选的配置覆盖
   *
   * @example
   * ```ts
   * // 创建 GLM-4.7 实例
   * const provider = ProviderRegistry.createFromEnv('glm-4.7');
   *
   * // 创建 MiniMax-2.1 实例，并覆盖温度
   * const provider = ProviderRegistry.createFromEnv('minimax-2.1', { temperature: 0.5 });
   * ```
   */
  static createFromEnv = ProviderFactory.createFromEnv;

  /**
   * 创建指定类型的 Provider
   */
  static create = ProviderFactory.create;

  /**
   * 获取所有模型配置
   */
  static listModels(): ModelConfig[] {
    return Object.values(MODEL_DEFINITIONS).map((config) => ({
      ...config,
      apiKey: undefined,
    }));
  }

  /**
   * 获取指定厂商的所有模型
   */
  static listModelsByProvider(provider: ProviderType): ModelConfig[] {
    return Object.values(MODEL_DEFINITIONS)
      .filter((m) => m.provider === provider)
      .map((config) => ({
        ...config,
        apiKey: undefined,
      }));
  }

  /**
   * 获取所有模型 ID
   */
  static getModelIds(): ModelId[] {
    return Object.keys(MODEL_DEFINITIONS) as ModelId[];
  }

  /**
   * 获取指定模型的配置
   */
  static getModelConfig(modelId: ModelId): ModelConfig {
    const config = MODEL_DEFINITIONS[modelId];
    if (!config) {
      throw new Error(`Unknown model: ${modelId}`);
    }
    return { ...config, apiKey: undefined };
  }

  /**
   * 获取模型显示名称
   */
  static getModelName(modelId: ModelId): string {
    return MODEL_DEFINITIONS[modelId]?.name || modelId;
  }

  /**
   * 获取所有支持的厂商类型
   */
  static getProviders(): ProviderType[] {
    const providers = new Set<ProviderType>();
    Object.values(MODEL_DEFINITIONS).forEach((m) => providers.add(m.provider));
    return Array.from(providers);
  }
}

// =============================================================================
// 便捷的模型访问器
// =============================================================================

export const Models = {
  // GLM
  get glm47(): ModelConfig {
    return { ...MODEL_DEFINITIONS['glm-4.7'], apiKey: undefined };
  },
  get glm5(): ModelConfig {
    return { ...MODEL_DEFINITIONS['glm-5'], apiKey: undefined };
  },

  // MiniMax
  get minimax25(): ModelConfig {
    return { ...MODEL_DEFINITIONS['minimax-2.5'], apiKey: undefined };
  },

  // Kimi
  get kimiK25(): ModelConfig {
    return { ...MODEL_DEFINITIONS['kimi-k2.5'], apiKey: undefined };
  },

  // DeepSeek
  get deepseekChat(): ModelConfig {
    return { ...MODEL_DEFINITIONS['deepseek-chat'], apiKey: undefined };
  },

  // Qwen
  get qwen35Plus(): ModelConfig {
    return { ...MODEL_DEFINITIONS['qwen3.5-plus'], apiKey: undefined };
  },
};

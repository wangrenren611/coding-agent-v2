/**
 * Central model configuration storage.
 */

import type { ModelConfig, ModelId, BuiltinModelId, ProviderType } from '../types';

const CUSTOM_MODELS_ENV_VAR = 'RENX_CUSTOM_MODELS_JSON';

export type ModelDefinition = Omit<ModelConfig, 'apiKey'>;
type PartialModelDefinition = Partial<ModelDefinition>;

const VALID_PROVIDERS: ProviderType[] = [
  'anthropic',
  'kimi',
  'deepseek',
  'glm',
  'minimax',
  'openai',
  'openrouter',
  'qwen',
];

/**
 * Built-in model definitions.
 */
export const MODEL_DEFINITIONS: Record<BuiltinModelId, ModelDefinition> = {
  'claude-opus-4.6': {
    id: 'claude-opus-4.6',
    provider: 'anthropic',
    name: 'Claude Opus 4.6',
    baseURL: 'https://api.anthropic.com',
    endpointPath: '/v1/messages',
    envApiKey: 'ANTHROPIC_API_KEY',
    envBaseURL: 'ANTHROPIC_API_BASE',
    model: 'claude-opus-4-6',
    max_tokens: 16384,
    LLMMAX_TOKENS: 1000 * 1000,
    features: ['streaming', 'function-calling', 'vision'],
    modalities: { image: true },
  },
  'glm-4.7': {
    id: 'glm-4.7',
    provider: 'glm',
    name: 'GLM-4.7',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    endpointPath: '/chat/completions',
    envApiKey: 'GLM_API_KEY',
    envBaseURL: 'GLM_API_BASE',
    model: 'GLM-4.7',
    max_tokens: 8000,
    LLMMAX_TOKENS: 200 * 1000,
    features: ['streaming', 'function-calling', 'vision'],
    modalities: { image: true },
  },
  'glm-5': {
    id: 'glm-5',
    provider: 'glm',
    name: 'GLM-5',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    endpointPath: '/chat/completions',
    envApiKey: 'GLM_API_KEY',
    envBaseURL: 'GLM_API_BASE',
    model: 'glm-5',
    max_tokens: 30000,
    LLMMAX_TOKENS: 200 * 1000,
    features: ['streaming', 'function-calling', 'vision'],
    modalities: { image: true },
  },
  'minimax-2.5': {
    id: 'minimax-2.5',
    provider: 'minimax',
    name: 'MiniMax-2.5',
    baseURL: 'https://api.minimaxi.com/v1',
    endpointPath: '/chat/completions',
    envApiKey: 'MINIMAX_API_KEY',
    envBaseURL: 'MINIMAX_API_URL',
    model: 'MiniMax-M2.5',
    max_tokens: 8000,
    LLMMAX_TOKENS: 200 * 1000,
    features: ['streaming', 'function-calling'],
  },
  'kimi-k2.5': {
    id: 'kimi-k2.5',
    provider: 'kimi',
    name: 'Kimi K2.5',
    baseURL: 'https://api.kimi.com/coding/v1',
    endpointPath: '/chat/completions',
    envApiKey: 'KIMI_API_KEY',
    envBaseURL: 'KIMI_API_BASE',
    model: 'kimi-for-coding',
    max_tokens: 10000,
    LLMMAX_TOKENS: 200 * 1000,
    features: ['streaming', 'function-calling', 'reasoning'],
    temperature: 0.6,
    thinking: false,
  },
  'deepseek-reasoner': {
    id: 'deepseek-reasoner',
    provider: 'deepseek',
    name: 'DeepSeek Reasoner',
    baseURL: 'https://api.deepseek.com/v1',
    endpointPath: '/chat/completions',
    envApiKey: 'DEEPSEEK_API_KEY',
    envBaseURL: 'DEEPSEEK_API_BASE',
    model: 'deepseek-reasoner',
    max_tokens: 8000,
    LLMMAX_TOKENS: 128 * 1000,
    features: ['streaming', 'function-calling'],
  },
  'qwen3.5-plus': {
    id: 'qwen3.5-plus',
    provider: 'qwen',
    name: 'Qwen 3.5 Plus',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    endpointPath: '/chat/completions',
    envApiKey: 'QWEN_API_KEY',
    envBaseURL: 'QWEN_API_BASE',
    model: 'qwen3.5-plus',
    max_tokens: 10000,
    LLMMAX_TOKENS: 200 * 1000,
    features: ['streaming', 'function-calling'],
    modalities: { image: true },
  },
  'qwen3.5-max': {
    id: 'qwen3.5-max',
    provider: 'qwen',
    name: 'Qwen 3.5 Max',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    endpointPath: '/chat/completions',
    envApiKey: 'QWEN_API_KEY',
    envBaseURL: 'QWEN_API_BASE',
    model: 'qwen3-max',
    max_tokens: 1000 * 32,
    LLMMAX_TOKENS: 1024 * 1000,
    features: ['streaming', 'function-calling'],
  },
  'qwen-kimi-k2.5': {
    id: 'qwen-kimi-k2.5',
    provider: 'qwen',
    name: 'qwen kimi k2.5',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    endpointPath: '/chat/completions',
    envApiKey: 'QWEN_API_KEY',
    envBaseURL: 'QWEN_API_BASE',
    model: 'kimi-k2.5',
    max_tokens: 1000 * 32,
    LLMMAX_TOKENS: 200 * 1000,
    features: ['streaming', 'function-calling'],
  },
  'qwen-glm-5': {
    id: 'qwen-glm-5',
    provider: 'qwen',
    name: 'Qwen GLM 5',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    endpointPath: '/chat/completions',
    envApiKey: 'QWEN_API_KEY',
    envBaseURL: 'QWEN_API_BASE',
    model: 'glm-5',
    max_tokens: 1000 * 32,
    LLMMAX_TOKENS: 200 * 1000,
    features: ['streaming', 'function-calling'],
  },
  'qwen-minimax-2.5': {
    id: 'qwen-minimax-2.5',
    provider: 'qwen',
    name: 'Qwen MiniMax 2.5',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    endpointPath: '/chat/completions',
    envApiKey: 'QWEN_API_KEY',
    envBaseURL: 'QWEN_API_BASE',
    model: 'MiniMax-M2.5',
    max_tokens: 1000 * 32,
    LLMMAX_TOKENS: 200 * 1000,
    features: ['streaming', 'function-calling'],
  },
  'gpt-5.3': {
    id: 'gpt-5.3',
    provider: 'openai',
    name: 'GPT-5.3',
    baseURL: 'https://api.openai.com/v1',
    endpointPath: '/responses',
    envApiKey: 'OPENAI_API_KEY',
    envBaseURL: 'OPENAI_API_BASE',
    model: 'gpt-5.3-codex',
    max_tokens: 1000 * 32,
    LLMMAX_TOKENS: 258 * 1000,
    model_reasoning_effort: 'high',
    features: ['streaming', 'function-calling', 'reasoning'],
    modalities: { image: true },
  },
  'gpt-5.4': {
    id: 'gpt-5.4',
    provider: 'openai',
    name: 'GPT-5.4',
    baseURL: 'https://api.openai.com/v1',
    endpointPath: '/responses',
    envApiKey: 'OPENAI_API_KEY',
    envBaseURL: 'OPENAI_API_BASE',
    model: 'gpt-5.4',
    max_tokens: 1000 * 32,
    LLMMAX_TOKENS: 200 * 1000,
    model_reasoning_effort: 'high',
    features: ['streaming', 'function-calling'],
    modalities: { image: true },
  },
  'openrouter/hunter-alpha': {
    id: 'openrouter/hunter-alpha',
    provider: 'openrouter',
    name: 'OpenRouter Hunter Alpha',
    baseURL: 'https://openrouter.ai/api/v1',
    endpointPath: '/chat/completions',
    envApiKey: 'OPENROUTER_API_KEY',
    envBaseURL: 'OPENROUTER_API_BASE',
    model: 'openrouter/hunter-alpha',
    max_tokens: 1000 * 32,
    LLMMAX_TOKENS: 200 * 1000,
    model_reasoning_effort: 'high',
    features: ['streaming', 'function-calling'],
    modalities: { image: true },
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidProvider(value: unknown): value is ProviderType {
  return typeof value === 'string' && VALID_PROVIDERS.includes(value as ProviderType);
}

function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isValidReasoningEffort(
  value: unknown
): value is NonNullable<ModelDefinition['model_reasoning_effort']> {
  return value === 'low' || value === 'medium' || value === 'high';
}

function sanitizeModalities(value: unknown): ModelDefinition['modalities'] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isPlainObject(value)) {
    return undefined;
  }

  const result: NonNullable<ModelDefinition['modalities']> = {};

  if (typeof value.image === 'boolean') {
    result.image = value.image;
  }
  if (typeof value.audio === 'boolean') {
    result.audio = value.audio;
  }
  if (typeof value.video === 'boolean') {
    result.video = value.video;
  }

  return Object.keys(result).length > 0 ? result : {};
}

function sanitizePartialModelDefinition(
  modelId: string,
  value: unknown
): PartialModelDefinition | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const sanitized: PartialModelDefinition = { id: modelId as ModelId };

  if (value.provider !== undefined) {
    if (!isValidProvider(value.provider)) {
      return null;
    }
    sanitized.provider = value.provider;
  }

  if (value.name !== undefined) {
    if (typeof value.name !== 'string' || value.name.trim() === '') {
      return null;
    }
    sanitized.name = value.name;
  }

  if (value.endpointPath !== undefined) {
    if (typeof value.endpointPath !== 'string' || value.endpointPath.trim() === '') {
      return null;
    }
    sanitized.endpointPath = value.endpointPath;
  }

  if (value.envApiKey !== undefined) {
    if (typeof value.envApiKey !== 'string' || value.envApiKey.trim() === '') {
      return null;
    }
    sanitized.envApiKey = value.envApiKey;
  }

  if (value.envBaseURL !== undefined) {
    if (typeof value.envBaseURL !== 'string' || value.envBaseURL.trim() === '') {
      return null;
    }
    sanitized.envBaseURL = value.envBaseURL;
  }

  if (value.baseURL !== undefined) {
    if (typeof value.baseURL !== 'string' || value.baseURL.trim() === '') {
      return null;
    }
    sanitized.baseURL = value.baseURL;
  }

  if (value.model !== undefined) {
    if (typeof value.model !== 'string' || value.model.trim() === '') {
      return null;
    }
    sanitized.model = value.model;
  }

  if (value.max_tokens !== undefined) {
    if (!isValidNumber(value.max_tokens)) {
      return null;
    }
    sanitized.max_tokens = value.max_tokens;
  }

  if (value.LLMMAX_TOKENS !== undefined) {
    if (!isValidNumber(value.LLMMAX_TOKENS)) {
      return null;
    }
    sanitized.LLMMAX_TOKENS = value.LLMMAX_TOKENS;
  }

  if (value.features !== undefined) {
    if (
      !Array.isArray(value.features) ||
      value.features.some((feature) => typeof feature !== 'string')
    ) {
      return null;
    }
    sanitized.features = [...value.features];
  }

  if (value.modalities !== undefined) {
    const modalities = sanitizeModalities(value.modalities);
    if (modalities === undefined) {
      return null;
    }
    sanitized.modalities = modalities;
  }

  if (value.temperature !== undefined) {
    if (typeof value.temperature !== 'number' || !Number.isFinite(value.temperature)) {
      return null;
    }
    sanitized.temperature = value.temperature;
  }

  if (value.tool_stream !== undefined) {
    if (typeof value.tool_stream !== 'boolean') {
      return null;
    }
    sanitized.tool_stream = value.tool_stream;
  }

  if (value.thinking !== undefined) {
    if (typeof value.thinking !== 'boolean') {
      return null;
    }
    sanitized.thinking = value.thinking;
  }

  if (value.timeout !== undefined) {
    if (!isValidNumber(value.timeout)) {
      return null;
    }
    sanitized.timeout = value.timeout;
  }

  if (value.model_reasoning_effort !== undefined) {
    if (!isValidReasoningEffort(value.model_reasoning_effort)) {
      return null;
    }
    sanitized.model_reasoning_effort = value.model_reasoning_effort;
  }

  return sanitized;
}

function isCompleteModelDefinition(value: PartialModelDefinition): value is ModelDefinition {
  return (
    typeof value.id === 'string' &&
    isValidProvider(value.provider) &&
    typeof value.name === 'string' &&
    typeof value.endpointPath === 'string' &&
    typeof value.envApiKey === 'string' &&
    typeof value.envBaseURL === 'string' &&
    typeof value.baseURL === 'string' &&
    typeof value.model === 'string' &&
    isValidNumber(value.max_tokens) &&
    isValidNumber(value.LLMMAX_TOKENS) &&
    Array.isArray(value.features) &&
    value.features.every((feature) => typeof feature === 'string')
  );
}

function mergeModelDefinition(
  modelId: string,
  base: PartialModelDefinition,
  override: PartialModelDefinition
): ModelDefinition | null {
  const merged: PartialModelDefinition = {
    ...base,
    ...override,
    id: modelId as ModelId,
  };

  if (base.modalities || override.modalities) {
    merged.modalities = {
      ...(base.modalities ?? {}),
      ...(override.modalities ?? {}),
    };
  }

  if (!isCompleteModelDefinition(merged)) {
    return null;
  }

  return merged;
}

export function readCustomModelDefinitionsFromEnv(
  env: NodeJS.ProcessEnv = process.env
): Record<string, PartialModelDefinition> {
  const raw = env[CUSTOM_MODELS_ENV_VAR];
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) {
      return {};
    }

    const result: Record<string, PartialModelDefinition> = {};
    for (const [modelId, modelConfig] of Object.entries(parsed)) {
      const sanitized = sanitizePartialModelDefinition(modelId, modelConfig);
      if (sanitized) {
        result[modelId] = sanitized;
      }
    }

    return result;
  } catch {
    return {};
  }
}

export function getResolvedModelDefinitions(
  env: NodeJS.ProcessEnv = process.env
): Record<ModelId, ModelDefinition> {
  const customDefinitions = readCustomModelDefinitionsFromEnv(env);
  const resolved: Record<string, ModelDefinition> = { ...MODEL_DEFINITIONS };

  for (const [modelId, customDefinition] of Object.entries(customDefinitions)) {
    const baseDefinition =
      resolved[modelId] ?? ({ id: modelId as ModelId } as PartialModelDefinition);
    const mergedDefinition = mergeModelDefinition(modelId, baseDefinition, customDefinition);

    if (mergedDefinition) {
      resolved[modelId] = mergedDefinition;
    }
  }

  return resolved as Record<ModelId, ModelDefinition>;
}

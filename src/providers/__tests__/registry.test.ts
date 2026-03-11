/**
 * Provider Registry 测试
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ProviderRegistry, MODEL_CONFIGS, ModelId, Models } from '../registry';
import { OpenAICompatibleProvider } from '../openai-compatible';
import { StandardAdapter } from '../adapters/standard';

// Mock process.env
const originalEnv = process.env;

describe('ProviderRegistry', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('MODEL_CONFIGS', () => {
    it('should have all model configurations', () => {
      const modelIds = Object.keys(MODEL_CONFIGS) as ModelId[];

      modelIds.forEach((id) => {
        expect(MODEL_CONFIGS[id]).toBeDefined();
        expect(MODEL_CONFIGS[id].id).toBe(id);
      });
    });

    it('should have required properties for each model', () => {
      Object.values(MODEL_CONFIGS).forEach((config) => {
        expect(config).toHaveProperty('id');
        expect(config).toHaveProperty('provider');
        expect(config).toHaveProperty('name');
        expect(config).toHaveProperty('baseURL');
        expect(config).toHaveProperty('endpointPath');
        expect(config).toHaveProperty('envApiKey');
        expect(config).toHaveProperty('envBaseURL');
        expect(config).toHaveProperty('model');
        expect(config).toHaveProperty('max_tokens');
        expect(config).toHaveProperty('LLMMAX_TOKENS');
        expect(config).toHaveProperty('features');
        expect(Array.isArray(config.features)).toBe(true);
      });
    });

    it('should have valid provider types', () => {
      const validProviders = ['anthropic', 'kimi', 'deepseek', 'glm', 'minimax', 'openai', 'qwen'];

      Object.values(MODEL_CONFIGS).forEach((config) => {
        expect(validProviders).toContain(config.provider);
      });
    });

    it('should use Anthropic messages endpoint for claude-opus-4.6', () => {
      expect(MODEL_CONFIGS['claude-opus-4.6'].endpointPath).toBe('/v1/messages');
    });
  });

  describe('createFromEnv', () => {
    it('should create provider for glm-4.7', () => {
      process.env.GLM_API_KEY = 'test-glm-key';

      const provider = ProviderRegistry.createFromEnv('glm-4.7');

      expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
      expect(provider.config.apiKey).toBe('test-glm-key');
    });

    it('should create provider for minimax-2.5', () => {
      process.env.MINIMAX_API_KEY = 'test-minimax-key';

      const provider = ProviderRegistry.createFromEnv('minimax-2.5');

      expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
      expect(provider.config.apiKey).toBe('test-minimax-key');
    });

    it('should create provider for kimi-k2.5', () => {
      process.env.KIMI_API_KEY = 'test-kimi-key';

      const provider = ProviderRegistry.createFromEnv('kimi-k2.5');

      expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
      expect(provider.config.apiKey).toBe('test-kimi-key');
    });

    it('should create provider for deepseek-chat', () => {
      process.env.DEEPSEEK_API_KEY = 'test-deepseek-key';

      const provider = ProviderRegistry.createFromEnv('deepseek-chat');

      expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
      expect(provider.config.apiKey).toBe('test-deepseek-key');
    });

    it('should create provider for qwen3.5-plus with QWEN env vars', () => {
      process.env.QWEN_API_KEY = 'test-qwen-key';

      const provider = ProviderRegistry.createFromEnv('qwen3.5-plus');

      expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
      expect(provider.config.apiKey).toBe('test-qwen-key');
    });

    it('should use StandardAdapter for glm-5', () => {
      process.env.GLM_API_KEY = 'test-glm5-key';

      const provider = ProviderRegistry.createFromEnv('glm-5');
      expect(provider.adapter).toBeInstanceOf(StandardAdapter);
    });

    it('should use default baseURL when env var not set', () => {
      process.env.GLM_API_KEY = 'test-key';
      delete process.env.GLM_API_BASE;

      const provider = ProviderRegistry.createFromEnv('glm-4.7');

      expect(provider.config.baseURL).toBe('https://open.bigmodel.cn/api/paas/v4');
    });

    it('should use custom baseURL from env var', () => {
      process.env.GLM_API_KEY = 'test-key';
      process.env.GLM_API_BASE = 'https://custom.example.com';

      const provider = ProviderRegistry.createFromEnv('glm-4.7');

      expect(provider.config.baseURL).toBe('https://custom.example.com');
    });

    it('should accept config overrides', () => {
      process.env.GLM_API_KEY = 'test-key';

      const provider = ProviderRegistry.createFromEnv('glm-4.7', {
        temperature: 0.8,
        apiKey: 'override-key',
      });

      expect(provider.config.temperature).toBe(0.8);
      expect(provider.config.apiKey).toBe('override-key');
    });

    it('should accept tool_stream override', () => {
      process.env.GLM_API_KEY = 'test-key';

      const provider = ProviderRegistry.createFromEnv('glm-4.7', {
        temperature: 0.1,
        tool_stream: true,
      });

      expect(provider.config.temperature).toBe(0.1);
      expect(provider.config.tool_stream).toBe(true);
    });

    it('should use model default model_reasoning_effort', () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';

      const provider = ProviderRegistry.createFromEnv('gpt-5.3');

      expect(provider.config.model_reasoning_effort).toBe('high');
    });

    it('should accept model_reasoning_effort override', () => {
      process.env.OPENAI_API_KEY = 'test-openai-key';

      const provider = ProviderRegistry.createFromEnv('gpt-5.3', {
        model_reasoning_effort: 'medium',
      });

      expect(provider.config.model_reasoning_effort).toBe('medium');
    });

    it('should allow max_tokens and LLMMAX_TOKENS overrides', () => {
      process.env.GLM_API_KEY = 'test-key';

      const provider = ProviderRegistry.createFromEnv('glm-4.7', {
        max_tokens: 1234,
        LLMMAX_TOKENS: 5678,
      });

      expect(provider.config.max_tokens).toBe(1234);
      expect(provider.config.LLMMAX_TOKENS).toBe(5678);
    });

    it('should not leak unrelated override fields into provider config', () => {
      process.env.GLM_API_KEY = 'test-key';

      const provider = ProviderRegistry.createFromEnv('glm-4.7', {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({ id: 'should-not-be-in-runtime-config' } as any),
      });

      expect((provider.config as Record<string, unknown>).id).toBeUndefined();
    });

    it('should throw error for unknown modelId', () => {
      expect(() => {
        ProviderRegistry.createFromEnv('unknown-model' as ModelId);
      }).toThrow('Unknown model: unknown-model');
    });

    it('should throw error for undefined modelId', () => {
      expect(() => {
        ProviderRegistry.createFromEnv(undefined as unknown as ModelId);
      }).toThrow('ModelId is required');
    });

    it('should handle empty API key', () => {
      delete process.env.GLM_API_KEY;

      const provider = ProviderRegistry.createFromEnv('glm-4.7');

      expect(provider.config.apiKey).toBe('');
    });
  });

  describe('create', () => {
    it('should create provider with custom config', () => {
      const config = {
        apiKey: 'custom-key',
        baseURL: 'https://custom.api.com',
        model: 'custom-model',
        temperature: 0.5,
        max_tokens: 2000,
        LLMMAX_TOKENS: 8000,
      };

      const provider = ProviderRegistry.create('glm-4.7', config);

      expect(provider).toBeInstanceOf(OpenAICompatibleProvider);
      expect(provider.config.apiKey).toBe('custom-key');
      expect(provider.config.baseURL).toBe('https://custom.api.com');
      expect(provider.config.model).toBe('custom-model');
    });

    it('should throw error for unknown model', () => {
      const config = {
        apiKey: 'key',
        baseURL: 'https://api.com',
        model: 'model',
        temperature: 0.5,
        max_tokens: 2000,
        LLMMAX_TOKENS: 8000,
      };

      expect(() => {
        ProviderRegistry.create('unknown' as ModelId, config);
      }).toThrow('Unknown model: unknown');
    });
  });

  describe('listModels', () => {
    it('should return all model configs', () => {
      const models = ProviderRegistry.listModels();

      expect(models).toHaveLength(Object.keys(MODEL_CONFIGS).length);
      expect(models.every((m) => m.id in MODEL_CONFIGS)).toBe(true);
    });

    it('should return array of ModelConfig', () => {
      const models = ProviderRegistry.listModels();

      models.forEach((model) => {
        expect(model).toHaveProperty('id');
        expect(model).toHaveProperty('provider');
        expect(model).toHaveProperty('name');
        expect(model).toHaveProperty('features');
      });
    });
  });

  describe('listModelsByProvider', () => {
    it('should return models for glm provider', () => {
      const models = ProviderRegistry.listModelsByProvider('glm');

      expect(models).toHaveLength(2);
      expect(models.map((m) => m.id)).toContain('glm-4.7');
      expect(models.map((m) => m.id)).toContain('glm-5');
    });

    it('should return models for deepseek provider', () => {
      const models = ProviderRegistry.listModelsByProvider('deepseek');

      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('deepseek-chat');
    });

    it('should return models for kimi provider', () => {
      const models = ProviderRegistry.listModelsByProvider('kimi');

      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('kimi-k2.5');
    });

    it('should return models for minimax provider', () => {
      const models = ProviderRegistry.listModelsByProvider('minimax');

      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('minimax-2.5');
    });

    it('should return empty array for provider with no models', () => {
      // 使用类型断言测试边缘情况：传入一个不在当前配置中的 provider
      const models = ProviderRegistry.listModelsByProvider('nonexistent-provider' as never);

      expect(models).toEqual([]);
    });
  });

  describe('getModelIds', () => {
    it('should return all model IDs', () => {
      const ids = ProviderRegistry.getModelIds();

      expect(ids).toEqual(Object.keys(MODEL_CONFIGS));
    });

    it('should return type ModelId[]', () => {
      const ids = ProviderRegistry.getModelIds();

      expect(Array.isArray(ids)).toBe(true);
    });
  });

  describe('getModelConfig', () => {
    it('should return config for glm-4.7', () => {
      const config = ProviderRegistry.getModelConfig('glm-4.7');

      expect(config.id).toBe('glm-4.7');
      expect(config.provider).toBe('glm');
      expect(config.name).toBe('GLM-4.7');
    });

    it('should return config for deepseek-chat', () => {
      const config = ProviderRegistry.getModelConfig('deepseek-chat');

      expect(config.id).toBe('deepseek-chat');
      expect(config.provider).toBe('deepseek');
      expect(config.name).toBe('DeepSeek Chat');
    });

    it('should throw error for unknown model', () => {
      expect(() => {
        ProviderRegistry.getModelConfig('unknown' as ModelId);
      }).toThrow('Unknown model: unknown');
    });
  });

  describe('getModelName', () => {
    it('should return display name for glm-4.7', () => {
      const name = ProviderRegistry.getModelName('glm-4.7');
      expect(name).toBe('GLM-4.7');
    });

    it('should return display name for minimax-2.5', () => {
      const name = ProviderRegistry.getModelName('minimax-2.5');
      expect(name).toBe('MiniMax-2.5');
    });

    it('should return display name for kimi-k2.5', () => {
      const name = ProviderRegistry.getModelName('kimi-k2.5');
      expect(name).toBe('Kimi K2.5');
    });

    it('should return display name for deepseek-chat', () => {
      const name = ProviderRegistry.getModelName('deepseek-chat');
      expect(name).toBe('DeepSeek Chat');
    });

    it('should return modelId for unknown model', () => {
      const name = ProviderRegistry.getModelName('unknown' as ModelId);
      expect(name).toBe('unknown');
    });
  });

  describe('getProviders', () => {
    it('should return unique provider types', () => {
      const providers = ProviderRegistry.getProviders();

      expect(providers).toContain('glm');
      expect(providers).toContain('deepseek');
      expect(providers).toContain('kimi');
      expect(providers).toContain('minimax');
    });

    it('should return array', () => {
      const providers = ProviderRegistry.getProviders();

      expect(Array.isArray(providers)).toBe(true);
    });
  });

  describe('Models accessor', () => {
    it('should have glm47 accessor', () => {
      expect(Models.glm47).toEqual(MODEL_CONFIGS['glm-4.7']);
      expect(Models.glm47.apiKey).toBeUndefined();
    });

    it('should have minimax25 accessor', () => {
      expect(Models.minimax25).toEqual(MODEL_CONFIGS['minimax-2.5']);
      expect(Models.minimax25.apiKey).toBeUndefined();
    });

    it('should have kimiK25 accessor', () => {
      expect(Models.kimiK25).toEqual(MODEL_CONFIGS['kimi-k2.5']);
      expect(Models.kimiK25.apiKey).toBeUndefined();
    });

    it('should have deepseekChat accessor', () => {
      expect(Models.deepseekChat).toEqual(MODEL_CONFIGS['deepseek-chat']);
      expect(Models.deepseekChat.apiKey).toBeUndefined();
    });
  });
});

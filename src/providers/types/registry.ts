/**
 * Registry related type definitions.
 */

/**
 * Supported provider types.
 */
export type ProviderType =
  | 'anthropic'
  | 'kimi'
  | 'deepseek'
  | 'glm'
  | 'minimax'
  | 'openai'
  | 'openrouter'
  | 'qwen';

/**
 * Built-in model IDs shipped with the CLI.
 */
export type BuiltinModelId =
  | 'claude-opus-4.6'
  | 'glm-4.7'
  | 'minimax-2.5'
  | 'kimi-k2.5'
  | 'glm-5'
  | 'qwen3.5-plus'
  | 'qwen-kimi-k2.5'
  | 'qwen-glm-5'
  | 'qwen3.5-max'
  | 'qwen-minimax-2.5'
  | 'deepseek-reasoner'
  | 'gpt-5.3'
  | 'gpt-5.4'
  | 'openrouter/hunter-alpha';

/**
 * Model IDs can include built-ins and user-defined config.json entries.
 */
export type ModelId = BuiltinModelId | (string & {});

/**
 * Model configuration.
 */
export interface ModelConfig {
  id: ModelId;
  provider: ProviderType;
  name: string;
  endpointPath: string;
  envApiKey: string;
  envBaseURL: string;
  baseURL: string;
  model: string;
  max_tokens: number;
  LLMMAX_TOKENS: number;
  features: string[];
  modalities?: {
    image?: boolean;
    audio?: boolean;
    video?: boolean;
  };
  apiKey?: string;
  temperature?: number;
  tool_stream?: boolean;
  thinking?: boolean;
  timeout?: number;
  model_reasoning_effort?: 'low' | 'medium' | 'high';
}

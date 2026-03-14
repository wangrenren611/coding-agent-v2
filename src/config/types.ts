import type { LogLevel } from '../logger';
import type { ProviderType } from '../providers/types';

export interface LogConfig {
  level?: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  format?: 'json' | 'pretty';
  console?: boolean;
  file?: boolean;
}

export interface FileHistoryConfig {
  enabled?: boolean;
  maxPerFile?: number;
  maxAgeDays?: number;
  maxTotalMb?: number;
}

export interface StorageConfig {
  fileHistory?: FileHistoryConfig;
}

export interface AgentConfig {
  maxSteps?: number;
  confirmationMode?: 'manual' | 'auto-approve' | 'auto-deny';
  defaultModel?: string;
}

export interface ConfigModelDefinition {
  provider?: ProviderType;
  name?: string;
  endpointPath?: string;
  envApiKey?: string;
  envBaseURL?: string;
  baseURL?: string;
  model?: string;
  max_tokens?: number;
  LLMMAX_TOKENS?: number;
  features?: string[];
  modalities?: {
    image?: boolean;
    audio?: boolean;
    video?: boolean;
  };
  temperature?: number;
  tool_stream?: boolean;
  thinking?: boolean;
  timeout?: number;
  model_reasoning_effort?: 'low' | 'medium' | 'high';
}

export interface RenxConfig {
  log?: LogConfig;
  storage?: StorageConfig;
  agent?: AgentConfig;
  models?: Record<string, ConfigModelDefinition>;
}

export interface ResolvedConfig {
  log: {
    level: LogLevel;
    format: 'json' | 'pretty';
    console: boolean;
    file: boolean;
    dir: string;
    filePath: string;
  };
  storage: {
    root: string;
    fileHistory: {
      enabled: boolean;
      maxPerFile: number;
      maxAgeDays: number;
      maxTotalMb: number;
    };
  };
  db: {
    path: string;
  };
  agent: {
    maxSteps: number;
    confirmationMode: 'manual' | 'auto-approve' | 'auto-deny';
    defaultModel: string;
  };
  models: Record<string, ConfigModelDefinition>;
  sources: {
    global: string | null;
    project: string | null;
  };
}

export interface LoadConfigOptions {
  projectRoot?: string;
  globalDir?: string;
  loadEnv?: boolean;
  env?: NodeJS.ProcessEnv;
}

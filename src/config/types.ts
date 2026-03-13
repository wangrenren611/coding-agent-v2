import type { LogLevel } from '../logger';

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

export interface RenxConfig {
  log?: LogConfig;
  storage?: StorageConfig;
  agent?: AgentConfig;
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

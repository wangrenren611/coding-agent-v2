/**
 * Renx Code 配置类型定义
 *
 * 支持两层配置：
 * - 全局配置：~/.renx/config.json
 * - 项目配置：<project>/.renx/config.json
 *
 * 合并策略：项目配置 > 全局配置 > 内置默认值
 */

import type { LogLevel } from '../logger';

/** 日志配置 */
export interface LogConfig {
  level?: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
  format?: 'json' | 'pretty';
  console?: boolean;
  file?: boolean;
  dir?: string;
}

/** 文件历史配置 */
export interface FileHistoryConfig {
  enabled?: boolean;
  maxPerFile?: number;
  maxAgeDays?: number;
  maxTotalMb?: number;
}

/** 存储配置 */
export interface StorageConfig {
  root?: string;
  fileHistory?: FileHistoryConfig;
}

/** 数据库配置 */
export interface DbConfig {
  path?: string;
}

/** Agent 行为配置 */
export interface AgentConfig {
  maxSteps?: number;
  confirmationMode?: 'auto-approve' | 'confirm';
  defaultModel?: string;
}

/** 完整配置结构 */
export interface RenxConfig {
  /** 日志配置 */
  log?: LogConfig;
  /** 存储配置 */
  storage?: StorageConfig;
  /** 数据库配置 */
  db?: DbConfig;
  /** Agent 行为配置 */
  agent?: AgentConfig;
}

/** 解析后的运行时配置（所有字段都有值） */
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
    confirmationMode: 'auto-approve' | 'confirm';
    defaultModel: string;
  };
  /** 配置来源 */
  sources: {
    global: string | null;  // 全局配置文件路径
    project: string | null; // 项目配置文件路径
  };
}

/** 配置加载选项 */
export interface LoadConfigOptions {
  /** 项目根目录（默认：process.cwd()） */
  projectRoot?: string;
  /** 全局配置目录（默认：~/.renx） */
  globalDir?: string;
  /** 是否加载环境变量（默认：true） */
  loadEnv?: boolean;
  /** 环境变量覆盖 */
  env?: NodeJS.ProcessEnv;
}

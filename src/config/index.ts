/**
 * Renx Code 配置模块
 *
 * 两层配置架构：
 * - 全局配置：~/.renx/config.json
 * - 项目配置：<project>/.renx/config.json
 *
 * 合并策略：项目配置 > 全局配置 > 环境变量 > 内置默认值
 */

// 类型导出
export type {
  RenxConfig,
  ResolvedConfig,
  LoadConfigOptions,
  LogConfig,
  StorageConfig,
  FileHistoryConfig,
  DbConfig,
  AgentConfig,
} from './types';

// 配置加载器
export {
  loadConfig,
  loadConfigToEnv,
  getGlobalConfigDir,
  getProjectConfigDir,
  getGlobalConfigPath,
  getProjectConfigPath,
  ensureConfigDirs,
  writeProjectConfig,
  writeGlobalConfig,
} from './loader';

// 旧版 API（向后兼容）
export type {
  StorageBackend,
  LogFormat,
  RuntimeStorageConfig,
  RuntimeLogConfig,
  RuntimeConfig,
  LoadEnvFilesOptions,
} from './runtime';

export {
  loadEnvFiles,
  loadRuntimeConfigFromEnv,
  createLoggerFromRuntimeConfig,
  createLoggerFromEnv,
} from './runtime';

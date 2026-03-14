/**
 * Renx config module.
 *
 * Sources:
 * - global config: ~/.renx/config.json (or RENX_HOME/config.json)
 * - project config: <project>/.renx/config.json
 * - environment variables
 *
 * Effective precedence:
 * env > project config > global config > defaults
 */

// Type exports
export type {
  RenxConfig,
  ResolvedConfig,
  LoadConfigOptions,
  LogConfig,
  StorageConfig,
  FileHistoryConfig,
  AgentConfig,
  ConfigModelDefinition,
} from './types';

// Config loaders
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

// Runtime env helpers
export type { LogFormat, RuntimeLogConfig, RuntimeConfig, LoadEnvFilesOptions } from './runtime';

export {
  loadEnvFiles,
  loadRuntimeConfigFromEnv,
  createLoggerFromRuntimeConfig,
  createLoggerFromEnv,
} from './runtime';

export {
  RENX_HOME_ENV,
  resolveRenxHome,
  resolveRenxLogsDir,
  resolveRenxStorageRoot,
  resolveRenxTaskDir,
  resolveRenxDatabasePath,
} from './paths';

/**
 * Renx Code 配置加载器
 *
 * 配置优先级（从低到高）：
 * 1. 内置默认值
 * 2. 全局配置 ~/.renx/config.json
 * 3. 项目配置 <project>/.renx/config.json
 * 4. 环境变量 RENX_*
 */

import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { LogLevel } from '../logger';
import type { RenxConfig, ResolvedConfig, LoadConfigOptions, LogConfig } from './types';

// --- 常量 ---

const GLOBAL_DIR_NAME = '.renx';
const PROJECT_DIR_NAME = '.renx';
const CONFIG_FILENAME = 'config.json';

// --- 内置默认值 ---

const DEFAULTS: RenxConfig = {
  log: {
    level: 'INFO',
    format: 'pretty',
    console: true,
    file: false,
    dir: './logs',
  },
  storage: {
    root: './.renx/storage',
    fileHistory: {
      enabled: true,
      maxPerFile: 20,
      maxAgeDays: 14,
      maxTotalMb: 500,
    },
  },
  db: {
    path: './.renx/data.db',
  },
  agent: {
    maxSteps: 50,
    confirmationMode: 'auto-approve',
    defaultModel: 'glm-5',
  },
};

// --- 工具函数 ---

function expandHome(filepath: string): string {
  if (filepath.startsWith('~/')) {
    return path.join(os.homedir(), filepath.slice(2));
  }
  return filepath;
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

function parseLogLevelValue(raw: string | undefined): LogLevel | null {
  if (!raw) return null;
  const normalized = raw.trim().toUpperCase();
  switch (normalized) {
    case 'TRACE':
      return LogLevel.TRACE;
    case 'DEBUG':
      return LogLevel.DEBUG;
    case 'INFO':
      return LogLevel.INFO;
    case 'WARN':
      return LogLevel.WARN;
    case 'ERROR':
      return LogLevel.ERROR;
    case 'FATAL':
      return LogLevel.FATAL;
    default:
      return null;
  }
}

function parseLogLevelString(raw: string | undefined): LogConfig['level'] | null {
  if (!raw) return null;
  const normalized = raw.trim().toUpperCase();
  if (['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'].includes(normalized)) {
    return normalized as LogConfig['level'];
  }
  return null;
}

function parseBoolean(raw: string | undefined): boolean | null {
  if (raw === undefined) return null;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

// --- 深度合并 ---

function deepMerge<T extends Record<string, unknown>>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(override) as Array<keyof T>) {
    const val = override[key];
    if (val === undefined || val === null) continue;
    if (
      typeof val === 'object' &&
      !Array.isArray(val) &&
      typeof base[key] === 'object' &&
      base[key] !== null &&
      !Array.isArray(base[key])
    ) {
      result[key] = deepMerge(
        base[key] as Record<string, unknown>,
        val as Record<string, unknown>
      ) as T[keyof T];
    } else {
      result[key] = val as T[keyof T];
    }
  }
  return result;
}

// --- 环境变量覆盖 ---

function applyEnvOverrides(config: RenxConfig, env: NodeJS.ProcessEnv): RenxConfig {
  const result: RenxConfig = { ...config };

  // Log
  const logLevel = parseLogLevelString(env.RENX_LOG_LEVEL ?? env.AGENT_LOG_LEVEL);
  const logFormat = env.RENX_LOG_FORMAT ?? env.AGENT_LOG_FORMAT;
  const logConsole = parseBoolean(env.RENX_LOG_CONSOLE ?? env.AGENT_LOG_CONSOLE);
  const logFile = parseBoolean(env.RENX_LOG_FILE_ENABLED ?? env.AGENT_LOG_FILE_ENABLED);
  const logDir = env.RENX_LOG_DIR ?? env.AGENT_LOG_DIR;

  if (logLevel || logFormat || logConsole !== null || logFile !== null || logDir) {
    result.log = { ...result.log };
    if (logLevel) result.log.level = logLevel;
    if (logFormat === 'json' || logFormat === 'pretty') result.log.format = logFormat;
    if (logConsole !== null) result.log.console = logConsole;
    if (logFile !== null) result.log.file = logFile;
    if (logDir) result.log.dir = logDir;
  }

  // Storage
  const storageRoot = env.RENX_STORAGE_ROOT ?? env.AGENT_STORAGE_ROOT;
  const fileHistoryEnabled = parseBoolean(
    env.RENX_FILE_HISTORY_ENABLED ?? env.AGENT_FILE_HISTORY_ENABLED
  );

  if (storageRoot || fileHistoryEnabled !== null) {
    result.storage = { ...result.storage };
    if (storageRoot) result.storage.root = storageRoot;
    if (fileHistoryEnabled !== null) {
      result.storage.fileHistory = { ...result.storage.fileHistory, enabled: fileHistoryEnabled };
    }
  }

  // DB
  const dbPath = env.RENX_DB_PATH ?? env.AGENT_DB_PATH;
  if (dbPath) {
    result.db = { path: dbPath };
  }

  // Agent
  const confirmationMode = env.RENX_CONFIRMATION_MODE ?? env.AGENT_TOOL_CONFIRMATION_MODE;
  const defaultModel = env.RENX_DEFAULT_MODEL;
  const maxSteps = env.RENX_MAX_STEPS;

  if (confirmationMode || defaultModel || maxSteps) {
    result.agent = { ...result.agent };
    if (confirmationMode === 'auto-approve' || confirmationMode === 'confirm') {
      result.agent.confirmationMode = confirmationMode;
    }
    if (defaultModel) result.agent.defaultModel = defaultModel;
    if (maxSteps) {
      const parsed = parseInt(maxSteps, 10);
      if (!isNaN(parsed) && parsed > 0) result.agent.maxSteps = parsed;
    }
  }

  return result;
}

// --- 解析为运行时配置 ---

function resolveConfig(
  merged: RenxConfig,
  projectRoot: string,
  globalDir: string,
  sources: { global: string | null; project: string | null }
): ResolvedConfig {
  const logDir = path.resolve(projectRoot, merged.log?.dir ?? './logs');
  // 自动生成日志文件名：YYYY-MM-DDTHH-MM-SS.log
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const logFilename = `${timestamp}.log`;
  const storageRoot = path.resolve(projectRoot, merged.storage?.root ?? './.renx/storage');
  const dbPath = path.resolve(projectRoot, merged.db?.path ?? './.renx/data.db');

  const logLevelStr = merged.log?.level ?? 'INFO';
  const logLevel = parseLogLevelValue(logLevelStr) ?? LogLevel.INFO;

  return {
    log: {
      level: logLevel,
      format: merged.log?.format ?? 'pretty',
      console: merged.log?.console ?? true,
      file: merged.log?.file ?? false,
      dir: logDir,
      filePath: path.join(logDir, logFilename),
    },
    storage: {
      root: storageRoot,
      fileHistory: {
        enabled: merged.storage?.fileHistory?.enabled ?? true,
        maxPerFile: merged.storage?.fileHistory?.maxPerFile ?? 20,
        maxAgeDays: merged.storage?.fileHistory?.maxAgeDays ?? 14,
        maxTotalMb: merged.storage?.fileHistory?.maxTotalMb ?? 500,
      },
    },
    db: {
      path: dbPath,
    },
    agent: {
      maxSteps: merged.agent?.maxSteps ?? 50,
      confirmationMode: merged.agent?.confirmationMode ?? 'auto-approve',
      defaultModel: merged.agent?.defaultModel ?? 'glm-5',
    },
    sources,
  };
}

// --- 公共 API ---

/**
 * 加载 Renx Code 配置
 *
 * 配置优先级（从低到高）：
 * 1. 内置默认值
 * 2. 全局配置 ~/.renx/config.json
 * 3. 项目配置 <project>/.renx/config.json
 * 4. 环境变量 RENX_* / AGENT_*
 */
export function loadConfig(options: LoadConfigOptions = {}): ResolvedConfig {
  const projectRoot = options.projectRoot ?? process.cwd();
  const globalDir = expandHome(options.globalDir ?? path.join('~', GLOBAL_DIR_NAME));
  const env = options.env ?? process.env;

  // 1. 从默认值开始
  let config: RenxConfig = { ...DEFAULTS };

  // 2. 加载全局配置
  const globalConfigPath = path.join(globalDir, CONFIG_FILENAME);
  const globalConfig = readJsonFile<RenxConfig>(globalConfigPath);
  let globalSource: string | null = null;
  if (globalConfig) {
    config = deepMerge(config, globalConfig);
    globalSource = globalConfigPath;
  }

  // 3. 加载项目配置
  const projectConfigPath = path.join(projectRoot, PROJECT_DIR_NAME, CONFIG_FILENAME);
  const projectConfig = readJsonFile<RenxConfig>(projectConfigPath);
  let projectSource: string | null = null;
  if (projectConfig) {
    config = deepMerge(config, projectConfig);
    projectSource = projectConfigPath;
  }

  // 4. 环境变量覆盖
  if (options.loadEnv !== false) {
    config = applyEnvOverrides(config, env);
  }

  return resolveConfig(config, projectRoot, globalDir, {
    global: globalSource,
    project: projectSource,
  });
}

/**
 * 将 config.json 配置写入 process.env（仅当环境变量未设置时）
 *
 * 优先级：shell 环境变量 > config.json > .env 文件
 *
 * @param options 加载选项
 * @returns 加载的配置文件路径列表
 */
export function loadConfigToEnv(options: LoadConfigOptions = {}): string[] {
  const projectRoot = options.projectRoot ?? process.cwd();
  const globalDir = expandHome(options.globalDir ?? path.join('~', GLOBAL_DIR_NAME));
  const loadedFiles: string[] = [];

  // 记录已有的 shell 环境变量（最高优先级，不可覆盖）
  const shellEnvVars = new Set<string>();
  for (const key of Object.keys(process.env)) {
    shellEnvVars.add(key);
  }

  // 加载全局 config.json
  const globalConfigPath = path.join(globalDir, CONFIG_FILENAME);
  const globalConfig = readJsonFile<RenxConfig>(globalConfigPath);
  if (globalConfig) {
    applyConfigToEnv(globalConfig, shellEnvVars);
    loadedFiles.push(globalConfigPath);
  }

  // 加载项目 config.json（覆盖全局 config，但不覆盖 shell 环境变量）
  const projectConfigPath = path.join(projectRoot, PROJECT_DIR_NAME, CONFIG_FILENAME);
  const projectConfig = readJsonFile<RenxConfig>(projectConfigPath);
  if (projectConfig) {
    applyConfigToEnv(projectConfig, shellEnvVars);
    loadedFiles.push(projectConfigPath);
  }

  return loadedFiles;
}

/**
 * 将配置写入 process.env（仅当环境变量未设置时）
 */
function applyConfigToEnv(config: RenxConfig, shellEnvVars: Set<string>): void {
  const setIfUnset = (key: string, value: string | undefined) => {
    if (value !== undefined && !shellEnvVars.has(key)) {
      process.env[key] = value;
    }
  };

  // Log
  if (config.log) {
    setIfUnset('AGENT_LOG_LEVEL', config.log.level);
    setIfUnset('AGENT_LOG_FORMAT', config.log.format);
    setIfUnset(
      'AGENT_LOG_CONSOLE',
      config.log.console !== undefined ? String(config.log.console) : undefined
    );
    setIfUnset(
      'AGENT_LOG_FILE_ENABLED',
      config.log.file !== undefined ? String(config.log.file) : undefined
    );
    setIfUnset('AGENT_LOG_DIR', config.log.dir);
  }

  // Storage
  if (config.storage) {
    setIfUnset('AGENT_STORAGE_ROOT', config.storage.root);
    if (config.storage.fileHistory) {
      setIfUnset(
        'AGENT_FILE_HISTORY_ENABLED',
        config.storage.fileHistory.enabled !== undefined
          ? String(config.storage.fileHistory.enabled)
          : undefined
      );
      setIfUnset(
        'AGENT_FILE_HISTORY_MAX_PER_FILE',
        config.storage.fileHistory.maxPerFile !== undefined
          ? String(config.storage.fileHistory.maxPerFile)
          : undefined
      );
      setIfUnset(
        'AGENT_FILE_HISTORY_MAX_AGE_DAYS',
        config.storage.fileHistory.maxAgeDays !== undefined
          ? String(config.storage.fileHistory.maxAgeDays)
          : undefined
      );
      setIfUnset(
        'AGENT_FILE_HISTORY_MAX_TOTAL_MB',
        config.storage.fileHistory.maxTotalMb !== undefined
          ? String(config.storage.fileHistory.maxTotalMb)
          : undefined
      );
    }
  }

  // DB
  if (config.db) {
    setIfUnset('AGENT_DB_PATH', config.db.path);
  }

  // Agent
  if (config.agent) {
    setIfUnset('AGENT_TOOL_CONFIRMATION_MODE', config.agent.confirmationMode);
    setIfUnset('RENX_DEFAULT_MODEL', config.agent.defaultModel);
    setIfUnset(
      'RENX_MAX_STEPS',
      config.agent.maxSteps !== undefined ? String(config.agent.maxSteps) : undefined
    );
  }
}

/**
 * 获取全局配置目录路径
 */
export function getGlobalConfigDir(): string {
  return expandHome(path.join('~', GLOBAL_DIR_NAME));
}

/**
 * 获取项目配置目录路径
 */
export function getProjectConfigDir(projectRoot?: string): string {
  return path.join(projectRoot ?? process.cwd(), PROJECT_DIR_NAME);
}

/**
 * 获取全局配置文件路径
 */
export function getGlobalConfigPath(): string {
  return path.join(getGlobalConfigDir(), CONFIG_FILENAME);
}

/**
 * 获取项目配置文件路径
 */
export function getProjectConfigPath(projectRoot?: string): string {
  return path.join(getProjectConfigDir(projectRoot), CONFIG_FILENAME);
}

/**
 * 确保配置目录存在
 */
export function ensureConfigDirs(projectRoot?: string): void {
  const globalDir = getGlobalConfigDir();
  const projectDir = getProjectConfigDir(projectRoot);

  fs.mkdirSync(globalDir, { recursive: true });
  fs.mkdirSync(projectDir, { recursive: true });
}

/**
 * 写入项目配置文件
 */
export function writeProjectConfig(config: Partial<RenxConfig>, projectRoot?: string): string {
  const configPath = getProjectConfigPath(projectRoot);
  const configDir = path.dirname(configPath);
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return configPath;
}

/**
 * 写入全局配置文件
 */
export function writeGlobalConfig(config: Partial<RenxConfig>): string {
  const configPath = getGlobalConfigPath();
  const configDir = path.dirname(configPath);
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  return configPath;
}

/**
 * 运行时全局配置（基于环境变量）
 *
 * 支持通过环境变量统一配置：
 * - 日志级别与日志文件路径
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { createLogger, LogLevel, type Logger } from '../logger';

export type StorageBackend = 'file' | 'sqlite';
export type LogFormat = 'json' | 'pretty';

export interface RuntimeStorageConfig {
  backend: StorageBackend;
  dir: string;
  sqlitePath: string;
}

export interface RuntimeLogConfig {
  level: LogLevel;
  consoleEnabled: boolean;
  fileEnabled: boolean;
  filePath: string;
  format: LogFormat;
}

export interface RuntimeConfig {
  storage: RuntimeStorageConfig;
  log: RuntimeLogConfig;
}

export interface LoadEnvFilesOptions {
  files?: string[];
  override?: boolean;
}

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

function parseBooleanEnv(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) return true;
  if (FALSE_VALUES.has(normalized)) return false;
  throw new Error(`Invalid boolean env value: "${raw}"`);
}

function parseStorageBackend(raw: string | undefined): StorageBackend {
  if (!raw) return 'file';
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'file' || normalized === 'sqlite') return normalized;
  throw new Error(`Invalid AGENT_STORAGE_BACKEND: "${raw}" (expected "file" or "sqlite")`);
}

function parseLogLevel(raw: string | undefined): LogLevel {
  if (!raw) return LogLevel.INFO;
  const normalized = raw.trim().toUpperCase();
  switch (normalized) {
    case 'TRACE': return LogLevel.TRACE;
    case 'DEBUG': return LogLevel.DEBUG;
    case 'INFO': return LogLevel.INFO;
    case 'WARN': return LogLevel.WARN;
    case 'ERROR': return LogLevel.ERROR;
    case 'FATAL': return LogLevel.FATAL;
    default: throw new Error(`Invalid AGENT_LOG_LEVEL: "${raw}"`);
  }
}

function parseLogFormat(raw: string | undefined): LogFormat {
  if (!raw) return 'pretty';
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'json' || normalized === 'pretty') return normalized;
  throw new Error(`Invalid AGENT_LOG_FORMAT: "${raw}" (expected "json" or "pretty")`);
}

export async function loadEnvFiles(
  cwd = process.cwd(),
  options: LoadEnvFilesOptions = {}
): Promise<string[]> {
  const files = options.files ?? ['.env', '.env.development'];
  const override = options.override ?? false;
  const loadedFiles: string[] = [];

  for (const fileName of files) {
    const filePath = path.resolve(cwd, fileName);
    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const equalIndex = trimmed.indexOf('=');
      if (equalIndex <= 0) continue;
      const key = trimmed.slice(0, equalIndex).trim();
      let value = trimmed.slice(equalIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (override || process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
    loadedFiles.push(filePath);
  }
  return loadedFiles;
}

export function loadRuntimeConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): RuntimeConfig {
  const storageBackend = parseStorageBackend(env.AGENT_STORAGE_BACKEND);
  const storageDir = path.resolve(cwd, env.AGENT_STORAGE_DIR ?? './data/agent-memory');
  const sqlitePath = path.resolve(
    cwd,
    env.AGENT_SQLITE_PATH ?? path.join(storageDir, 'agent-memory.db')
  );
  const logDir = path.resolve(cwd, env.AGENT_LOG_DIR ?? './logs');
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const logFileName = `${timestamp}.log`;
  const logFilePath = path.resolve(logDir, logFileName);

  return {
    storage: { backend: storageBackend, dir: storageDir, sqlitePath },
    log: {
      level: parseLogLevel(env.AGENT_LOG_LEVEL),
      consoleEnabled: parseBooleanEnv(env.AGENT_LOG_CONSOLE, true),
      fileEnabled: parseBooleanEnv(env.AGENT_LOG_FILE_ENABLED, false),
      filePath: logFilePath,
      format: parseLogFormat(env.AGENT_LOG_FORMAT),
    },
  };
}

export function createLoggerFromRuntimeConfig(config: RuntimeConfig): Logger {
  return createLogger({
    level: config.log.level,
    console: { enabled: config.log.consoleEnabled, format: config.log.format },
    file: { enabled: config.log.fileEnabled, filepath: config.log.filePath, format: config.log.format },
  });
}

export function createLoggerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): Logger {
  return createLoggerFromRuntimeConfig(loadRuntimeConfigFromEnv(env, cwd));
}

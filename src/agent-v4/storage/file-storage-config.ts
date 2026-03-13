import * as path from 'node:path';

export const AGENT_STORAGE_ROOT_ENV = 'AGENT_STORAGE_ROOT';
export const AGENT_FILE_HISTORY_ENABLED_ENV = 'AGENT_FILE_HISTORY_ENABLED';
export const AGENT_FILE_HISTORY_MAX_PER_FILE_ENV = 'AGENT_FILE_HISTORY_MAX_PER_FILE';
export const AGENT_FILE_HISTORY_MAX_AGE_DAYS_ENV = 'AGENT_FILE_HISTORY_MAX_AGE_DAYS';
export const AGENT_FILE_HISTORY_MAX_TOTAL_MB_ENV = 'AGENT_FILE_HISTORY_MAX_TOTAL_MB';

const DEFAULT_STORAGE_ROOT = path.resolve(process.cwd(), '.agent-storage');
const DEFAULT_WRITE_BUFFER_SUBDIR = path.join('cache', 'write-buffer');
const DEFAULT_HISTORY_SUBDIR = path.join('history', 'file-versions');
const DEFAULT_HISTORY_ENABLED = true;
const DEFAULT_HISTORY_MAX_PER_FILE = 20;
const DEFAULT_HISTORY_MAX_AGE_DAYS = 14;
const DEFAULT_HISTORY_MAX_TOTAL_MB = 500;
const LEGACY_WRITE_BUFFER_DIR = path.resolve(process.cwd(), '.agent-cache', 'write-file');

export interface FileStorageConfig {
  rootDir: string;
  writeBufferDir: string;
  historyDir: string;
  historyEnabled: boolean;
  historyMaxPerFile: number;
  historyMaxAgeDays: number;
  historyMaxTotalBytes: number;
  legacyWriteBufferDir: string;
}

function resolveConfiguredPath(raw: string | undefined, fallback: string): string {
  if (!raw || raw.trim().length === 0) {
    return path.resolve(fallback);
  }
  return path.resolve(raw.trim());
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }

  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseNonNegativeInteger(raw: string | undefined, fallback: number): number {
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

export function getFileStorageConfig(): FileStorageConfig {
  const rootDir = resolveConfiguredPath(process.env[AGENT_STORAGE_ROOT_ENV], DEFAULT_STORAGE_ROOT);
  const writeBufferDir = path.resolve(rootDir, DEFAULT_WRITE_BUFFER_SUBDIR);
  const historyDir = path.resolve(rootDir, DEFAULT_HISTORY_SUBDIR);
  const historyEnabled = parseBoolean(
    process.env[AGENT_FILE_HISTORY_ENABLED_ENV],
    DEFAULT_HISTORY_ENABLED
  );
  const historyMaxPerFile = parseNonNegativeInteger(
    process.env[AGENT_FILE_HISTORY_MAX_PER_FILE_ENV],
    DEFAULT_HISTORY_MAX_PER_FILE
  );
  const historyMaxAgeDays = parseNonNegativeInteger(
    process.env[AGENT_FILE_HISTORY_MAX_AGE_DAYS_ENV],
    DEFAULT_HISTORY_MAX_AGE_DAYS
  );
  const historyMaxTotalMb = parseNonNegativeInteger(
    process.env[AGENT_FILE_HISTORY_MAX_TOTAL_MB_ENV],
    DEFAULT_HISTORY_MAX_TOTAL_MB
  );

  return {
    rootDir,
    writeBufferDir,
    historyDir,
    historyEnabled,
    historyMaxPerFile,
    historyMaxAgeDays,
    historyMaxTotalBytes: historyMaxTotalMb * 1024 * 1024,
    legacyWriteBufferDir: LEGACY_WRITE_BUFFER_DIR,
  };
}

export function resolveWriteBufferBaseDir(override?: string): string {
  if (override && override.trim().length > 0) {
    return path.resolve(override);
  }
  return getFileStorageConfig().writeBufferDir;
}

export function getWriteBufferCandidateDirs(primaryDir?: string): string[] {
  const config = getFileStorageConfig();
  return [
    resolveWriteBufferBaseDir(primaryDir),
    config.writeBufferDir,
    config.legacyWriteBufferDir,
  ].filter((value, index, values) => values.indexOf(value) === index);
}

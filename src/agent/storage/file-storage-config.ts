import * as path from 'node:path';
import { resolveRenxStorageRoot } from '../../config/paths';

export const AGENT_FILE_HISTORY_ENABLED_ENV = 'AGENT_FILE_HISTORY_ENABLED';
export const AGENT_FILE_HISTORY_MAX_PER_FILE_ENV = 'AGENT_FILE_HISTORY_MAX_PER_FILE';
export const AGENT_FILE_HISTORY_MAX_AGE_DAYS_ENV = 'AGENT_FILE_HISTORY_MAX_AGE_DAYS';
export const AGENT_FILE_HISTORY_MAX_TOTAL_MB_ENV = 'AGENT_FILE_HISTORY_MAX_TOTAL_MB';

const DEFAULT_WRITE_BUFFER_SUBDIR = path.join('cache', 'write-buffer');
const DEFAULT_HISTORY_SUBDIR = path.join('history', 'file-versions');
const DEFAULT_HISTORY_ENABLED = true;
const DEFAULT_HISTORY_MAX_PER_FILE = 20;
const DEFAULT_HISTORY_MAX_AGE_DAYS = 14;
const DEFAULT_HISTORY_MAX_TOTAL_MB = 500;

export interface FileStorageConfig {
  rootDir: string;
  writeBufferDir: string;
  historyDir: string;
  historyEnabled: boolean;
  historyMaxPerFile: number;
  historyMaxAgeDays: number;
  historyMaxTotalBytes: number;
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
  const rootDir = resolveRenxStorageRoot(process.env);
  const writeBufferDir = path.join(rootDir, DEFAULT_WRITE_BUFFER_SUBDIR);
  const historyDir = path.join(rootDir, DEFAULT_HISTORY_SUBDIR);
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
  };
}

export function resolveWriteBufferBaseDir(override?: string): string {
  if (override && override.trim().length > 0) {
    return path.resolve(override);
  }
  return getFileStorageConfig().writeBufferDir;
}

export function getWriteBufferCandidateDirs(primaryDir?: string): string[] {
  return [resolveWriteBufferBaseDir(primaryDir)];
}

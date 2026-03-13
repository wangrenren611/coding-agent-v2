import { homedir } from 'node:os';
import * as path from 'node:path';

export const RENX_HOME_ENV = 'RENX_HOME';
const DEFAULT_RENX_DIRNAME = '.renx';

function readEnvPath(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value && value.length > 0 ? path.resolve(value) : undefined;
}

export function resolveRenxHome(env: NodeJS.ProcessEnv = process.env): string {
  return readEnvPath(env, RENX_HOME_ENV) ?? path.join(homedir(), DEFAULT_RENX_DIRNAME);
}

export function resolveRenxLogsDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveRenxHome(env), 'logs');
}

export function resolveRenxStorageRoot(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveRenxHome(env), 'storage');
}

export function resolveRenxTaskDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveRenxHome(env), 'task');
}

export function resolveRenxDatabasePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveRenxHome(env), 'data.db');
}

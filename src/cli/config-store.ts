import path from 'node:path';
import { promises as fs } from 'node:fs';
import { CLI_CONFIG_DIR, CLI_CONFIG_FILE } from './constants';
import type { PersistedCliConfig } from './types';

const DEFAULT_CONFIG: PersistedCliConfig = {
  disabledTools: [],
};

function configDirectory(baseCwd: string): string {
  return path.join(baseCwd, CLI_CONFIG_DIR);
}

function configPath(baseCwd: string): string {
  return path.join(configDirectory(baseCwd), CLI_CONFIG_FILE);
}

export async function loadCliConfig(baseCwd: string): Promise<PersistedCliConfig> {
  const file = configPath(baseCwd);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { ...DEFAULT_CONFIG };
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse CLI config at ${file}: ${message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid CLI config format at ${file}: expected JSON object`);
  }

  const parsedConfig = parsed as Partial<PersistedCliConfig>;
  return {
    ...DEFAULT_CONFIG,
    ...parsedConfig,
    disabledTools: Array.isArray(parsedConfig.disabledTools)
      ? parsedConfig.disabledTools.filter((item): item is string => typeof item === 'string')
      : [],
  };
}

export async function saveCliConfig(baseCwd: string, config: PersistedCliConfig): Promise<void> {
  const dir = configDirectory(baseCwd);
  await fs.mkdir(dir, { recursive: true });
  const file = configPath(baseCwd);
  const payload = JSON.stringify(config, null, 2);
  await fs.writeFile(file, payload, 'utf8');
}

export function getCliConfigPath(baseCwd: string): string {
  return configPath(baseCwd);
}

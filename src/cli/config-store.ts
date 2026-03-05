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
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as Partial<PersistedCliConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      disabledTools: Array.isArray(parsed.disabledTools)
        ? parsed.disabledTools.filter((item): item is string => typeof item === 'string')
        : [],
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
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

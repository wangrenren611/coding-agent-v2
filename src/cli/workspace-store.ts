import path from 'node:path';
import { promises as fs } from 'node:fs';
import { CLI_CONFIG_DIR, CLI_WORKSPACE_FILE } from './constants';
import type { WorkspaceProfile } from './types';

function workspaceFile(baseCwd: string): string {
  return path.join(baseCwd, CLI_CONFIG_DIR, CLI_WORKSPACE_FILE);
}

export async function loadWorkspaces(baseCwd: string): Promise<WorkspaceProfile[]> {
  const file = workspaceFile(baseCwd);
  try {
    const raw = await fs.readFile(file, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isWorkspaceProfile);
  } catch {
    return [];
  }
}

export async function saveWorkspaces(baseCwd: string, entries: WorkspaceProfile[]): Promise<void> {
  const dir = path.join(baseCwd, CLI_CONFIG_DIR);
  await fs.mkdir(dir, { recursive: true });
  const file = workspaceFile(baseCwd);
  await fs.writeFile(file, JSON.stringify(entries, null, 2), 'utf8');
}

export function getWorkspaceFilePath(baseCwd: string): string {
  return workspaceFile(baseCwd);
}

function isWorkspaceProfile(value: unknown): value is WorkspaceProfile {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.name === 'string' &&
    typeof record.cwd === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.updatedAt === 'string'
  );
}

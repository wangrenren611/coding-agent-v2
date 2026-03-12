import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function writeTextFileAtomically(targetPath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.tmp.${randomUUID().slice(0, 8)}`;
  await fs.writeFile(tempPath, content, 'utf8');
  await fs.rename(tempPath, targetPath);
}

export async function writeJsonFileAtomically(targetPath: string, value: unknown): Promise<void> {
  await writeTextFileAtomically(targetPath, JSON.stringify(value, null, 2));
}

export async function readJsonFileIfExists<T>(targetPath: string): Promise<T | null> {
  try {
    const content = await fs.readFile(targetPath, 'utf8');
    return JSON.parse(content) as T;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      return null;
    }
    throw error;
  }
}

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { loadCliConfig, saveCliConfig } from '../config-store';

describe('cli config store', () => {
  test('returns default config when file does not exist', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-config-missing-'));
    await expect(loadCliConfig(root)).resolves.toEqual({ disabledTools: [] });
  });

  test('throws when config json is invalid', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-config-invalid-json-'));
    const file = path.join(root, '.agent-cli', 'config.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{bad json', 'utf8');

    await expect(loadCliConfig(root)).rejects.toThrow('Failed to parse CLI config');
  });

  test('throws when config json is not an object', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-config-invalid-shape-'));
    const file = path.join(root, '.agent-cli', 'config.json');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '[]', 'utf8');

    await expect(loadCliConfig(root)).rejects.toThrow('expected JSON object');
  });

  test('filters disabledTools to string values only', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-config-filter-'));
    await saveCliConfig(root, {
      disabledTools: ['bash', 'grep'],
    });
    const file = path.join(root, '.agent-cli', 'config.json');
    await fs.writeFile(
      file,
      JSON.stringify({ disabledTools: ['bash', 123, null, 'grep'] }),
      'utf8'
    );

    await expect(loadCliConfig(root)).resolves.toEqual({ disabledTools: ['bash', 'grep'] });
  });
});

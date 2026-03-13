import { afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileHistoryStore } from '../file-history-store';
import type { FileStorageConfig } from '../file-storage-config';

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-file-history-'));
  tempDirs.push(dir);
  return dir;
}

function createHistoryStore(
  rootDir: string,
  historyDir: string,
  overrides: Partial<FileStorageConfig> = {}
) {
  return new FileHistoryStore({
    config: {
      rootDir,
      writeBufferDir: path.join(rootDir, 'cache', 'write-buffer'),
      historyDir,
      historyEnabled: true,
      historyMaxPerFile: 20,
      historyMaxAgeDays: 14,
      historyMaxTotalBytes: 1024 * 1024,
      legacyWriteBufferDir: path.join(rootDir, '.renx', 'write-file'),
      ...overrides,
    },
  });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('FileHistoryStore', () => {
  it('stores previous versions and restores a chosen snapshot', async () => {
    const rootDir = await createTempDir();
    const historyDir = path.join(rootDir, 'history');
    const store = createHistoryStore(rootDir, historyDir);
    const targetPath = path.join(rootDir, 'demo.txt');

    await fs.writeFile(targetPath, 'v1', 'utf8');
    await store.snapshotBeforeWrite({
      targetPath,
      nextContent: 'v2',
      source: 'write_file',
    });
    await fs.writeFile(targetPath, 'v2', 'utf8');

    await store.snapshotBeforeWrite({
      targetPath,
      nextContent: 'v3',
      source: 'file_edit',
    });
    await fs.writeFile(targetPath, 'v3', 'utf8');

    const versions = await store.listVersions(targetPath);
    expect(versions).toHaveLength(2);
    expect(versions.map((version) => version.source).sort()).toEqual(['file_edit', 'write_file']);

    const originalVersion = versions.find((version) => version.source === 'write_file');
    expect(originalVersion).toBeDefined();

    const restored = await store.restoreVersion(targetPath, originalVersion!.versionId);
    expect(restored).toBe(true);
    expect(await fs.readFile(targetPath, 'utf8')).toBe('v1');
  });

  it('prunes older snapshots when per-file retention is exceeded', async () => {
    const rootDir = await createTempDir();
    const historyDir = path.join(rootDir, 'history');
    const store = createHistoryStore(rootDir, historyDir, {
      historyMaxPerFile: 1,
    });
    const targetPath = path.join(rootDir, 'retained.txt');

    await fs.writeFile(targetPath, 'old-1', 'utf8');
    await store.snapshotBeforeWrite({
      targetPath,
      nextContent: 'old-2',
      source: 'write_file',
    });
    await fs.writeFile(targetPath, 'old-2', 'utf8');
    await store.snapshotBeforeWrite({
      targetPath,
      nextContent: 'old-3',
      source: 'write_file',
    });

    const versions = await store.listVersions(targetPath);
    expect(versions).toHaveLength(1);
    expect(versions[0].contentHash).toBeDefined();
  });
});

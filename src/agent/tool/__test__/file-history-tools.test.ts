import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as syncFs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileHistoryStore } from '../../storage/file-history-store';
import type { FileStorageConfig } from '../../storage/file-storage-config';
import { FileHistoryListTool } from '../file-history-list';
import { FileHistoryRestoreTool } from '../file-history-restore';

function createHistoryStore(rootDir: string): FileHistoryStore {
  const config: FileStorageConfig = {
    rootDir,
    writeBufferDir: path.join(rootDir, 'cache', 'write-buffer'),
    historyDir: path.join(rootDir, 'history'),
    historyEnabled: true,
    historyMaxPerFile: 20,
    historyMaxAgeDays: 14,
    historyMaxTotalBytes: 1024 * 1024,
    legacyWriteBufferDir: path.join(rootDir, '.renx', 'write-file'),
  };

  return new FileHistoryStore({ config });
}

function parseOutput<T>(output: string | undefined): T {
  return JSON.parse(output || '{}') as T;
}

describe('file history tools', () => {
  let rootDir: string;
  let listTool: FileHistoryListTool;
  let restoreTool: FileHistoryRestoreTool;
  let historyStore: FileHistoryStore;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-file-history-tool-'));
    historyStore = createHistoryStore(rootDir);
    listTool = new FileHistoryListTool({
      allowedDirectories: [rootDir],
      historyStore,
    });
    restoreTool = new FileHistoryRestoreTool({
      allowedDirectories: [rootDir],
      historyStore,
    });
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('lists saved versions for a file', async () => {
    const targetPath = path.join(rootDir, 'demo.ts');
    await fs.writeFile(targetPath, 'const value = 1;\n', 'utf8');
    await historyStore.snapshotBeforeWrite({
      targetPath,
      nextContent: 'const value = 2;\n',
      source: 'write_file',
    });

    const result = await listTool.execute({ path: targetPath });
    const payload = parseOutput<{ path: string; versions: Array<{ versionId: string }> }>(
      result.output
    );

    expect(result.success).toBe(true);
    expect(payload.path).toBe(syncFs.realpathSync(targetPath));
    expect(payload.versions).toHaveLength(1);
    expect(payload.versions[0].versionId).toBeTruthy();
  });

  it('restores the latest saved version when versionId is omitted', async () => {
    const targetPath = path.join(rootDir, 'restore.ts');
    await fs.writeFile(targetPath, 'const value = 1;\n', 'utf8');
    await historyStore.snapshotBeforeWrite({
      targetPath,
      nextContent: 'const value = 2;\n',
      source: 'write_file',
    });
    await fs.writeFile(targetPath, 'const value = 2;\n', 'utf8');

    const result = await restoreTool.execute(
      { path: targetPath },
      {
        toolCallId: 'restore-history',
        loopIndex: 1,
        agent: {},
        confirmationApproved: true,
      }
    );
    const payload = parseOutput<{ restored: boolean; version: { versionId: string } }>(
      result.output
    );

    expect(result.success).toBe(true);
    expect(payload.restored).toBe(true);
    expect(payload.version.versionId).toBeTruthy();
    expect(await fs.readFile(targetPath, 'utf8')).toBe('const value = 1;\n');

    const versions = await historyStore.listVersions(targetPath);
    expect(versions).toHaveLength(2);
  });

  it('returns a typed error when no history exists for restore', async () => {
    const targetPath = path.join(rootDir, 'missing.ts');
    await fs.writeFile(targetPath, 'const value = 1;\n', 'utf8');

    const result = await restoreTool.execute(
      { path: targetPath },
      {
        toolCallId: 'restore-history-empty',
        loopIndex: 1,
        agent: {},
        confirmationApproved: true,
      }
    );

    expect(result.success).toBe(false);
    expect(result.output).toContain('FILE_HISTORY_EMPTY');
  });
});

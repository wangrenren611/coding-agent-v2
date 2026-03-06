import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fsp } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { FileReadTool } from '../file-read-tool';
import { FileWriteTool } from '../file-write-tool';
import { FileEditTool } from '../file-edit-tool';
import { FileStatTool } from '../file-stat-tool';
import { LocalFileBackend, StaticFileBackendRouter } from '../runtime';
import type { ToolExecutionContext } from '../types';

interface FileReadData {
  path: string;
  content: string;
  etag?: string;
  truncated: boolean;
  originalLength?: number;
}

interface FileWriteData {
  path: string;
  etag?: string;
}

interface FileEditData {
  path: string;
  diff: string;
  changed: boolean;
  etag?: string;
}

interface FileStatData {
  path: string;
  stats: {
    exists: boolean;
    isFile: boolean;
    isDirectory: boolean;
  };
}

interface FileErrorData {
  error: string;
  code?: string;
  conflict?: boolean;
  recoverable?: boolean;
  message?: string;
}

const mockContext: ToolExecutionContext = {
  toolCallId: 'file-tools-test-call',
  loopIndex: 0,
  stepIndex: 0,
  agent: {} as ToolExecutionContext['agent'],
};

describe('file read/write/edit/stat tools', () => {
  let root: string;
  let outsideRoot: string;
  let fileReadTool: FileReadTool;
  let fileWriteTool: FileWriteTool;
  let fileEditTool: FileEditTool;
  let fileStatTool: FileStatTool;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(tmpdir(), 'file-tools-'));
    outsideRoot = await fsp.mkdtemp(path.join(tmpdir(), 'file-tools-outside-'));
    const router = new StaticFileBackendRouter({
      defaultTarget: 'local',
      backends: [new LocalFileBackend({ rootDir: root })],
    });
    const options = {
      allowedDirectories: [root],
      fileBackendRouter: router,
      defaultExecutionTarget: 'local' as const,
    };

    fileReadTool = new FileReadTool(options);
    fileWriteTool = new FileWriteTool(options);
    fileEditTool = new FileEditTool(options);
    fileStatTool = new FileStatTool(options);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
    await fsp.rm(outsideRoot, { recursive: true, force: true });
  });

  it('writes and reads full content with etag', async () => {
    const targetPath = path.join(root, 'note.txt');
    const writeResult = await fileWriteTool.execute(
      {
        path: targetPath,
        content: 'hello\nworld\n',
      },
      mockContext
    );
    expect(writeResult.success).toBe(true);
    expect((writeResult.data as FileWriteData).etag).toBeDefined();

    const readResult = await fileReadTool.execute(
      {
        path: targetPath,
      },
      mockContext
    );
    expect(readResult.success).toBe(true);

    const readData = readResult.data as FileReadData;
    expect(readData.content).toBe('hello\nworld\n');
    expect(readData.truncated).toBe(false);
    expect(readData.originalLength).toBeUndefined();
    expect(readData.etag).toBeDefined();
  });

  it('reads line ranges with startLine and endLine', async () => {
    const targetPath = path.join(root, 'range.txt');
    await fileWriteTool.execute(
      {
        path: targetPath,
        content: 'line-1\nline-2\nline-3\nline-4\n',
      },
      mockContext
    );

    const rangeResult = await fileReadTool.execute(
      {
        path: targetPath,
        startLine: 2,
        endLine: 3,
      },
      mockContext
    );
    expect(rangeResult.success).toBe(true);
    expect((rangeResult.data as FileReadData).content).toBe('line-2\nline-3');

    const tailFromLineResult = await fileReadTool.execute(
      {
        path: targetPath,
        startLine: 3,
      },
      mockContext
    );
    expect(tailFromLineResult.success).toBe(true);
    expect((tailFromLineResult.data as FileReadData).content).toBe('line-3\nline-4');
  });

  it('returns empty content when range starts after EOF', async () => {
    const targetPath = path.join(root, 'short.txt');
    await fileWriteTool.execute(
      {
        path: targetPath,
        content: 'a\nb\n',
      },
      mockContext
    );

    const readResult = await fileReadTool.execute(
      {
        path: targetPath,
        startLine: 10,
      },
      mockContext
    );
    expect(readResult.success).toBe(true);
    expect((readResult.data as FileReadData).content).toBe('');
  });

  it('rejects invalid line ranges where endLine < startLine', async () => {
    const targetPath = path.join(root, 'invalid-range.txt');

    const result = await fileReadTool.execute(
      {
        path: targetPath,
        startLine: 5,
        endLine: 2,
      },
      mockContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('FILE_READ_INVALID_LINE_RANGE');
    const errorData = result.data as FileErrorData;
    expect(errorData.error).toBe('FILE_READ_INVALID_LINE_RANGE');
  });

  it('truncates oversized read content using base truncation policy', async () => {
    const targetPath = path.join(root, 'large.txt');
    const hugeContent = 'x'.repeat(40_000);
    await fileWriteTool.execute(
      {
        path: targetPath,
        content: hugeContent,
      },
      mockContext
    );

    const readResult = await fileReadTool.execute(
      {
        path: targetPath,
      },
      mockContext
    );
    expect(readResult.success).toBe(true);

    const readData = readResult.data as FileReadData;
    expect(readData.truncated).toBe(true);
    expect(readData.originalLength).toBe(40_000);
    expect(readData.content.length).toBeLessThanOrEqual(30_000);
    expect(readData.content).toContain('[... Output Truncated ...]');
  });

  it('supports non-atomic write mode', async () => {
    const targetPath = path.join(root, 'nonatomic.txt');

    const writeResult = await fileWriteTool.execute(
      {
        path: targetPath,
        content: 'non-atomic content',
        atomic: false,
      },
      mockContext
    );
    expect(writeResult.success).toBe(true);

    const readResult = await fileReadTool.execute(
      {
        path: targetPath,
      },
      mockContext
    );
    expect(readResult.success).toBe(true);
    expect((readResult.data as FileReadData).content).toBe('non-atomic content');
  });

  it('rejects writes outside allowed directories', async () => {
    const outsidePath = path.join(outsideRoot, 'outside.txt');

    const writeResult = await fileWriteTool.execute(
      {
        path: outsidePath,
        content: 'blocked',
      },
      mockContext
    );

    expect(writeResult.success).toBe(false);
    expect(writeResult.error).toContain('FILE_WRITE_FAILED');
  });

  it('rejects write when etag mismatches latest content', async () => {
    const targetPath = path.join(root, 'etag.txt');

    const firstWrite = await fileWriteTool.execute(
      {
        path: targetPath,
        content: 'v1',
      },
      mockContext
    );
    expect(firstWrite.success).toBe(true);
    const staleEtag = (firstWrite.data as FileWriteData).etag;

    const secondWrite = await fileWriteTool.execute(
      {
        path: targetPath,
        content: 'v2',
      },
      mockContext
    );
    expect(secondWrite.success).toBe(true);

    const staleWrite = await fileWriteTool.execute(
      {
        path: targetPath,
        content: 'v3',
        etag: staleEtag,
      },
      mockContext
    );
    expect(staleWrite.success).toBe(false);
    expect(staleWrite.error).toContain('FILE_WRITE_FAILED');
    expect(String((staleWrite.data as FileErrorData).message)).toContain('ETAG_MISMATCH');
  });

  it('previews and applies text edits', async () => {
    const targetPath = path.join(root, 'edit.txt');
    await fileWriteTool.execute(
      {
        path: targetPath,
        content: 'const value = 1;\nconsole.log(value);\n',
      },
      mockContext
    );

    const previewResult = await fileEditTool.execute(
      {
        path: targetPath,
        edits: [{ oldText: 'value = 1', newText: 'value = 2' }],
        dry_run: true,
      },
      mockContext
    );
    expect(previewResult.success).toBe(true);

    const previewData = previewResult.data as FileEditData;
    expect(previewData.changed).toBe(true);
    expect(previewData.diff).toContain('value = 2');

    const applyResult = await fileEditTool.execute(
      {
        path: targetPath,
        edits: [{ oldText: 'value = 1', newText: 'value = 2' }],
      },
      mockContext
    );
    expect(applyResult.success).toBe(true);

    const readBackResult = await fileReadTool.execute(
      {
        path: targetPath,
      },
      mockContext
    );
    expect(readBackResult.success).toBe(true);
    expect((readBackResult.data as FileReadData).content).toContain('value = 2');
  });

  it('reports no changes when edit replacement is identical', async () => {
    const targetPath = path.join(root, 'no-change.txt');
    await fileWriteTool.execute(
      {
        path: targetPath,
        content: 'const answer = 42;\n',
      },
      mockContext
    );

    const result = await fileEditTool.execute(
      {
        path: targetPath,
        edits: [{ oldText: 'const answer = 42;', newText: 'const answer = 42;' }],
      },
      mockContext
    );

    expect(result.success).toBe(true);
    expect((result.data as FileEditData).changed).toBe(false);
    expect((result.data as FileEditData).diff).toContain('Index:');
  });

  it('returns structured edit conflict when oldText does not match', async () => {
    const targetPath = path.join(root, 'conflict-edit.txt');
    await fileWriteTool.execute(
      {
        path: targetPath,
        content: 'const answer = 42;\n',
      },
      mockContext
    );

    const result = await fileEditTool.execute(
      {
        path: targetPath,
        edits: [{ oldText: 'const answer = 100;', newText: 'const answer = 7;' }],
      },
      mockContext
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('EDIT_CONFLICT');

    const errorData = result.data as FileErrorData;
    expect(errorData.error).toBe('EDIT_CONFLICT');
    expect(errorData.code).toBe('EDIT_CONFLICT');
    expect(errorData.conflict).toBe(true);
    expect(errorData.recoverable).toBe(true);
    expect(errorData).toMatchObject({
      agent_hint: expect.stringContaining('Read latest content'),
      next_actions: ['file_read', 'file_edit'],
    });
  });

  it('returns path stat for file, directory and missing path', async () => {
    const existingFilePath = path.join(root, 'stat.txt');
    const existingDirPath = path.join(root, 'folder');
    const missingPath = path.join(root, 'missing.txt');

    await fileWriteTool.execute(
      {
        path: existingFilePath,
        content: 'stat me',
      },
      mockContext
    );
    await fsp.mkdir(existingDirPath, { recursive: true });

    const fileStatResult = await fileStatTool.execute(
      {
        path: existingFilePath,
      },
      mockContext
    );
    expect(fileStatResult.success).toBe(true);
    const fileStatData = fileStatResult.data as FileStatData;
    expect(fileStatData.stats.exists).toBe(true);
    expect(fileStatData.stats.isFile).toBe(true);
    expect(fileStatData.stats.isDirectory).toBe(false);

    const dirStatResult = await fileStatTool.execute(
      {
        path: existingDirPath,
      },
      mockContext
    );
    expect(dirStatResult.success).toBe(true);
    const dirStatData = dirStatResult.data as FileStatData;
    expect(dirStatData.stats.exists).toBe(true);
    expect(dirStatData.stats.isDirectory).toBe(true);

    const missingStatResult = await fileStatTool.execute(
      {
        path: missingPath,
      },
      mockContext
    );
    expect(missingStatResult.success).toBe(true);
    const missingStatData = missingStatResult.data as FileStatData;
    expect(missingStatData.stats.exists).toBe(false);
  });
});

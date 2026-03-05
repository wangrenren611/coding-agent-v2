import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fsp } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createTwoFilesPatch } from 'diff';
import { FileTool } from '../file-tool';
import { LocalFileBackend, StaticFileBackendRouter } from '../runtime';
import type { ToolExecutionContext } from '../types';

interface FileReadData {
  path: string;
  content: string;
  etag?: string;
}

interface FileListData {
  entries: Array<{ path: string; isDirectory: boolean }>;
  total: number;
}

interface FileSearchData {
  matches: string[];
  total: number;
}

interface FileErrorData {
  error: string;
  code?: string;
  conflict?: boolean;
  recoverable?: boolean;
  message?: string;
}

const mockContext: ToolExecutionContext = {
  toolCallId: 'file-tool-test-call',
  loopIndex: 0,
  stepIndex: 0,
  agent: {} as ToolExecutionContext['agent'],
};

describe('FileTool', () => {
  let root: string;
  let fileTool: FileTool;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(tmpdir(), 'file-tool-'));
    const router = new StaticFileBackendRouter({
      defaultTarget: 'local',
      backends: [new LocalFileBackend({ rootDir: root })],
    });
    fileTool = new FileTool({
      allowedDirectories: [root],
      fileBackendRouter: router,
      defaultExecutionTarget: 'local',
    });
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('should write and read file content', async () => {
    const targetPath = path.join(root, 'note.txt');
    const writeResult = await fileTool.execute(
      {
        action: 'write',
        path: targetPath,
        content: 'hello\nworld\n',
      },
      mockContext
    );
    expect(writeResult.success).toBe(true);

    const readResult = await fileTool.execute(
      {
        action: 'read',
        path: targetPath,
      },
      mockContext
    );
    expect(readResult.success).toBe(true);
    const readData = readResult.data as FileReadData;
    expect(readData.content).toContain('hello');
    expect(readData.etag).toBeDefined();
  });

  it('should preview and apply text edits', async () => {
    const targetPath = path.join(root, 'edit.txt');
    await fileTool.execute(
      {
        action: 'write',
        path: targetPath,
        content: 'const value = 1;\nconsole.log(value);\n',
      },
      mockContext
    );

    const preview = await fileTool.execute(
      {
        action: 'edit',
        path: targetPath,
        edits: [{ oldText: 'value = 1', newText: 'value = 2' }],
        dry_run: true,
      },
      mockContext
    );
    expect(preview.success).toBe(true);
    expect(String((preview.data as { diff?: string }).diff)).toContain('value = 2');

    const apply = await fileTool.execute(
      {
        action: 'edit',
        path: targetPath,
        edits: [{ oldText: 'value = 1', newText: 'value = 2' }],
      },
      mockContext
    );
    expect(apply.success).toBe(true);

    const readBack = await fileTool.execute(
      {
        action: 'read',
        path: targetPath,
      },
      mockContext
    );
    expect(readBack.success).toBe(true);
    expect((readBack.data as FileReadData).content).toContain('value = 2');
  });

  it('should support list/stat/search/head/tail/patch as end-to-end flow', async () => {
    const dirPath = path.join(root, 'notes');
    const targetPath = path.join(dirPath, 'demo.txt');
    await fsp.mkdir(dirPath, { recursive: true });

    await fileTool.execute(
      {
        action: 'write',
        path: targetPath,
        content: 'line-1\nline-2\nline-3\n',
      },
      mockContext
    );

    const statResult = await fileTool.execute(
      {
        action: 'stat',
        path: targetPath,
      },
      mockContext
    );
    expect(statResult.success).toBe(true);
    expect((statResult.data as { stats?: { exists?: boolean } }).stats?.exists).toBe(true);

    const listResult = await fileTool.execute(
      {
        action: 'list',
        path: dirPath,
      },
      mockContext
    );
    expect(listResult.success).toBe(true);
    const listData = listResult.data as FileListData;
    expect(listData.total).toBeGreaterThanOrEqual(1);

    const searchResult = await fileTool.execute(
      {
        action: 'search',
        path: root,
        pattern: '**/*.txt',
      },
      mockContext
    );
    expect(searchResult.success).toBe(true);
    const searchData = searchResult.data as FileSearchData;
    expect(searchData.matches.some((entry) => entry.endsWith('demo.txt'))).toBe(true);

    const headResult = await fileTool.execute(
      {
        action: 'head',
        path: targetPath,
        num_lines: 1,
      },
      mockContext
    );
    expect(headResult.success).toBe(true);
    expect((headResult.data as FileReadData).content.trim()).toBe('line-1');

    const tailResult = await fileTool.execute(
      {
        action: 'tail',
        path: targetPath,
        num_lines: 1,
      },
      mockContext
    );
    expect(tailResult.success).toBe(true);
    expect((tailResult.data as FileReadData).content.trim()).toBe('line-3');

    const patch = createTwoFilesPatch(
      targetPath,
      targetPath,
      'line-1\nline-2\nline-3\n',
      'line-1\nline-2-updated\nline-3\n',
      'original',
      'modified'
    );
    const patchResult = await fileTool.execute(
      {
        action: 'patch',
        path: targetPath,
        diff: patch,
      },
      mockContext
    );
    expect(patchResult.success).toBe(true);

    const readResult = await fileTool.execute(
      {
        action: 'read',
        path: targetPath,
      },
      mockContext
    );
    expect(readResult.success).toBe(true);
    expect((readResult.data as FileReadData).content).toContain('line-2-updated');
  });

  it('should return structured patch conflict for non-applicable patch', async () => {
    const targetPath = path.join(root, 'conflict-patch.txt');
    await fileTool.execute(
      {
        action: 'write',
        path: targetPath,
        content: 'alpha\nbeta\ngamma\n',
      },
      mockContext
    );

    const conflictPatch = createTwoFilesPatch(
      targetPath,
      targetPath,
      'other-1\nother-2\n',
      'other-1\nother-3\n',
      'original',
      'modified'
    );

    const result = await fileTool.execute(
      {
        action: 'patch',
        path: targetPath,
        diff: conflictPatch,
      },
      mockContext
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('PATCH_CONFLICT');
    const errorData = result.data as FileErrorData;
    expect(errorData.error).toBe('PATCH_CONFLICT');
    expect(errorData.code).toBe('PATCH_CONFLICT');
    expect(errorData.conflict).toBe(true);
    expect(errorData.recoverable).toBe(true);
    expect(errorData).toMatchObject({
      agent_hint: expect.stringContaining('Read the file again'),
      next_actions: ['read', 'patch'],
    });
  });

  it('should return structured edit conflict when oldText does not match', async () => {
    const targetPath = path.join(root, 'conflict-edit.txt');
    await fileTool.execute(
      {
        action: 'write',
        path: targetPath,
        content: 'const answer = 42;\n',
      },
      mockContext
    );

    const result = await fileTool.execute(
      {
        action: 'edit',
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
      next_actions: ['read', 'edit'],
    });
  });
});

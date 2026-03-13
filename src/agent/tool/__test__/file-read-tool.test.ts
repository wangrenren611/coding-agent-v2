import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileReadTool } from '../file-read-tool';

describe('FileReadTool', () => {
  let rootDir: string;
  let outsideDir: string;
  let tool: FileReadTool;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-file-read-tool-'));
    outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-file-read-outside-'));
    tool = new FileReadTool({
      allowedDirectories: [rootDir],
      maxOutputLength: 300,
    });
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
  });

  it('reads full content and returns metadata', async () => {
    const targetPath = path.join(rootDir, 'note.txt');
    await fs.writeFile(targetPath, 'hello\nworld\n', 'utf8');

    const result = await tool.execute({ path: targetPath });

    expect(result.success).toBe(true);
    expect(result.output).toBe('hello\nworld');

    const metadata = result.metadata as {
      path: string;
      etag: string;
      truncated: boolean;
    };

    expect(metadata.path).toBe(await fs.realpath(targetPath));
    expect(metadata.etag).toBeDefined();
    expect(metadata.truncated).toBe(false);
  });

  it('reads content by line range', async () => {
    const targetPath = path.join(rootDir, 'range.txt');
    await fs.writeFile(targetPath, 'line-1\nline-2\nline-3\nline-4\n', 'utf8');

    const result = await tool.execute({
      path: targetPath,
      startLine: 2,
      limit: 3,
    });

    expect(result.success).toBe(true);
    expect(result.output).toBe('line-3\nline-4');
  });

  it('supports open-ended line slicing', async () => {
    const targetPath = path.join(rootDir, 'open-ended.txt');
    await fs.writeFile(targetPath, 'line-1\nline-2\nline-3\nline-4\n', 'utf8');

    const toEnd = await tool.execute({
      path: targetPath,
      startLine: 2,
    });
    expect(toEnd.success).toBe(true);
    expect(toEnd.output).toBe('line-3\nline-4');

    const fromStart = await tool.execute({
      path: targetPath,
      limit: 2,
    });
    expect(fromStart.success).toBe(true);
    expect(fromStart.output).toBe('line-1\nline-2');
  });

  it('rejects invalid limit', async () => {
    const targetPath = path.join(rootDir, 'x.txt');
    await fs.writeFile(targetPath, 'content', 'utf8');

    const result = await tool.execute({
      path: targetPath,
      limit: 0,
    });

    expect(result.success).toBe(false);
    expect(result.output).toContain('FILE_READ_INVALID_LIMIT');
  });

  it('truncates oversized content', async () => {
    const targetPath = path.join(rootDir, 'large.txt');
    await fs.writeFile(targetPath, 'x'.repeat(5000), 'utf8');

    const result = await tool.execute({ path: targetPath });

    expect(result.success).toBe(true);
    expect((result.output || '').length).toBeLessThanOrEqual(300);
    expect(result.output || '').toContain('[... Output Truncated ...]');

    const metadata = result.metadata as {
      truncated: boolean;
      originalLength?: number;
    };
    expect(metadata.truncated).toBe(true);
    expect(metadata.originalLength).toBe(5000);
  });

  it('keeps a contiguous prefix when truncating content', async () => {
    const targetPath = path.join(rootDir, 'prefix-only.txt');
    const content =
      Array.from({ length: 180 }, (_, index) => `line-${index + 1}`).join('\n') +
      '\nTAIL_SENTINEL_END';
    await fs.writeFile(targetPath, content, 'utf8');

    const result = await tool.execute({ path: targetPath });
    expect(result.success).toBe(true);
    expect(result.output || '').toContain('[... Output Truncated ...]');
    expect(result.output || '').toContain('line-1');
    expect(result.output || '').not.toContain('TAIL_SENTINEL_END');
  });

  it('rejects path outside allowed directories', async () => {
    const outsidePath = path.join(outsideDir, 'outside.txt');
    await fs.writeFile(outsidePath, 'blocked', 'utf8');

    const result = await tool.execute({ path: outsidePath });

    expect(result.success).toBe(false);
    expect(result.output).toContain('PATH_NOT_ALLOWED');
  });

  it('exposes parallel-safe concurrency policy and lock key', () => {
    expect(tool.getConcurrencyMode()).toBe('parallel-safe');
    expect(
      tool.getConcurrencyLockKey({
        path: 'a.txt',
      })
    ).toBe('file_read:a.txt');
  });

  it('returns not-found error code for missing files', async () => {
    const result = await tool.execute({
      path: path.join(rootDir, 'missing.txt'),
    });

    expect(result.success).toBe(false);
    expect(result.output).toContain('FILE_READ_NOT_FOUND');
  });

  it('returns failure for directory path', async () => {
    const result = await tool.execute({
      path: rootDir,
    });

    expect(result.success).toBe(false);
    expect(result.output).toContain('FILE_READ_FAILED');
    expect(result.output).toContain('FILE_READ_NOT_FILE');
  });

  it('returns empty output when requested range is outside file bounds', async () => {
    const targetPath = path.join(rootDir, 'bounds.txt');
    await fs.writeFile(targetPath, 'one\ntwo\n', 'utf8');

    const result = await tool.execute({
      path: targetPath,
      startLine: 99,
      limit: 10,
    });

    expect(result.success).toBe(true);
    expect(result.output).toBe('');
  });

  it('uses hard truncation branch when output budget is very small', async () => {
    const tinyTool = new FileReadTool({
      allowedDirectories: [rootDir],
      maxOutputLength: 16,
    });
    const targetPath = path.join(rootDir, 'tiny-budget.txt');
    await fs.writeFile(targetPath, 'a'.repeat(120), 'utf8');

    const result = await tinyTool.execute({ path: targetPath });
    expect(result.success).toBe(true);
    expect((result.output || '').length).toBeLessThanOrEqual(16);
    expect(result.output || '').not.toContain('[... Output Truncated ...]');
  });

  it('maps permission and generic errors in toFailureMessage helper', () => {
    const helper = tool as unknown as {
      toFailureMessage: (requestedPath: string, error: unknown) => string;
    };
    const permissionMessage = helper.toFailureMessage('a.txt', {
      code: 'EACCES',
    });
    const genericMessage = helper.toFailureMessage('a.txt', new Error('boom'));

    expect(permissionMessage).toBe('FILE_READ_NO_PERMISSION: a.txt');
    expect(genericMessage).toBe('FILE_READ_FAILED: boom');
  });

  it('maps non-error values in toFailureMessage helper', () => {
    const helper = tool as unknown as {
      toFailureMessage: (requestedPath: string, error: unknown) => string;
    };
    const genericMessage = helper.toFailureMessage('a.txt', 12345);
    expect(genericMessage).toBe('FILE_READ_FAILED: 12345');
  });
});

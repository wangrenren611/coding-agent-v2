import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { GlobTool } from '../glob';

describe('GlobTool', () => {
  let rootDir: string;
  let tool: GlobTool;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-glob-tool-'));
    tool = new GlobTool({ allowedDirectories: [rootDir] });
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('finds files by pattern and returns metadata', async () => {
    await fs.mkdir(path.join(rootDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(rootDir, 'src', 'a.ts'), 'export const a = 1;', 'utf8');
    await fs.writeFile(path.join(rootDir, 'src', 'b.ts'), 'export const b = 2;', 'utf8');
    await fs.writeFile(path.join(rootDir, 'src', 'c.js'), 'module.exports = {};', 'utf8');

    const result = await tool.execute({
      pattern: '**/*.ts',
      path: rootDir,
      include_hidden: false,
      max_results: 200,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Found 2 file(s)');

    const metadata = result.metadata as {
      total: number;
      files: string[];
      relative_files: string[];
      truncated: boolean;
    };

    expect(metadata.total).toBe(2);
    expect(metadata.files.every((file) => file.endsWith('.ts'))).toBe(true);
    expect(metadata.relative_files).toEqual(['src/a.ts', 'src/b.ts']);
    expect(metadata.truncated).toBe(false);
  });

  it('supports include_hidden flag', async () => {
    await fs.writeFile(path.join(rootDir, '.hidden.ts'), 'export const hidden = true;', 'utf8');

    const hiddenOff = await tool.execute({
      pattern: '**/*.ts',
      path: rootDir,
      include_hidden: false,
      max_results: 200,
    });
    expect(hiddenOff.success).toBe(true);
    expect((hiddenOff.metadata as { total: number }).total).toBe(0);

    const hiddenOn = await tool.execute({
      pattern: '**/*.ts',
      path: rootDir,
      include_hidden: true,
      max_results: 200,
    });
    expect(hiddenOn.success).toBe(true);
    expect((hiddenOn.metadata as { total: number }).total).toBe(1);
  });

  it('returns failure for path outside allowed directories', async () => {
    const result = await tool.execute({
      pattern: '**/*.ts',
      path: path.resolve(rootDir, '..'),
      include_hidden: false,
      max_results: 200,
    });

    expect(result.success).toBe(false);
    expect(result.output).toContain('SEARCH_PATH_NOT_ALLOWED');
  });

  it('exposes parallel-safe concurrency policy and stable lock key', () => {
    const mode = tool.getConcurrencyMode();
    const lockKey = tool.getConcurrencyLockKey({
      pattern: '**/*.ts',
      path: rootDir,
      include_hidden: false,
      max_results: 10,
    });

    expect(mode).toBe('parallel-safe');
    expect(lockKey).toBe(`glob:${rootDir}`);
  });

  it('uses cwd fallback in lock key when path is omitted', () => {
    const lockKey = tool.getConcurrencyLockKey({
      pattern: '**/*.ts',
      include_hidden: false,
      max_results: 10,
    });

    expect(lockKey).toBe(`glob:${process.cwd()}`);
  });

  it('falls back to default error code for non-prefixed messages', () => {
    const errorCode = (
      tool as unknown as { extractErrorCode: (msg: string) => string }
    ).extractErrorCode('plain error text');
    expect(errorCode).toBe('GLOB_OPERATION_FAILED');
  });

  it('stringifies non-Error throws from internals', async () => {
    vi.resetModules();
    vi.doMock('../search/common', async () => {
      const actual = await vi.importActual<typeof import('../search/common')>('../search/common');
      return {
        ...actual,
        resolveSearchRoot: vi.fn(async () => {
          throw 'plain string thrown';
        }),
      };
    });

    const { GlobTool: MockedGlobTool } = await import('../glob');
    const mockedTool = new MockedGlobTool({ allowedDirectories: [rootDir] });
    const result = await mockedTool.execute({
      pattern: '**/*.ts',
      path: rootDir,
      include_hidden: false,
      max_results: 10,
    });

    expect(result.success).toBe(false);
    expect(result.output).toBe('plain string thrown');
    expect((result.metadata as { error: string }).error).toBe('GLOB_OPERATION_FAILED');
    vi.doUnmock('../search/common');
  });
});

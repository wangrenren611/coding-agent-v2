import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fsp } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { GlobTool } from '../glob';
import type { ToolExecutionContext } from '../types';

const mockContext: ToolExecutionContext = {
  toolCallId: 'glob-test-call',
  loopIndex: 0,
  stepIndex: 0,
  agent: {} as ToolExecutionContext['agent'],
};

describe('GlobTool', () => {
  let rootDir: string;
  let tool: GlobTool;

  beforeEach(async () => {
    rootDir = await fsp.mkdtemp(path.join(tmpdir(), 'glob-tool-'));
    tool = new GlobTool({ allowedDirectories: [rootDir] });
  });

  afterEach(async () => {
    await fsp.rm(rootDir, { recursive: true, force: true });
  });

  it('should find files by glob pattern', async () => {
    await fsp.mkdir(path.join(rootDir, 'src'), { recursive: true });
    await fsp.writeFile(path.join(rootDir, 'src', 'a.ts'), 'export const a = 1;', 'utf-8');
    await fsp.writeFile(path.join(rootDir, 'src', 'b.ts'), 'export const b = 2;', 'utf-8');
    await fsp.writeFile(path.join(rootDir, 'src', 'c.js'), 'module.exports = {};', 'utf-8');

    const result = await tool.execute(
      {
        pattern: '**/*.ts',
        path: rootDir,
        include_hidden: false,
        max_results: 200,
      },
      mockContext
    );

    expect(result.success).toBe(true);
    expect((result.data as { total: number }).total).toBe(2);
    expect((result.data as { files: string[] }).files.every((item) => item.endsWith('.ts'))).toBe(
      true
    );
  });

  it('should support include_hidden flag', async () => {
    await fsp.writeFile(path.join(rootDir, '.secret.ts'), 'export const secret = true;', 'utf-8');

    const hiddenOff = await tool.execute(
      {
        pattern: '**/*.ts',
        path: rootDir,
        include_hidden: false,
        max_results: 200,
      },
      mockContext
    );
    expect(hiddenOff.success).toBe(true);
    expect((hiddenOff.data as { total: number }).total).toBe(0);

    const hiddenOn = await tool.execute(
      {
        pattern: '**/*.ts',
        path: rootDir,
        include_hidden: true,
        max_results: 200,
      },
      mockContext
    );
    expect(hiddenOn.success).toBe(true);
    expect((hiddenOn.data as { total: number }).total).toBe(1);
  });

  it('should return truncated when max_results is reached', async () => {
    await fsp.mkdir(path.join(rootDir, 'files'), { recursive: true });
    for (let index = 0; index < 5; index += 1) {
      await fsp.writeFile(path.join(rootDir, 'files', `file-${index}.txt`), `${index}`, 'utf-8');
    }

    const result = await tool.execute(
      {
        pattern: '**/*.txt',
        path: rootDir,
        include_hidden: false,
        max_results: 3,
      },
      mockContext
    );

    expect(result.success).toBe(true);
    expect((result.data as { total: number }).total).toBe(3);
    expect((result.data as { truncated: boolean }).truncated).toBe(true);
  });

  it('should reject path outside allowed directories', async () => {
    const result = await tool.execute(
      {
        pattern: '**/*.ts',
        path: path.resolve(rootDir, '..'),
        include_hidden: false,
        max_results: 200,
      },
      mockContext
    );

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('SEARCH_PATH_NOT_ALLOWED');
  });
});

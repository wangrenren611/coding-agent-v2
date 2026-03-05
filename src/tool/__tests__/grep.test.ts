import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fsp } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { GrepTool } from '../grep';
import type { ToolExecutionContext } from '../types';

const mockContext: ToolExecutionContext = {
  toolCallId: 'grep-test-call',
  loopIndex: 0,
  stepIndex: 0,
  agent: {} as ToolExecutionContext['agent'],
};

const hasRipgrep = (() => {
  const probe = spawnSync('rg', ['--version'], { stdio: 'ignore' });
  return !probe.error && probe.status === 0;
})();

const itIfRipgrep = hasRipgrep ? it : it.skip;

describe('GrepTool', () => {
  let rootDir: string;
  let tool: GrepTool;
  const defaults = {
    case_mode: 'smart' as const,
    word: false,
    multiline: false,
    pcre2: false,
    include_hidden: false,
    no_ignore: false,
    timeout: 60000,
    max_files: 100,
    max_matches_per_file: 50,
  };

  beforeEach(async () => {
    rootDir = await fsp.mkdtemp(path.join(tmpdir(), 'grep-tool-'));
    tool = new GrepTool({ allowedDirectories: [rootDir] });
  });

  afterEach(async () => {
    await fsp.rm(rootDir, { recursive: true, force: true });
  });

  itIfRipgrep('should find matches in multiple files', async () => {
    await fsp.mkdir(path.join(rootDir, 'src'), { recursive: true });
    await fsp.writeFile(path.join(rootDir, 'src', 'a.ts'), 'const hello = "world";', 'utf-8');
    await fsp.writeFile(
      path.join(rootDir, 'src', 'b.ts'),
      'function hello() { return 1; }',
      'utf-8'
    );
    await fsp.writeFile(path.join(rootDir, 'src', 'c.txt'), 'nothing', 'utf-8');

    const result = await tool.execute(
      {
        ...defaults,
        pattern: 'hello',
        path: rootDir,
        file_pattern: '**/*.ts',
      },
      mockContext
    );

    expect(result.success).toBe(true);
    expect((result.data as { countFiles: number }).countFiles).toBe(2);
    expect((result.data as { countMatches: number }).countMatches).toBeGreaterThanOrEqual(2);
  });

  itIfRipgrep('should return success with no matches', async () => {
    await fsp.writeFile(path.join(rootDir, 'test.txt'), 'no matching text', 'utf-8');

    const result = await tool.execute(
      {
        ...defaults,
        pattern: 'THIS_PATTERN_DOES_NOT_EXIST_12345',
        path: rootDir,
      },
      mockContext
    );

    expect(result.success).toBe(true);
    expect((result.data as { countMatches: number }).countMatches).toBe(0);
  });

  itIfRipgrep('should respect max_files truncation', async () => {
    await fsp.mkdir(path.join(rootDir, 'src'), { recursive: true });
    for (let index = 0; index < 5; index += 1) {
      await fsp.writeFile(path.join(rootDir, 'src', `file-${index}.txt`), 'needle', 'utf-8');
    }

    const result = await tool.execute(
      {
        ...defaults,
        pattern: 'needle',
        path: rootDir,
        max_files: 2,
      },
      mockContext
    );

    expect(result.success).toBe(true);
    expect((result.data as { countFiles: number }).countFiles).toBe(2);
    expect((result.data as { truncated: boolean }).truncated).toBe(true);
  });

  it('should reject path outside allowed directories', async () => {
    const result = await tool.execute(
      {
        ...defaults,
        pattern: 'anything',
        path: path.resolve(rootDir, '..'),
      },
      mockContext
    );

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('SEARCH_PATH_NOT_ALLOWED');
  });
});

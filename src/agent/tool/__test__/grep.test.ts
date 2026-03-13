import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { rgPath as vscodeRgPath } from '@vscode/ripgrep';
import { GrepTool } from '../grep';

function hasExecutable(binary: string | undefined): boolean {
  if (!binary || !binary.trim()) {
    return false;
  }
  const probe = spawnSync(binary, ['--version'], { stdio: 'ignore' });
  return !probe.error && probe.status === 0;
}

const hasRipgrep = [process.env.RIPGREP_PATH, vscodeRgPath, 'rg'].some((candidate) =>
  hasExecutable(candidate)
);
const itIfRipgrep = hasRipgrep ? it : it.skip;

describe('GrepTool', () => {
  let rootDir: string;
  let tool: GrepTool;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-grep-tool-'));
    tool = new GrepTool({ allowedDirectories: [rootDir] });
  });

  afterEach(async () => {
    delete process.env.RIPGREP_PATH;
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  itIfRipgrep('finds matches in multiple files', async () => {
    await fs.mkdir(path.join(rootDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(rootDir, 'src', 'a.ts'), 'const hello = "world";', 'utf8');
    await fs.writeFile(path.join(rootDir, 'src', 'b.ts'), 'function hello() { return 1; }', 'utf8');
    await fs.writeFile(path.join(rootDir, 'src', 'c.txt'), 'nothing', 'utf8');

    const result = await tool.execute({
      pattern: 'hello',
      path: rootDir,
      glob: '**/*.ts',
      timeout_ms: 60000,
      max_results: 200,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('Found');

    const metadata = result.metadata as {
      countFiles: number;
      countMatches: number;
      truncated: boolean;
    };
    expect(metadata.countFiles).toBe(2);
    expect(metadata.countMatches).toBeGreaterThanOrEqual(2);
    expect(metadata.truncated).toBe(false);
  });

  itIfRipgrep('returns success with no matches', async () => {
    await fs.writeFile(path.join(rootDir, 'test.txt'), 'no matching text', 'utf8');

    const result = await tool.execute({
      pattern: 'THIS_PATTERN_DOES_NOT_EXIST_12345',
      path: rootDir,
      timeout_ms: 60000,
      max_results: 200,
    });

    expect(result.success).toBe(true);
    expect(result.output).toBe('No matches found');
    expect((result.metadata as { countMatches: number }).countMatches).toBe(0);
  });

  it('rejects path outside allowed directories', async () => {
    const result = await tool.execute({
      pattern: 'anything',
      path: path.resolve(rootDir, '..'),
      timeout_ms: 60000,
      max_results: 200,
    });

    expect(result.success).toBe(false);
    expect(result.output).toContain('SEARCH_PATH_NOT_ALLOWED');
  });

  it('exposes parallel-safe concurrency policy and lock key', () => {
    expect(tool.getConcurrencyMode()).toBe('parallel-safe');
    expect(
      tool.getConcurrencyLockKey({
        pattern: 'hello',
        path: rootDir,
        timeout_ms: 1000,
        max_results: 10,
      })
    ).toBe(`grep:${rootDir}:hello`);
  });

  it('falls back to default grep error code for non-prefixed errors', () => {
    const errorCode = (
      tool as unknown as { extractErrorCode: (text: string) => string }
    ).extractErrorCode('plain error');
    expect(errorCode).toBe('GREP_EXECUTION_ERROR');
  });

  it('runRipgrep helper returns enriched summary output envelope', async () => {
    const helper = tool as unknown as {
      runRipgrep: (
        bin: string,
        args: string[],
        rootPath: string,
        request: { pattern: string; timeout_ms: number; max_results: number },
        context?: { onChunk?: (chunk: unknown) => Promise<void> | void }
      ) => Promise<{ data: Record<string, unknown>; output: string }>;
    };

    const script = [
      'const lines = [',
      `'not-json',`,
      `'{"type":"match","data":{"path":{"text":"file1.ts"},"lines":{"text":"hello\\\\n"},"line_number":1,"submatches":[{"start":0}]}}',`,
      `'{"type":"match","data":{"path":{"text":"file2.ts"},"lines":{"text":"hello\\\\n"},"line_number":2,"submatches":[{"start":1}]}}'`,
      '];',
      'for (const line of lines) process.stdout.write(line + "\\n");',
    ].join('');

    const onChunk = vi.fn();
    const result = await helper.runRipgrep(
      process.execPath,
      ['-e', script],
      rootDir,
      { pattern: 'hello', timeout_ms: 3000, max_results: 2 },
      { onChunk }
    );

    expect((result.data as { truncated: boolean }).truncated).toBe(true);
    expect(result.output).toContain('(truncated)');
  });

  it('buildSuccessResult prefixes non-default message and includes aggregation hints', () => {
    const helper = tool as unknown as {
      buildSuccessResult: (
        map: Map<
          string,
          {
            file: string;
            matchCount: number;
            matches: Array<{ line: number | null; column: number | null; text: string }>;
          }
        >,
        total: number,
        options: {
          pattern: string;
          rootPath: string;
          truncated: boolean;
          timedOut: boolean;
          message: string;
        }
      ) => { data: Record<string, unknown>; output: string };
    };

    const map = new Map<
      string,
      {
        file: string;
        matchCount: number;
        matches: Array<{ line: number | null; column: number | null; text: string }>;
      }
    >();
    for (let i = 0; i < 25; i += 1) {
      map.set(`file-${i}`, {
        file: `file-${i}`,
        matchCount: 12,
        matches: [{ line: 1, column: 1, text: 'hello' }],
      });
    }

    const result = helper.buildSuccessResult(map, 300, {
      pattern: 'hello',
      rootPath: rootDir,
      truncated: true,
      timedOut: true,
      message: 'Search timed out',
    });

    expect(result.output.startsWith('Search timed out')).toBe(true);
    expect(result.output).toContain('... and 5 more files');
    expect((result.data as { timed_out: boolean }).timed_out).toBe(true);
  });
});

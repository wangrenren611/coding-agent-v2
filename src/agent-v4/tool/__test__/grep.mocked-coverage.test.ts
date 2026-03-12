import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GrepTool } from '../grep';

const { spawnMock, spawnSyncMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  spawnSyncMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));

vi.mock('@vscode/ripgrep', () => ({
  rgPath: '/mock/vscode-rg',
}));

function createChild(options: { withStdout?: boolean; withStderr?: boolean } = {}) {
  const child = new EventEmitter() as EventEmitter & {
    stdout?: PassThrough;
    stderr?: PassThrough;
    killed: boolean;
    kill: (signal?: string) => boolean;
  };
  if (options.withStdout !== false) {
    child.stdout = new PassThrough();
  }
  if (options.withStderr !== false) {
    child.stderr = new PassThrough();
  }
  child.killed = false;
  child.kill = vi.fn((): boolean => {
    child.killed = true;
    child.emit('close', 0, null);
    return true;
  }) as unknown as (signal?: string) => boolean;
  return child;
}

describe('GrepTool mocked branch coverage', () => {
  let rootDir: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-v4-grep-mocked-'));
    spawnMock.mockReset();
    spawnSyncMock.mockReset();
    spawnSyncMock.mockReturnValue({ status: 0, error: undefined });
    delete process.env.RIPGREP_PATH;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.RIPGREP_PATH;
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('returns RIPGREP_NOT_FOUND when all candidate probes fail', async () => {
    process.env.RIPGREP_PATH = 'env-rg';
    spawnSyncMock.mockReturnValue({
      status: 1,
      error: new Error('missing'),
    });

    const tool = new GrepTool({
      allowedDirectories: [rootDir],
      rgPath: 'custom-rg',
    });
    const result = await tool.execute({
      pattern: 'hello',
      path: rootDir,
      timeout_ms: 1000,
      max_results: 10,
    });

    expect(result.success).toBe(false);
    expect(result.output).toContain('RIPGREP_NOT_FOUND');
    expect((result.metadata as { error: string }).error).toBe('RIPGREP_NOT_FOUND');
  });

  it('maps non-Error execute failures using String(error)', async () => {
    const tool = new GrepTool({ allowedDirectories: [rootDir], rgPath: 'custom-rg' });
    const helper = tool as unknown as {
      runRipgrep: () => Promise<never>;
    };
    vi.spyOn(helper, 'runRipgrep').mockRejectedValueOnce('plain failure');

    const result = await tool.execute({
      pattern: 'hello',
      path: rootDir,
      timeout_ms: 1000,
      max_results: 10,
    });

    expect(result.success).toBe(false);
    expect(result.output).toBe('plain failure');
    expect((result.metadata as { error: string }).error).toBe('GREP_EXECUTION_ERROR');
  });

  it('covers parser fallbacks, stderr chunk handling, and max-results truncation', async () => {
    const tool = new GrepTool({ allowedDirectories: [rootDir] });
    const helper = tool as unknown as {
      runRipgrep: (
        ripgrepBinary: string,
        commandArgs: string[],
        rootPath: string,
        args: { pattern: string; timeout_ms: number; max_results: number },
        context?: { onChunk?: (chunk: unknown) => Promise<void> | void }
      ) => Promise<{ data: Record<string, unknown>; output: string }>;
    };

    const child = createChild();
    spawnMock.mockReturnValueOnce(child);

    const chunks: unknown[] = [];
    const run = helper.runRipgrep(
      'rg',
      ['--json'],
      rootDir,
      { pattern: 'hello', timeout_ms: 2000, max_results: 1 },
      {
        onChunk: async (chunk) => {
          chunks.push(chunk);
        },
      }
    );

    child.stderr?.emit('data', 'stderr-string');
    child.stderr?.write(Buffer.from('stderr-line'));
    child.stdout?.write('\n');
    child.stdout?.write('123\n');
    child.stdout?.write('{"type":"match","data":null}\n');
    child.stdout?.write(
      '{"type":"match","data":{"path":123,"lines":{"text":"skip\\n"},"line_number":3}}\n'
    );
    child.stdout?.write(
      '{"type":"match","data":{"path":{},"lines":{"text":"skip\\n"},"line_number":4}}\n'
    );
    child.stdout?.write(
      '{"type":"match","data":{"path":{"bytes":"ZmlsZS50cw=="},"lines":{"bytes":"aGVsbG8K"},"line_number":"x","submatches":"oops"}}\n'
    );
    child.stdout?.end();

    const result = await run;
    expect((result.data as { truncated: boolean }).truncated).toBe(true);
    expect(result.output).toContain('(truncated)');
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('covers stderr Buffer chunk decoding branch', async () => {
    const tool = new GrepTool({ allowedDirectories: [rootDir] });
    const helper = tool as unknown as {
      runRipgrep: (
        ripgrepBinary: string,
        commandArgs: string[],
        rootPath: string,
        args: { pattern: string; timeout_ms: number; max_results: number }
      ) => Promise<{ data: Record<string, unknown>; output: string }>;
    };

    const child = createChild();
    const stderrEmitter = new EventEmitter() as EventEmitter & {
      setEncoding: (encoding: string) => void;
    };
    stderrEmitter.setEncoding = vi.fn();
    child.stderr = stderrEmitter as unknown as PassThrough;
    spawnMock.mockReturnValueOnce(child);

    const run = helper.runRipgrep('rg', ['--json'], rootDir, {
      pattern: 'x',
      timeout_ms: 1000,
      max_results: 10,
    });

    stderrEmitter.emit('data', Buffer.from('stderr-buffer'));
    child.stdout?.end();
    child.emit('close', 1, null);

    const result = await run;
    expect(result.output).toBe('No matches found');
  });

  it('covers timeout branch and killChild catch branch', async () => {
    const tool = new GrepTool({ allowedDirectories: [rootDir] });
    const helper = tool as unknown as {
      runRipgrep: (
        ripgrepBinary: string,
        commandArgs: string[],
        rootPath: string,
        args: { pattern: string; timeout_ms: number; max_results: number }
      ) => Promise<{ data: Record<string, unknown>; output: string }>;
    };

    const child = createChild();
    child.kill = vi.fn((): boolean => {
      throw new Error('kill failed');
    }) as unknown as (signal?: string) => boolean;
    spawnMock.mockReturnValueOnce(child);

    const run = helper.runRipgrep('rg', ['--json'], rootDir, {
      pattern: 'slow',
      timeout_ms: 10,
      max_results: 100,
    });
    setTimeout(() => {
      child.stdout?.end();
      child.emit('close', null, 'SIGTERM');
    }, 30);

    const result = await run;
    expect(result.output).toContain('Search timed out after 10ms');
    expect((result.data as { timed_out: boolean }).timed_out).toBe(true);
  });

  it('throws RIPGREP_ERROR when stdout stream cannot be captured', async () => {
    const tool = new GrepTool({ allowedDirectories: [rootDir] });
    const helper = tool as unknown as {
      runRipgrep: (
        ripgrepBinary: string,
        commandArgs: string[],
        rootPath: string,
        args: { pattern: string; timeout_ms: number; max_results: number }
      ) => Promise<{ data: Record<string, unknown>; output: string }>;
    };

    const child = createChild({ withStdout: false });
    spawnMock.mockReturnValueOnce(child);

    await expect(
      helper.runRipgrep('rg', ['--json'], rootDir, {
        pattern: 'x',
        timeout_ms: 1000,
        max_results: 10,
      })
    ).rejects.toThrow('RIPGREP_ERROR: failed to capture ripgrep stdout stream');
  });

  it('throws RIPGREP_STREAM_ERROR on stdout stream failures', async () => {
    const tool = new GrepTool({ allowedDirectories: [rootDir] });
    const helper = tool as unknown as {
      runRipgrep: (
        ripgrepBinary: string,
        commandArgs: string[],
        rootPath: string,
        args: { pattern: string; timeout_ms: number; max_results: number }
      ) => Promise<{ data: Record<string, unknown>; output: string }>;
    };

    const child = createChild();
    spawnMock.mockReturnValueOnce(child);

    const run = helper.runRipgrep('rg', ['--json'], rootDir, {
      pattern: 'x',
      timeout_ms: 1000,
      max_results: 10,
    });

    child.stdout?.emit('error', new Error('stream exploded'));
    child.emit('close', 0, null);
    await expect(run).rejects.toThrow('RIPGREP_STREAM_ERROR: stream exploded');

    const secondChild = createChild();
    spawnMock.mockReturnValueOnce(secondChild);
    const secondRun = helper.runRipgrep('rg', ['--json'], rootDir, {
      pattern: 'x',
      timeout_ms: 1000,
      max_results: 10,
    });
    secondChild.stdout?.emit('error', 'string-stream-error');
    secondChild.emit('close', 0, null);
    await expect(secondRun).rejects.toThrow('RIPGREP_STREAM_ERROR: string-stream-error');
  });

  it('throws signal and exit-code errors from ripgrep process', async () => {
    const tool = new GrepTool({ allowedDirectories: [rootDir] });
    const helper = tool as unknown as {
      runRipgrep: (
        ripgrepBinary: string,
        commandArgs: string[],
        rootPath: string,
        args: { pattern: string; timeout_ms: number; max_results: number }
      ) => Promise<{ data: Record<string, unknown>; output: string }>;
    };

    const signalChild = createChild();
    spawnMock.mockReturnValueOnce(signalChild);
    const signalRun = helper.runRipgrep('rg', ['--json'], rootDir, {
      pattern: 'x',
      timeout_ms: 1000,
      max_results: 10,
    });
    signalChild.stdout?.end();
    signalChild.emit('close', null, 'SIGTERM');
    await expect(signalRun).rejects.toThrow('RIPGREP_ERROR: ripgrep terminated by signal SIGTERM');

    const code2Child = createChild();
    spawnMock.mockReturnValueOnce(code2Child);
    const code2Run = helper.runRipgrep('rg', ['--json'], rootDir, {
      pattern: 'x',
      timeout_ms: 1000,
      max_results: 10,
    });
    code2Child.stderr?.write('bad regex');
    code2Child.stdout?.end();
    code2Child.emit('close', 2, null);
    await expect(code2Run).rejects.toThrow('RIPGREP_ERROR: bad regex');

    const code2FallbackChild = createChild();
    spawnMock.mockReturnValueOnce(code2FallbackChild);
    const code2FallbackRun = helper.runRipgrep('rg', ['--json'], rootDir, {
      pattern: 'x',
      timeout_ms: 1000,
      max_results: 10,
    });
    code2FallbackChild.stdout?.end();
    code2FallbackChild.emit('close', 2, null);
    await expect(code2FallbackRun).rejects.toThrow('RIPGREP_ERROR: ripgrep execution failed');

    const code5Child = createChild();
    spawnMock.mockReturnValueOnce(code5Child);
    const code5Run = helper.runRipgrep('rg', ['--json'], rootDir, {
      pattern: 'x',
      timeout_ms: 1000,
      max_results: 10,
    });
    code5Child.stdout?.end();
    code5Child.emit('close', 5, null);
    await expect(code5Run).rejects.toThrow('RIPGREP_ERROR: ripgrep exited with code 5');
  });

  it('covers decodeTextField base64 catch path with mocked Buffer.from failure', async () => {
    const tool = new GrepTool({ allowedDirectories: [rootDir] });
    const helper = tool as unknown as {
      runRipgrep: (
        ripgrepBinary: string,
        commandArgs: string[],
        rootPath: string,
        args: { pattern: string; timeout_ms: number; max_results: number }
      ) => Promise<{ data: Record<string, unknown>; output: string }>;
    };

    const originalBufferFrom = Buffer.from.bind(Buffer);
    const originalBufferFromString = originalBufferFrom as unknown as (
      value: string,
      encoding?: BufferEncoding
    ) => Buffer;
    const originalBufferFromBytes = originalBufferFrom as unknown as (
      value: ArrayLike<number>
    ) => Buffer;
    const bufferSpy = vi.spyOn(Buffer, 'from').mockImplementation(((
      value: string | ArrayBuffer | SharedArrayBuffer | ArrayBufferView,
      encodingOrOffset?: BufferEncoding | number,
      length?: number
    ) => {
      if (encodingOrOffset === 'base64') {
        throw new Error('bad-base64');
      }
      if (typeof value === 'string') {
        return originalBufferFromString(value, encodingOrOffset as BufferEncoding | undefined);
      }
      if (typeof encodingOrOffset === 'number') {
        return originalBufferFromBytes(
          new Uint8Array(value as ArrayBuffer | SharedArrayBuffer).subarray(
            encodingOrOffset,
            typeof length === 'number' ? encodingOrOffset + length : undefined
          )
        );
      }
      if (ArrayBuffer.isView(value)) {
        return originalBufferFromBytes(
          new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
        );
      }
      return originalBufferFromBytes(new Uint8Array(value as ArrayBuffer | SharedArrayBuffer));
    }) as typeof Buffer.from);

    const child = createChild();
    spawnMock.mockReturnValueOnce(child);
    const run = helper.runRipgrep('rg', ['--json'], rootDir, {
      pattern: 'x',
      timeout_ms: 1000,
      max_results: 10,
    });

    child.stdout?.write(
      '{"type":"match","data":{"path":{"bytes":"bm90LXVzZWQ="},"lines":{"text":"line\\n"},"line_number":1,"submatches":[{"start":0}]}}\n'
    );
    child.stdout?.end();
    child.emit('close', 1, null);

    const result = await run;
    expect(result.output).toBe('No matches found');
    bufferSpy.mockRestore();
  });

  it('covers line label fallback and lock-key cwd fallback', () => {
    const tool = new GrepTool({ allowedDirectories: [rootDir] });
    const helper = tool as unknown as {
      buildSuccessResult: (
        fileMap: Map<
          string,
          {
            file: string;
            matchCount: number;
            matches: Array<{ line: number | null; column: number | null; text: string }>;
          }
        >,
        totalMatches: number,
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
    >([
      [
        'a.ts',
        {
          file: 'a.ts',
          matchCount: 1,
          matches: [{ line: null, column: null, text: 'hello' }],
        },
      ],
    ]);

    const built = helper.buildSuccessResult(map, 1, {
      pattern: 'hello',
      rootPath: rootDir,
      truncated: false,
      timedOut: false,
      message: 'Search completed',
    });
    expect(built.output).toContain('Line ?');

    const lockKey = tool.getConcurrencyLockKey({
      pattern: 'hello',
      timeout_ms: 1000,
      max_results: 10,
    });
    expect(lockKey).toBe(`grep:${process.cwd()}:hello`);
  });
});

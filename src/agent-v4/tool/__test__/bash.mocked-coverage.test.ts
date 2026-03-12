import { EventEmitter } from 'node:events';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnMock, spawnSyncMock, existsSyncMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  spawnSyncMock: vi.fn(),
  existsSyncMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: existsSyncMock,
  };
});

import { BashTool } from '../bash';

const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value,
  });
}

function restorePlatform(): void {
  if (originalPlatformDescriptor) {
    Object.defineProperty(process, 'platform', originalPlatformDescriptor);
  }
}

function createChild(options: { withStdout?: boolean; withStderr?: boolean; pid?: number } = {}) {
  const child = new EventEmitter() as EventEmitter & {
    stdout?: PassThrough;
    stderr?: PassThrough;
    pid?: number;
    killed: boolean;
    kill: (signal?: string) => boolean;
    unref: () => void;
  };
  if (options.withStdout !== false) {
    child.stdout = new PassThrough();
  }
  if (options.withStderr !== false) {
    child.stderr = new PassThrough();
  }
  child.pid = options.pid ?? 4242;
  child.killed = false;
  child.kill = vi.fn((): boolean => {
    child.killed = true;
    return true;
  }) as unknown as (signal?: string) => boolean;
  child.unref = vi.fn() as unknown as () => void;
  return child;
}

describe('BashTool mocked branch coverage', () => {
  beforeEach(() => {
    spawnMock.mockReset();
    spawnSyncMock.mockReset();
    existsSyncMock.mockReset();
    existsSyncMock.mockReturnValue(false);
    spawnSyncMock.mockReturnValue({ status: 1, stdout: '' });
    delete process.env.BASH_TOOL_SHELL;
    delete process.env.BASH_TOOL_POLICY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    restorePlatform();
    delete process.env.BASH_TOOL_SHELL;
    delete process.env.BASH_TOOL_POLICY;
  });

  it('denies empty commands and uses fallback deny reason when policy reason is missing', async () => {
    const tool = new BashTool();
    const empty = await tool.execute({ command: '   ' });
    expect(empty.success).toBe(false);
    expect(empty.output).toContain('Command is empty');

    const helper = tool as unknown as {
      validatePolicy: (command: string) => { effect: 'allow' | 'ask' | 'deny'; reason?: string };
    };
    vi.spyOn(helper, 'validatePolicy').mockReturnValueOnce({ effect: 'deny' });
    const denied = await tool.execute({ command: 'echo x' });
    expect(denied.success).toBe(false);
    expect(denied.output).toContain('Command not allowed');
  });

  it('covers background unknown pid and non-Error execution failure mapping', async () => {
    const tool = new BashTool();
    const helper = tool as unknown as {
      executeInBackground: (command: string) => Promise<{ pid?: number; logPath: string }>;
      executeForeground: () => Promise<never>;
    };
    vi.spyOn(helper, 'executeInBackground').mockResolvedValueOnce({ logPath: 'bg.log' });
    const bg = await tool.execute({ command: 'echo bg', run_in_background: true });
    expect(bg.success).toBe(true);
    expect(bg.output).toContain('pid=unknown');

    vi.spyOn(helper, 'executeForeground').mockRejectedValueOnce('STRING_FAILURE');
    const failed = await tool.execute({ command: 'echo fg' });
    expect(failed.success).toBe(false);
    expect(failed.output).toBe('EXECUTION_FAILED: STRING_FAILURE');
  });

  it('covers executeForeground fail path and finish guard path', async () => {
    const tool = new BashTool();
    const helper = tool as unknown as {
      executeForeground: (
        command: string,
        timeoutMs: number,
        abortSignal?: AbortSignal
      ) => Promise<{ exitCode: number; output: string; timedOut: boolean }>;
    };

    const child = createChild();
    spawnMock.mockReturnValueOnce(child);

    const run = helper.executeForeground('echo x', 0);
    child.emit('error', new Error('spawn failed'));
    child.emit('close', 1, null);
    await expect(run).rejects.toThrow('spawn failed');
  });

  it('covers executeForeground fail guard branch after successful close', async () => {
    const tool = new BashTool();
    const helper = tool as unknown as {
      executeForeground: (
        command: string,
        timeoutMs: number,
        abortSignal?: AbortSignal
      ) => Promise<{ exitCode: number; output: string; timedOut: boolean }>;
    };

    const child = createChild();
    spawnMock.mockReturnValueOnce(child);
    const run = helper.executeForeground('echo ok', 0);
    child.emit('close', 0, null);
    const result = await run;
    expect(result.exitCode).toBe(0);

    child.emit('error', new Error('late error should be ignored'));
  });

  it('covers executeForeground abort branches (already aborted + listener)', async () => {
    const tool = new BashTool();
    const helper = tool as unknown as {
      executeForeground: (
        command: string,
        timeoutMs: number,
        abortSignal?: AbortSignal
      ) => Promise<{ exitCode: number; output: string; timedOut: boolean }>;
      terminateChildProcess: (child: unknown) => void;
    };
    vi.spyOn(helper, 'terminateChildProcess').mockImplementation(() => {});

    const firstChild = createChild();
    spawnMock.mockReturnValueOnce(firstChild);
    const firstAbort = new AbortController();
    firstAbort.abort();
    const firstRun = helper.executeForeground('echo first', 0, firstAbort.signal);
    firstChild.emit('close', null, null);
    const firstResult = await firstRun;
    expect(firstResult.timedOut).toBe(true);

    const secondChild = createChild();
    spawnMock.mockReturnValueOnce(secondChild);
    const secondAbort = new AbortController();
    const secondRun = helper.executeForeground('echo second', 0, secondAbort.signal);
    secondAbort.abort();
    secondChild.emit('close', 0, null);
    const secondResult = await secondRun;
    expect(secondResult.timedOut).toBe(true);
  });

  it('covers executeForeground close fallback exitCode branch', async () => {
    const tool = new BashTool();
    const helper = tool as unknown as {
      executeForeground: (
        command: string,
        timeoutMs: number,
        abortSignal?: AbortSignal
      ) => Promise<{ exitCode: number; output: string; timedOut: boolean }>;
    };
    const child = createChild();
    spawnMock.mockReturnValueOnce(child);

    const run = helper.executeForeground('echo fallback', 0);
    child.emit('close', null, null);
    const result = await run;
    expect(result.exitCode).toBe(0);
  });

  it('covers executeForeground signal-based exit code fallback', async () => {
    const tool = new BashTool();
    const helper = tool as unknown as {
      executeForeground: (
        command: string,
        timeoutMs: number,
        abortSignal?: AbortSignal
      ) => Promise<{ exitCode: number; output: string; timedOut: boolean }>;
    };
    const child = createChild();
    spawnMock.mockReturnValueOnce(child);

    const run = helper.executeForeground('echo signal', 0);
    child.emit('close', null, 'SIGTERM');
    const result = await run;
    expect(result.exitCode).toBe(1);
  });

  it('covers executeForeground timeout callback branch', async () => {
    vi.useFakeTimers();
    const tool = new BashTool();
    const helper = tool as unknown as {
      executeForeground: (
        command: string,
        timeoutMs: number,
        abortSignal?: AbortSignal
      ) => Promise<{ exitCode: number; output: string; timedOut: boolean }>;
      terminateChildProcess: (child: unknown) => void;
    };
    const terminateSpy = vi.spyOn(helper, 'terminateChildProcess').mockImplementation(() => {});

    const child = createChild();
    spawnMock.mockReturnValueOnce(child);

    const run = helper.executeForeground('echo timeout', 50);
    await vi.advanceTimersByTimeAsync(50);
    child.emit('close', 0, null);
    const result = await run;

    expect(result.timedOut).toBe(true);
    expect(terminateSpy).toHaveBeenCalled();
  });

  it('covers executeInBackground non-win log quoting branch', async () => {
    setPlatform('linux');
    const bgDir = await fsp.mkdtemp(path.join(os.tmpdir(), "bash-bg-'"));
    const tool = new BashTool({ backgroundLogDir: bgDir });
    const helper = tool as unknown as {
      executeInBackground: (command: string) => Promise<{ pid?: number; logPath: string }>;
    };

    const child = createChild();
    spawnMock.mockReturnValueOnce(child);

    const result = await helper.executeInBackground('echo hello');
    expect(result.logPath).toContain('agent-bash-bg-');
    expect(child.unref).toHaveBeenCalled();
  });

  it('covers resolveShell windows cmd fallback and git-bash branch', () => {
    setPlatform('win32');
    const tool = new BashTool();
    const helper = tool as unknown as {
      resolveShell: (command: string) => { shellPath: string; shellArgs: string[] };
      findGitBashPath: () => string | null;
    };

    vi.spyOn(helper, 'findGitBashPath').mockReturnValueOnce('C:\\Git\\bin\\bash.exe');
    const gitBashShell = helper.resolveShell('echo hi');
    expect(gitBashShell.shellPath).toBe('C:\\Git\\bin\\bash.exe');

    const originalComspec = process.env.COMSPEC;
    delete process.env.COMSPEC;
    vi.spyOn(helper, 'findGitBashPath').mockReturnValueOnce(null);
    const cmdShell = helper.resolveShell('echo hi');
    expect(cmdShell.shellPath).toBe('cmd.exe');
    process.env.COMSPEC = originalComspec;
  });

  it('covers findGitBashPath non-win, inferred probe, probe catch, and probe miss', () => {
    const tool = new BashTool();
    const helper = tool as unknown as { findGitBashPath: () => string | null };

    setPlatform('linux');
    expect(helper.findGitBashPath()).toBeNull();

    setPlatform('win32');
    spawnSyncMock.mockReturnValueOnce({
      status: 0,
      stdout: 'C:\\Tools\\Git\\cmd\\git.exe\r\n',
    });
    existsSyncMock.mockImplementation((candidate: string) => {
      if (candidate === 'C:\\Tools\\Git\\cmd\\git.exe') {
        return true;
      }
      return candidate.replaceAll('/', '\\').endsWith('Tools\\Git\\bin\\bash.exe');
    });
    expect(helper.findGitBashPath()).toBeNull();

    existsSyncMock.mockReturnValue(false);
    spawnSyncMock.mockImplementationOnce(() => {
      throw new Error('where failed');
    });
    expect(helper.findGitBashPath()).toBeNull();

    spawnSyncMock.mockReset();
    spawnSyncMock.mockReturnValueOnce({ status: 1, stdout: '' });
    expect(helper.findGitBashPath()).toBeNull();
  });

  it('covers terminateChildProcess windows catch and unix fallback catch paths', () => {
    const tool = new BashTool();
    type KillableChild = {
      pid?: number;
      killed: boolean;
      kill: (signal?: string) => boolean;
    };
    const helper = tool as unknown as { terminateChildProcess: (child: KillableChild) => void };

    setPlatform('win32');
    spawnMock.mockImplementationOnce(() => {
      throw new Error('taskkill failed');
    });
    helper.terminateChildProcess({
      pid: 100,
      killed: false,
      kill: vi.fn(),
    });

    setPlatform('linux');
    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('kill failed');
    });
    const child: KillableChild = {
      pid: 200,
      killed: false,
      kill: vi.fn(() => {
        throw new Error('child kill failed');
      }),
    };
    helper.terminateChildProcess(child);
    vi.advanceTimersByTime(250);
    expect(killSpy).toHaveBeenCalled();
    expect(child.kill).toHaveBeenCalled();
  });

  it('covers constructor fallback for invalid default timeout option', () => {
    const invalid = new BashTool({ defaultTimeoutMs: -1 });
    const invalidHelper = invalid as unknown as { defaultTimeoutMs: number };
    expect(invalidHelper.defaultTimeoutMs).toBe(60000);

    const valid = new BashTool({ defaultTimeoutMs: 1234 });
    const validHelper = valid as unknown as { defaultTimeoutMs: number };
    expect(validHelper.defaultTimeoutMs).toBe(1234);
  });

  it('covers hard-cut truncation branch for tiny output budgets', () => {
    const tool = new BashTool({ maxOutputLength: 16 });
    const helper = tool as unknown as {
      truncateOutput: (output: string) => { output: string; truncated: boolean };
    };
    const result = helper.truncateOutput('x'.repeat(100));
    expect(result.truncated).toBe(true);
    expect(result.output.length).toBe(16);
  });
});

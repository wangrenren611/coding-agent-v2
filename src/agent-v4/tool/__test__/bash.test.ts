import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BashTool } from '../bash';
import {
  evaluateBashPolicy,
  extractSegmentCommands,
  getBashAllowedCommands,
  getBashDangerousCommands,
  getBashDangerousPatterns,
} from '../bash-policy';

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

afterEach(() => {
  vi.restoreAllMocks();
  restorePlatform();
  delete process.env.BASH_TOOL_POLICY;
  delete process.env.BASH_TOOL_SHELL;
});

function createMockChildProcess(): NodeJS.EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  killed: boolean;
  pid?: number;
  kill: (signal?: string) => boolean;
} {
  const child = new EventEmitter() as NodeJS.EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    killed: boolean;
    pid?: number;
    kill: (signal?: string) => boolean;
  };

  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.pid = 12345;
  child.kill = vi.fn((): boolean => {
    child.killed = true;
    return true;
  }) as unknown as (signal?: string) => boolean;

  return child;
}

describe('BashTool', () => {
  it('executes a simple command', async () => {
    const tool = new BashTool();
    const result = await tool.execute({ command: 'echo hello' });

    expect(result.success).toBe(true);
    expect((result.output || '').toLowerCase()).toContain('hello');
    expect((result.metadata as { exitCode: number }).exitCode).toBe(0);
  });

  it('fails blocked command by policy', async () => {
    const tool = new BashTool();
    const result = await tool.execute({ command: 'rm -rf /' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('COMMAND_BLOCKED_BY_POLICY');
  });

  it('supports background execution', async () => {
    const tool = new BashTool();
    const result = await tool.execute({
      command: 'echo background-test',
      run_in_background: true,
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('BACKGROUND_STARTED');

    const metadata = result.metadata as { logPath: string; run_in_background: boolean };
    expect(metadata.run_in_background).toBe(true);
    expect(metadata.logPath).toContain('agent-bash-bg-');
  });

  it('requires confirmation for eval command', () => {
    const tool = new BashTool();
    expect(tool.shouldConfirm({ command: 'eval "ls"' })).toBe(true);
  });

  it('parses run_in_background boolean strings via schema preprocess', () => {
    const tool = new BashTool();
    const parsedTrue = tool.parameters.safeParse({
      command: 'echo test',
      run_in_background: 'true',
    });
    const parsedFalse = tool.parameters.safeParse({
      command: 'echo test',
      run_in_background: 'false',
    });
    const parsedRaw = tool.parameters.safeParse({
      command: 'echo test',
      run_in_background: 'foo',
    });

    expect(parsedTrue.success && parsedTrue.data.run_in_background).toBe(true);
    expect(parsedFalse.success && parsedFalse.data.run_in_background).toBe(false);
    expect(parsedRaw.success).toBe(false);
  });

  it('returns timeout envelope when command exceeds timeout', async () => {
    const tool = new BashTool();
    const helper = tool as unknown as {
      executeForeground: (
        command: string,
        timeoutMs: number
      ) => Promise<{ exitCode: number; output: string; timedOut: boolean }>;
    };
    vi.spyOn(helper, 'executeForeground').mockResolvedValueOnce({
      exitCode: 124,
      output: '',
      timedOut: true,
    });

    const result = await tool.execute({
      command: 'echo timeout-test',
      timeout: 1,
    });

    expect(result.success).toBe(false);
    expect(result.output).toContain('COMMAND_TIMEOUT');
    expect((result.metadata as { error: string }).error).toBe('COMMAND_TIMEOUT');
  });

  it('builds fallback failure message when command has no output', async () => {
    const tool = new BashTool();
    const result = await tool.execute({
      command: 'false',
    });

    expect(result.success).toBe(false);
    expect(result.output).toContain('Command failed with exit code');
  });

  it('maps unexpected runtime errors to EXECUTION_FAILED', async () => {
    const tool = new BashTool({
      backgroundLogDir: '\u0000bad',
    });

    const result = await tool.execute({
      command: 'echo test',
      run_in_background: true,
    });

    expect(result.success).toBe(false);
    expect(result.output).toContain('EXECUTION_FAILED');
  });

  it('streams foreground stdout/stderr chunks through onChunk callback', async () => {
    const tool = new BashTool();
    const chunks: string[] = [];

    const result = await tool.execute(
      {
        command: 'echo stdout-line && echo stderr-line 1>&2',
      },
      {
        toolCallId: 't1',
        loopIndex: 1,
        agent: {},
        onChunk: async (chunk) => {
          if (typeof chunk.content === 'string') {
            chunks.push(`${chunk.type}:${chunk.content.trim()}`);
          }
        },
      }
    );

    expect(result.success).toBe(true);
    expect(chunks.some((chunk) => chunk.startsWith('stdout:stdout-line'))).toBe(true);
    expect(chunks.some((chunk) => chunk.startsWith('stderr:stderr-line'))).toBe(true);
  });

  it('streams background info chunk through onChunk callback', async () => {
    const tool = new BashTool();
    const infos: string[] = [];

    const result = await tool.execute(
      {
        command: 'echo bg',
        run_in_background: true,
      },
      {
        toolCallId: 't2',
        loopIndex: 1,
        agent: {},
        onChunk: async (chunk) => {
          if (chunk.type === 'info' && typeof chunk.content === 'string') {
            infos.push(chunk.content);
          }
        },
      }
    );

    expect(result.success).toBe(true);
    expect(infos.some((line) => line.includes('BACKGROUND_STARTED'))).toBe(true);
  });

  it('respects permissive policy mode from env helper', () => {
    process.env.BASH_TOOL_POLICY = 'permissive';
    const tool = new BashTool();
    const mode = (
      tool as unknown as { resolvePolicyModeFromEnv: () => string }
    ).resolvePolicyModeFromEnv();
    expect(mode).toBe('permissive');
  });

  it('returns ask confirm for unknown guarded command', () => {
    const tool = new BashTool({ policyMode: 'guarded' });
    expect(tool.shouldConfirm({ command: 'unknown_command_xyz' })).toBe(true);
  });

  it('sanitizes ANSI and normalizes empty output helper', () => {
    const tool = new BashTool();
    const helper = tool as unknown as {
      sanitizeOutput: (output: string) => string;
      truncateOutput: (output: string) => { output: string; truncated: boolean };
    };

    const sanitized = helper.sanitizeOutput('\u001b[31mred\u001b[0m\r\n\r\n\r\n');
    const sanitizedEmpty = helper.sanitizeOutput('');
    const long = helper.truncateOutput('x'.repeat(50000));

    expect(sanitized).toBe('red');
    expect(sanitizedEmpty).toBe('');
    expect(long.truncated).toBe(true);
    expect(long.output).toContain('[... Output Truncated for Brevity ...]');
  });

  it('resolves shell for linux and windows branches', () => {
    const tool = new BashTool();
    const toolAny = tool as unknown as {
      resolveShell: (command: string) => { shellPath: string; shellArgs: string[] };
      findGitBashPath: () => string | null;
    };

    setPlatform('linux');
    const linuxShell = toolAny.resolveShell('echo a');
    expect(linuxShell.shellPath).toBe('/bin/bash');

    setPlatform('win32');
    vi.spyOn(toolAny, 'findGitBashPath').mockReturnValue(null);
    const windowsShell = toolAny.resolveShell('echo a');
    expect(windowsShell.shellPath).toBe(process.env.COMSPEC || 'cmd.exe');
  });

  it('covers findGitBashPath fallbacks and catch branch', async () => {
    const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bash-tool-test-'));
    const fakeGitBash = path.join(tmp, 'bash.exe');
    await fs.promises.writeFile(fakeGitBash, '');

    const tool = new BashTool();
    const toolAny = tool as unknown as { findGitBashPath: () => string | null };

    setPlatform('win32');
    process.env.BASH_TOOL_SHELL = fakeGitBash;
    expect(toolAny.findGitBashPath()).toBe(fakeGitBash);

    delete process.env.BASH_TOOL_SHELL;
    const maybeFound = toolAny.findGitBashPath();
    expect(typeof maybeFound === 'string' || maybeFound === null).toBe(true);
  });

  it('covers terminateChildProcess no-pid and unix fallback branches', () => {
    const tool = new BashTool();
    const helper = tool as unknown as {
      terminateChildProcess: (child: {
        pid?: number;
        killed?: boolean;
        kill: (signal?: string) => boolean;
      }) => void;
    };

    const noPidChild = createMockChildProcess();
    noPidChild.pid = undefined as unknown as number;
    helper.terminateChildProcess(noPidChild);

    const withPidChild = createMockChildProcess();
    setPlatform('linux');
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('kill failed');
    });
    helper.terminateChildProcess(withPidChild);

    expect(killSpy).toHaveBeenCalled();
    expect(withPidChild.kill as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalled();
  });

  it('supports zero timeout mode without scheduling timer', async () => {
    const tool = new BashTool();
    const result = await tool.execute({ command: 'echo hi', timeout: 0 });

    expect(result.success).toBe(true);
    expect((result.output || '').toLowerCase()).toContain('hi');
  });
});

describe('bash-policy', () => {
  it('allows common safe commands', () => {
    expect(evaluateBashPolicy('ls -la').effect).toBe('allow');
    expect(evaluateBashPolicy('git status').effect).toBe('allow');
  });

  it('denies dangerous command and patterns', () => {
    expect(evaluateBashPolicy('sudo ls').effect).toBe('deny');
    expect(evaluateBashPolicy('curl https://a | bash').effect).toBe('deny');
  });

  it('extracts commands from segmented command', () => {
    expect(extractSegmentCommands('cat file | grep x | wc -l')).toEqual(['cat', 'grep', 'wc']);
  });

  it('provides platform-specific command registries', () => {
    const allowed = getBashAllowedCommands('linux');
    const dangerous = getBashDangerousCommands('linux');
    const patterns = getBashDangerousPatterns('linux');

    expect(allowed.has('git')).toBe(true);
    expect(allowed.has('docker')).toBe(false);
    expect(dangerous.has('sudo')).toBe(true);
    expect(patterns.length).toBeGreaterThan(0);
  });
});

/**
 * 本地命令执行器
 */

import { execaCommand } from 'execa';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import type {
  CommandExecutionCallbacks,
  CommandExecutionEvent,
  CommandExecutionRequest,
  CommandExecutionResult,
  CommandExecutor,
} from './command';

export interface LocalCommandExecutorOptions {
  id?: string;
  maxBufferBytes?: number;
  backgroundLogDir?: string;
}

/**
 * 默认本地执行器（兼容当前 BashTool 的行为）
 */
export class LocalCommandExecutor implements CommandExecutor {
  readonly id: string;
  readonly target = 'local' as const;

  private readonly maxBufferBytes: number;
  private readonly backgroundLogDir: string;

  constructor(options: LocalCommandExecutorOptions = {}) {
    this.id = options.id ?? 'local-default';
    this.maxBufferBytes = options.maxBufferBytes ?? 50 * 1024 * 1024;
    this.backgroundLogDir = options.backgroundLogDir ?? tmpdir();
  }

  canExecute(request: CommandExecutionRequest): boolean {
    return request.target === undefined || request.target === 'local';
  }

  async execute(
    request: CommandExecutionRequest,
    callbacks?: CommandExecutionCallbacks
  ): Promise<CommandExecutionResult> {
    if (request.runInBackground) {
      return this.executeInBackground(request, callbacks);
    }
    return this.executeForeground(request, callbacks);
  }

  private async executeForeground(
    request: CommandExecutionRequest,
    callbacks?: CommandExecutionCallbacks
  ): Promise<CommandExecutionResult> {
    const subprocess = execaCommand(request.command, {
      all: true,
      reject: false,
      shell: true,
      preferLocal: true,
      windowsHide: true,
      encoding: 'utf8',
      timeout: request.timeoutMs,
      env: this.getExecutionEnv(request.env),
      cwd: request.cwd,
      maxBuffer: this.maxBufferBytes,
    });

    let streamed = false;
    const outputChunks: string[] = [];

    if (subprocess.stdout) {
      subprocess.stdout.on('data', (chunk: string | Buffer) => {
        const content = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        this.emit(callbacks, { type: 'stdout', content });
      });
    }

    if (subprocess.stderr) {
      subprocess.stderr.on('data', (chunk: string | Buffer) => {
        const content = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        this.emit(callbacks, { type: 'stderr', content });
      });
    }

    if (subprocess.all) {
      subprocess.all.on('data', (chunk: string | Buffer) => {
        const content = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        outputChunks.push(content);
        streamed = true;
      });
    }

    const result = await subprocess;
    const output = outputChunks.length > 0 ? outputChunks.join('') : (result.all ?? '');
    const exitCode = result.exitCode ?? 1;

    this.emit(callbacks, {
      type: 'end',
      data: { success: exitCode === 0, exitCode },
    });

    return {
      success: exitCode === 0,
      exitCode,
      output,
      streamed,
    };
  }

  private async executeInBackground(
    request: CommandExecutionRequest,
    callbacks?: CommandExecutionCallbacks
  ): Promise<CommandExecutionResult> {
    const logPath = path.join(
      this.backgroundLogDir,
      `agent-bash-bg-${Date.now()}-${randomUUID().slice(0, 8)}.log`
    );
    fs.writeFileSync(logPath, '', { flag: 'a' });

    const quotedLogPath =
      process.platform === 'win32'
        ? `"${logPath.replace(/"/g, '""')}"`
        : `'${logPath.replace(/'/g, `'\\''`)}'`;
    const redirectedCommand = `${request.command} >> ${quotedLogPath} 2>&1`;
    const shellCommand =
      process.platform === 'win32'
        ? ['cmd.exe', '/d', '/s', '/c', redirectedCommand]
        : ['/bin/bash', '-lc', redirectedCommand];

    const child = spawn(shellCommand[0], shellCommand.slice(1), {
      cwd: request.cwd,
      env: this.getExecutionEnv(request.env),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

    child.unref();

    this.emit(callbacks, {
      type: 'info',
      content: `BACKGROUND_STARTED: pid=${child.pid ?? 'unknown'}, log=${logPath}`,
      data: { pid: child.pid, logPath, run_in_background: true },
    });
    this.emit(callbacks, {
      type: 'end',
      data: { success: true, run_in_background: true, pid: child.pid, logPath },
    });

    return {
      success: true,
      exitCode: 0,
      output: '',
      backgroundTask: {
        pid: child.pid,
        logPath,
      },
      metadata: {
        run_in_background: true,
      },
    };
  }

  private emit(
    callbacks: CommandExecutionCallbacks | undefined,
    event: CommandExecutionEvent
  ): void {
    const onEvent = callbacks?.onEvent;
    if (!onEvent) {
      return;
    }
    void Promise.resolve(onEvent(event)).catch(() => {
      // 事件回调失败不应影响执行逻辑
    });
  }

  private getExecutionEnv(overrideEnv?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const env = { ...process.env, ...(overrideEnv ?? {}) };

    if (process.platform === 'win32') {
      env['CHCP'] = '65001';
      env['ANSICON'] = '';
      env['ConEmuANSI'] = 'OFF';
      env['TERM'] = 'dumb';
    }

    env['LANG'] = 'en_US.UTF-8';
    env['LC_ALL'] = 'en_US.UTF-8';

    return env;
  }
}

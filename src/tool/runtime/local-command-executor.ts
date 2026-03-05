/**
 * 本地命令执行器
 */

import { spawn, execSync, type ChildProcess } from 'child_process';
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

import type { BackgroundTaskInfo } from './command';

export interface LocalCommandExecutorOptions {
  id?: string;
  maxBufferBytes?: number;
  backgroundLogDir?: string;
}

/**
 * Windows 上 Git Bash 的常见安装路径（作为回退）
 */
const GIT_BASH_FALLBACK_PATHS = [
  'C:/Program Files/Git/bin/bash.exe',
  'C:/Program Files (x86)/Git/bin/bash.exe',
];

/**
 * SIGTERM 到 SIGKILL 的超时时间（毫秒）
 */
const SIGKILL_TIMEOUT_MS = 200;

/**
 * 通过 git 命令位置推断 bash.exe 路径
 */
function inferBashFromGitPath(gitPath: string): string | null {
  let realPath = gitPath;
  try {
    realPath = fs.realpathSync(gitPath);
  } catch {
    // 忽略错误，使用原路径
  }

  const gitDir = path.dirname(realPath);
  const gitRoot = path.dirname(gitDir);

  // 尝试 Git/bin/bash.exe
  const bashPath = path.join(gitRoot, 'bin', 'bash.exe');
  if (fs.existsSync(bashPath)) {
    return bashPath;
  }
  // 尝试 Git/usr/bin/bash.exe（某些安装方式）
  const usrBinBash = path.join(gitRoot, 'usr', 'bin', 'bash.exe');
  if (fs.existsSync(usrBinBash)) {
    return usrBinBash;
  }
  return null;
}

/**
 * 在 Windows 上查找 git 命令路径
 */
function findGitPath(): string | null {
  try {
    const result = execSync('where git', { encoding: 'utf8', timeout: 5000 });
    const gitPath = result.split('\n')[0]?.trim();
    if (gitPath && fs.existsSync(gitPath)) {
      return gitPath;
    }
  } catch {
    // where 命令失败，忽略
  }
  return null;
}

/**
 * 查找 Windows 上的 Git Bash 路径
 */
function findGitBashPath(): string | null {
  if (process.platform !== 'win32') {
    return null;
  }
  // 1. 检查环境变量 BASH_TOOL_SHELL（最高优先级）
  if (process.env.BASH_TOOL_SHELL && fs.existsSync(process.env.BASH_TOOL_SHELL)) {
    return process.env.BASH_TOOL_SHELL;
  }
  // 2. 检查环境变量 GIT_INSTALL_ROOT
  if (process.env.GIT_INSTALL_ROOT) {
    const gitBash = path.join(process.env.GIT_INSTALL_ROOT, 'bin', 'bash.exe');
    if (fs.existsSync(gitBash)) {
      return gitBash;
    }
  }
  // 3. 通过 git 命令推断 bash 位置
  const gitPath = findGitPath();
  if (gitPath) {
    const bashPath = inferBashFromGitPath(gitPath);
    if (bashPath) {
      return bashPath;
    }
  }
  // 4. 检查常见路径（回退）
  for (const p of GIT_BASH_FALLBACK_PATHS) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}
// 缓存 Git Bash 路径
let cachedGitBashPath: string | null | undefined;
/**
 * 获取 Windows 上的 shell 路径
 */
function getWindowsShell(): string | boolean {
  if (cachedGitBashPath === undefined) {
    cachedGitBashPath = findGitBashPath();
  }
  return cachedGitBashPath || true;
}

/**
 * 终止进程树
 * @param proc - 子进程对象
 * @param signal - 信号（默认 SIGTERM）
 */
async function killProcessTree(
  proc: ChildProcess,
  signal: NodeJS.Signals = 'SIGTERM'
): Promise<void> {
  const pid = proc.pid;
  if (!pid) return;
  // Windows: 使用 taskkill 命令
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(pid), '/f', '/t'], { stdio: 'ignore' });
      killer.once('exit', () => resolve());
      killer.once('error', () => resolve());
    });
    return;
  }
  // Unix: 使用进程组 ID（负 PID）
  try {
    process.kill(-pid, signal);
    // 等待进程退出
    await new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        if (proc.exitCode !== null) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);
      // 超时后使用 SIGKILL
      setTimeout(() => {
        clearInterval(checkInterval);
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          // 进程已退出，忽略
        }
        resolve();
      }, SIGKILL_TIMEOUT_MS);
    });
  } catch {
    // 如果进程组终止失败，回退到直接终止进程
    proc.kill(signal);
  }
}
/**
 * 默认本地执行器
 */
export class LocalCommandExecutor implements CommandExecutor {
  readonly id: string;
  readonly target = 'local' as const;

  private readonly backgroundLogDir: string;
  constructor(options: LocalCommandExecutorOptions = {}) {
    this.id = options.id ?? 'local-default';
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
    return new Promise((resolve) => {
      let combinedOutput = '';
      let timedOut = false;
      let exited = false;

      // 构建命令参数
      let shellPath: string | boolean;
      let commandArgs: string[];

      if (process.platform === 'win32') {
        const shell = getWindowsShell();
        if (typeof shell === 'string') {
          // 使用 Git Bash
          shellPath = shell;
          commandArgs = ['-lc', request.command];
        } else {
          // 回退到 cmd.exe
          shellPath = process.env.COMSPEC || 'cmd.exe';
          commandArgs = ['/d', '/s', '/c', request.command];
        }
      } else {
        // Unix: 使用 bash
        shellPath = '/bin/bash';
        commandArgs = ['-lc', request.command];
      }

      // 启动子进程
      const child = spawn(shellPath as string, commandArgs, {
        cwd: request.cwd,
        env: this.getExecutionEnv(request.env),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        // Unix 上使用 detached 模式以支持进程组
        detached: process.platform !== 'win32',
      });

      // 超时处理
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutMs = request.timeoutMs ?? 120000;
      if (timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          if (exited) return;
          timedOut = true;
          void killProcessTree(child);
        }, timeoutMs);
      }

      // 收集输出
      child.stdout?.on('data', (chunk: Buffer) => {
        const content = chunk.toString('utf8');
        combinedOutput += content;
        this.emit(callbacks, { type: 'stdout', content });
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        const content = chunk.toString('utf8');
        combinedOutput += content;
        this.emit(callbacks, { type: 'stderr', content });
      });

      // 清理函数
      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = undefined;
        }
      };

      // 进程退出
      child.once('exit', (code, signal) => {
        exited = true;
        cleanup();
        const exitCode = code ?? (signal ? 1 : 0);
        const output = combinedOutput;

        this.emit(callbacks, {
          type: 'end',
          data: {
            success: exitCode === 0 && !timedOut,
            exitCode,
            timedOut,
          },
        });

        resolve({
          success: exitCode === 0 && !timedOut,
          exitCode,
          output,
          streamed: combinedOutput.length > 0,
          metadata: timedOut ? { timedOut: true } : undefined,
        });
      });

      // 进程错误
      child.once('error', (err) => {
        exited = true;
        cleanup();
        this.emit(callbacks, {
          type: 'end',
          data: { success: false, error: err.message },
        });

        resolve({
          success: false,
          exitCode: 1,
          output: combinedOutput,
          streamed: combinedOutput.length > 0,
          metadata: { error: err.message },
        });
      });
    });
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

    let shellPath: string;
    let commandArgs: string[];

    if (process.platform === 'win32') {
      const shell = getWindowsShell();
      if (typeof shell === 'string') {
        shellPath = shell;
        commandArgs = ['-lc', redirectedCommand];
      } else {
        shellPath = process.env.COMSPEC || 'cmd.exe';
        commandArgs = ['/d', '/s', '/c', redirectedCommand];
      }
    } else {
      shellPath = '/bin/bash';
      commandArgs = ['-lc', redirectedCommand];
    }

    const child = spawn(shellPath, commandArgs, {
      cwd: request.cwd,
      env: this.getExecutionEnv(request.env),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

    child.unref();

    const pid = child.pid;
    this.emit(callbacks, {
      type: 'info',
      content: `BACKGROUND_STARTED: pid=${pid ?? 'unknown'}, log=${logPath}`,
      data: { pid, logPath, run_in_background: true },
    });
    this.emit(callbacks, {
      type: 'end',
      data: { success: true, run_in_background: true, pid, logPath },
    });

    return {
      success: true,
      exitCode: 0,
      output: '',
      backgroundTask: {
        pid,
        logPath,
      } as BackgroundTaskInfo,
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

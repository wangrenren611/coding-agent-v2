/**
 * Bash 工具
 *
 * 执行 Shell 命令，支持：
 * - 安全策略检查
 * - 超时控制
 * - 后台运行
 * - 跨平台支持
 */

import { z } from 'zod';
import { execaCommand } from 'execa';
import stripAnsi from 'strip-ansi';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { BaseTool } from './base';
import type { ToolResult, ToolExecutionContext } from './types';
import { evaluateBashPolicy, type BashPolicyMode } from './bash-policy';
import BASH_DESCRIPTION from './bash.description';

// =============================================================================
// 参数 Schema
// =============================================================================

const runInBackgroundSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return value;
}, z.boolean());

const schema = z.object({
  command: z.string().min(1).describe('The bash command to run'),
  timeout: z
    .number()
    .int()
    .min(0)
    .max(600000)
    .describe('Command timeout in milliseconds')
    .optional(),
  run_in_background: runInBackgroundSchema.optional().describe('Run command in background'),
});

// =============================================================================
// 类型定义
// =============================================================================

interface PolicyDecision {
  allowed: boolean;
  reason?: string;
}

interface ExecutionResult {
  exitCode: number;
  output: string;
  streamed: boolean;
}

interface BackgroundResult {
  pid: number | undefined;
  logPath: string;
}

// =============================================================================
// BashTool 类
// =============================================================================

/**
 * Bash 命令执行工具
 *
 * @example
 * ```typescript
 * const bashTool = new BashTool();
 *
 * // 执行简单命令
 * const result = await bashTool.execute({ command: 'ls -la' }, context);
 *
 * // 后台运行
 * const bgResult = await bashTool.execute({
 *   command: 'npm run build',
 *   run_in_background: true
 * }, context);
 * ```
 */
export class BashTool extends BaseTool<typeof schema> {
  /** 默认超时时间（毫秒） */
  private defaultTimeout = 60000;

  /** 最大输出长度 */
  private maxOutputLength = 30000;

  get meta() {
    return {
      name: 'bash',
      description: BASH_DESCRIPTION,
      parameters: schema,
      category: 'system',
      tags: ['shell', 'command', 'terminal'],
      dangerous: true,
    };
  }

  // ===========================================================================
  // 执行前检查
  // ===========================================================================

  /**
   * 执行前钩子 - 验证命令安全性
   */
  async beforeExecute(args: z.infer<typeof schema>, _context: ToolExecutionContext) {
    // 可以在这里添加额外的验证逻辑
    return args;
  }

  // ===========================================================================
  // 主执行方法
  // ===========================================================================

  async execute(args: z.infer<typeof schema>, context: ToolExecutionContext): Promise<ToolResult> {
    const { command, timeout, run_in_background } = args;

    // 1. 验证安全策略
    const policy = this.validatePolicy(command);
    if (!policy.allowed) {
      return this.failure(`COMMAND_BLOCKED_BY_POLICY: ${policy.reason || 'Command not allowed'}`, {
        error: 'COMMAND_BLOCKED_BY_POLICY',
        reason: policy.reason,
      });
    }

    // 2. 后台运行
    if (run_in_background) {
      return this.executeInBackground(command, context);
    }

    // 3. 前台执行
    return this.executeForeground(command, timeout ?? this.defaultTimeout, context);
  }

  // ===========================================================================
  // 安全策略
  // ===========================================================================

  /**
   * 获取安全策略模式
   */
  private getPolicyMode(): BashPolicyMode {
    const raw = (process.env.BASH_TOOL_POLICY || 'guarded').toLowerCase();
    return raw === 'permissive' ? 'permissive' : 'guarded';
  }

  /**
   * 验证命令安全策略
   */
  private validatePolicy(command: string): PolicyDecision {
    const normalized = command.trim();
    if (!normalized) {
      return { allowed: false, reason: 'Command is empty' };
    }

    const decision = evaluateBashPolicy(normalized, {
      mode: this.getPolicyMode(),
      allowlistMissEffect: 'deny',
      allowlistMissReason: (cmd) =>
        `Command "${cmd}" is not in allowed command list (set BASH_TOOL_POLICY=permissive to bypass)`,
    });

    if (decision.effect === 'allow') {
      return { allowed: true };
    }

    return { allowed: false, reason: decision.reason };
  }

  // ===========================================================================
  // 命令执行
  // ===========================================================================

  /**
   * 前台执行命令
   */
  private async executeForeground(
    command: string,
    timeoutMs: number,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    try {
      const result = await this.runCommand(command, timeoutMs, context);

      // 处理输出
      let output = this.sanitizeOutput(result.output);
      const isTruncated = output.length > this.maxOutputLength;

      if (isTruncated) {
        const headLength = 10000;
        const tailLength = 10000;
        output =
          output.slice(0, headLength) +
          '\n\n[... Output Truncated for Brevity ...]\n\n' +
          output.slice(-tailLength);
      }

      if (result.exitCode === 0) {
        return this.success(
          {
            output,
            exitCode: result.exitCode,
            truncated: isTruncated,
          },
          'Command executed successfully'
        );
      } else {
        return this.failure(`Command failed with exit code ${result.exitCode}`, {
          output,
          exitCode: result.exitCode,
          error: `EXIT_CODE_${result.exitCode}`,
        });
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return this.failure(`EXECUTION_FAILED: ${err.message}`, {
        error: 'EXECUTION_FAILED',
        message: err.message,
      });
    }
  }

  /**
   * 后台执行命令
   */
  private async executeInBackground(
    command: string,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    try {
      const { pid, logPath } = this.runInBackground(command);
      const pidText = typeof pid === 'number' ? String(pid) : 'unknown';
      this.emitToolEvent(context, {
        type: 'info',
        content: `BACKGROUND_STARTED: pid=${pidText}, log=${logPath}`,
        data: {
          pid,
          logPath,
          run_in_background: true,
        },
      });

      return this.success(
        {
          pid,
          logPath,
          run_in_background: true,
        },
        `BACKGROUND_STARTED: pid=${pidText}, log=${logPath}`
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return this.failure(`BACKGROUND_START_FAILED: ${err.message}`, {
        error: 'BACKGROUND_START_FAILED',
        message: err.message,
      });
    }
  }

  /**
   * 执行命令（使用 execa）
   */
  private async runCommand(
    command: string,
    timeoutMs: number,
    context: ToolExecutionContext
  ): Promise<ExecutionResult> {
    const subprocess = execaCommand(command, {
      all: true,
      reject: false,
      shell: true,
      preferLocal: true,
      windowsHide: true,
      encoding: 'utf8',
      timeout: timeoutMs,
      env: this.getExecutionEnv(),
      maxBuffer: 50 * 1024 * 1024, // 50MB
    });

    let streamed = false;
    const outputChunks: string[] = [];

    // 收集输出
    if (subprocess.stdout) {
      subprocess.stdout.on('data', (chunk: string | Buffer) => {
        const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        this.emitToolEvent(context, { type: 'stdout', content: str });
      });
    }

    if (subprocess.stderr) {
      subprocess.stderr.on('data', (chunk: string | Buffer) => {
        const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        this.emitToolEvent(context, { type: 'stderr', content: str });
      });
    }

    if (subprocess.all) {
      subprocess.all.on('data', (chunk: string | Buffer) => {
        const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        outputChunks.push(str);
        streamed = true;
      });
    }

    const result = await subprocess;
    const output = outputChunks.length > 0 ? outputChunks.join('') : (result.all ?? '');

    return {
      exitCode: result.exitCode ?? 1,
      output,
      streamed,
    };
  }

  /**
   * 后台运行命令
   */
  private runInBackground(command: string): BackgroundResult {
    const logPath = path.join(
      tmpdir(),
      `agent-bash-bg-${Date.now()}-${randomUUID().slice(0, 8)}.log`
    );
    fs.writeFileSync(logPath, '', { flag: 'a' });

    const quotedLogPath =
      process.platform === 'win32'
        ? `"${logPath.replace(/"/g, '""')}"`
        : `'${logPath.replace(/'/g, `'\\''`)}'`;
    const redirectedCommand = `${command} >> ${quotedLogPath} 2>&1`;

    const shellCommand =
      process.platform === 'win32'
        ? ['cmd.exe', '/d', '/s', '/c', redirectedCommand]
        : ['/bin/bash', '-lc', redirectedCommand];

    const child = spawn(shellCommand[0], shellCommand.slice(1), {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

    child.unref();
    return { pid: child.pid, logPath };
  }

  // ===========================================================================
  // 辅助方法
  // ===========================================================================

  /**
   * 获取执行环境变量
   */
  private getExecutionEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };

    if (process.platform === 'win32') {
      // 设置代码页为 UTF-8
      env['CHCP'] = '65001';
      env['ANSICON'] = '';
      env['ConEmuANSI'] = 'OFF';
      env['TERM'] = 'dumb';
    }

    // 强制使用 UTF-8
    env['LANG'] = 'en_US.UTF-8';
    env['LC_ALL'] = 'en_US.UTF-8';

    return env;
  }

  /**
   * 清理输出
   */
  private sanitizeOutput(output: string): string {
    if (!output) return output;

    let sanitized = output;

    // 1. 移除 ANSI 转义序列
    sanitized = stripAnsi(sanitized);

    // 2. 移除 Unicode 替换字符
    sanitized = sanitized.replace(/\uFFFD/g, '');

    // 3. 移除残留的 ANSI 代码
    // 使用 String.fromCharCode 构建 ESC 字符，避免 no-control-regex
    const esc = String.fromCharCode(0x1b);
    const ansiEscapeRegex = new RegExp(`${esc}\\[[0-9;]*[a-zA-Z]`, 'g');
    sanitized = sanitized.replace(ansiEscapeRegex, '');
    sanitized = sanitized.replace(/^\[[\d;]*m/gm, '');

    // 4. 规范化换行符
    sanitized = sanitized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // 5. 移除过多的空行
    sanitized = sanitized.replace(/\n{3,}/g, '\n\n');

    return sanitized.trim();
  }

  private emitToolEvent(
    context: ToolExecutionContext,
    event: Parameters<NonNullable<ToolExecutionContext['emitToolEvent']>>[0]
  ): void {
    const emit = context.agentContext?.emitToolEvent ?? context.emitToolEvent;
    if (!emit) {
      return;
    }
    void Promise.resolve(emit(event)).catch(() => {
      // 工具流事件失败不应影响命令执行
    });
  }
}

// =============================================================================
// 导出
// =============================================================================

export default BashTool;

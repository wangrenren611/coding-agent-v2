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
import stripAnsi from 'strip-ansi';
import { BaseTool } from './base';
import type { ToolResult, ToolExecutionContext } from './types';
import { evaluateBashPolicy, type BashPolicyEffect, type BashPolicyMode } from './bash-policy';
import BASH_DESCRIPTION from './bash.description';
import type {
  BackgroundTaskInfo,
  CommandExecutionCallbacks,
  CommandExecutionResult,
  CommandExecutionRouter,
  ExecutionTarget,
} from './runtime';
import { LocalCommandExecutor, StaticCommandExecutionRouter } from './runtime';

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
  effect: BashPolicyEffect;
  reason?: string;
}

interface ExecutionResult {
  exitCode: number;
  output: string;
  streamed: boolean;
  backgroundTask?: BackgroundTaskInfo;
}

export interface BashToolOptions {
  commandRouter?: CommandExecutionRouter;
  defaultExecutionTarget?: ExecutionTarget;
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
  private readonly commandRouter: CommandExecutionRouter;
  private readonly defaultExecutionTarget?: ExecutionTarget;

  constructor(options: BashToolOptions = {}) {
    super();
    this.commandRouter =
      options.commandRouter ??
      new StaticCommandExecutionRouter({
        defaultTarget: 'local',
        executors: [new LocalCommandExecutor()],
      });
    this.defaultExecutionTarget =
      options.defaultExecutionTarget ?? this.getConfiguredExecutionTarget();
  }

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
    if (policy.effect === 'deny') {
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
    return this.executeForeground(command, timeout ?? this.getTimeoutMs(), context);
  }

  async shouldConfirm(
    args: z.infer<typeof schema>
  ): Promise<{ required: boolean; reason?: string }> {
    const policy = this.validatePolicy(args.command);
    if (policy.effect === 'ask') {
      return { required: true, reason: policy.reason };
    }
    return { required: false };
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

  private getConfiguredExecutionTarget(): ExecutionTarget | undefined {
    const raw = process.env.BASH_TOOL_EXECUTION_TARGET?.trim().toLowerCase();
    if (!raw) return undefined;
    if (raw === 'local' || raw === 'remote' || raw === 'sandbox' || raw === 'custom') {
      return raw;
    }
    return undefined;
  }

  /**
   * 验证命令安全策略
   */
  private validatePolicy(command: string): PolicyDecision {
    const normalized = command.trim();
    if (!normalized) {
      return { effect: 'deny', reason: 'Command is empty' };
    }

    const decision = evaluateBashPolicy(normalized, {
      mode: this.getPolicyMode(),
      allowlistMissEffect: 'ask',
      allowlistMissReason: (cmd) =>
        `Command "${cmd}" is not in allowed command list and requires user confirmation`,
    });

    return { effect: decision.effect, reason: decision.reason };
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
      const truncated = this.resultTruncation(this.sanitizeOutput(result.output), {
        headLength: 10000,
        tailLength: 10000,
        marker: '[... Output Truncated for Brevity ...]',
      });
      const output = truncated.output;
      const isTruncated = truncated.truncated;

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
      const result = await this.runCommand(command, this.getTimeoutMs(), context, true);
      const pid = result.backgroundTask?.pid;
      const logPath = result.backgroundTask?.logPath;
      const pidText = typeof pid === 'number' ? String(pid) : 'unknown';
      const safeLogPath = logPath ?? 'unknown';
      this.emitToolEvent(context, {
        type: 'info',
        content: `BACKGROUND_STARTED: pid=${pidText}, log=${safeLogPath}`,
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
        `BACKGROUND_STARTED: pid=${pidText}, log=${safeLogPath}`
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
   * 执行命令（通过运行时执行后端）
   */
  private async runCommand(
    command: string,
    timeoutMs: number,
    context: ToolExecutionContext,
    runInBackground = false
  ): Promise<ExecutionResult> {
    const callbacks: CommandExecutionCallbacks = {
      onEvent: (event) => {
        if (event.type === 'stdout' || event.type === 'stderr') {
          this.emitToolEvent(context, {
            type: event.type,
            content: event.content,
            data: event.data,
          });
        }
      },
    };
    const request = {
      command,
      cwd: process.cwd(),
      timeoutMs,
      runInBackground,
      env: this.getExecutionEnv(),
      correlationId: context.toolCallId,
      profile: 'trusted' as const,
      target: this.defaultExecutionTarget,
    };
    const executor = this.commandRouter.route(request);
    const result: CommandExecutionResult = await executor.execute(request, callbacks);

    return {
      exitCode: result.exitCode,
      output: result.output,
      streamed: result.streamed ?? false,
      backgroundTask: result.backgroundTask,
    };
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

/**
 * 命令执行能力接口
 */

import type { ExecutionProfile, ExecutionTarget } from './types';

export type CommandExecutionEventType = 'stdout' | 'stderr' | 'info' | 'end' | 'error';

/**
 * 命令执行流事件
 */
export interface CommandExecutionEvent {
  type: CommandExecutionEventType;
  content?: string;
  data?: unknown;
}

/**
 * 命令执行请求
 */
export interface CommandExecutionRequest {
  command: string;
  cwd: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  runInBackground?: boolean;
  target?: ExecutionTarget;
  profile?: ExecutionProfile;
  correlationId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * 后台任务信息
 */
export interface BackgroundTaskInfo {
  pid?: number;
  logPath?: string;
  taskId?: string;
}

/**
 * 命令执行结果
 */
export interface CommandExecutionResult {
  success: boolean;
  exitCode: number;
  output: string;
  streamed?: boolean;
  backgroundTask?: BackgroundTaskInfo;
  metadata?: Record<string, unknown>;
}

export interface CommandExecutionCallbacks {
  onEvent?: (event: CommandExecutionEvent) => void | Promise<void>;
}

/**
 * 命令执行后端
 */
export interface CommandExecutor {
  readonly id: string;
  readonly target: ExecutionTarget;
  canExecute(request: CommandExecutionRequest): boolean;
  execute(
    request: CommandExecutionRequest,
    callbacks?: CommandExecutionCallbacks
  ): Promise<CommandExecutionResult>;
  cancel?(taskId: string): Promise<void>;
}

/**
 * 命令执行路由器
 */
export interface CommandExecutionRouter {
  route(request: CommandExecutionRequest): CommandExecutor;
}

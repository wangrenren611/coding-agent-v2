/**
 * 命令执行路由器实现
 */

import type { CommandExecutionRequest, CommandExecutionRouter, CommandExecutor } from './command';
import type { ExecutionTarget } from './types';

export interface StaticCommandExecutionRouterOptions {
  defaultTarget?: ExecutionTarget;
  executors?: CommandExecutor[];
}

/**
 * 静态目标路由器
 *
 * 根据 request.target 或默认 target 选择执行器，
 * 并在该 target 下按注册顺序选择第一个可执行的后端。
 */
export class StaticCommandExecutionRouter implements CommandExecutionRouter {
  private readonly executorsByTarget = new Map<ExecutionTarget, CommandExecutor[]>();
  private readonly defaultTarget: ExecutionTarget;

  constructor(options: StaticCommandExecutionRouterOptions = {}) {
    this.defaultTarget = options.defaultTarget ?? 'local';
    for (const executor of options.executors ?? []) {
      this.register(executor);
    }
  }

  register(executor: CommandExecutor): void {
    const list = this.executorsByTarget.get(executor.target) ?? [];
    list.push(executor);
    this.executorsByTarget.set(executor.target, list);
  }

  route(request: CommandExecutionRequest): CommandExecutor {
    const target = request.target ?? this.defaultTarget;
    const executors = this.executorsByTarget.get(target) ?? [];
    if (executors.length === 0) {
      throw new Error(`No command executor registered for target "${target}"`);
    }

    const executor = executors.find((candidate) => candidate.canExecute(request));
    if (!executor) {
      throw new Error(`No compatible command executor found for target "${target}"`);
    }

    return executor;
  }
}

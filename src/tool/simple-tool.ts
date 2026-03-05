import { z } from 'zod';
import type { ToolExecutionContext, ToolResult } from '../agent/types';
import { BaseTool } from './base';
import type { ToolMeta, ToolParameterSchema, SimpleToolConfig, SimpleToolExecutor } from './types';

/**
 * 简单工具类
 *
 * 用于快速创建不需要复杂逻辑的工具
 */
export class SimpleTool<T extends ToolParameterSchema = ToolParameterSchema> extends BaseTool<T> {
  private readonly config: SimpleToolConfig<T>;
  private readonly executor: SimpleToolExecutor<T>;

  constructor(config: SimpleToolConfig<T>, executor: SimpleToolExecutor<T>) {
    super();
    this.config = config;
    this.executor = executor;
  }

  get meta(): ToolMeta<T> {
    return {
      ...this.config,
      parameters: this.config.parameters,
    };
  }

  async execute(args: z.infer<T>, context: ToolExecutionContext): Promise<ToolResult> {
    return this.executor(args, context);
  }
}

/**
 * 创建简单工具的便捷函数
 */
export function createTool<T extends ToolParameterSchema>(
  config: SimpleToolConfig<T>,
  executor: SimpleToolExecutor<T>
): SimpleTool<T> {
  return new SimpleTool(config, executor);
}

export type { SimpleToolConfig, SimpleToolExecutor } from './types';

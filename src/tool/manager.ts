/**
 * 工具管理器
 *
 * 统一管理工具的注册、schema生成、执行
 */

import { z } from 'zod';
import type { Tool } from '../providers';
import type { ToolCall, ToolResult, ToolExecutionContext } from '../agent/types';
import { BaseTool } from './base';
import type {
  ToolManagerConfig,
  ToolMeta,
  ToolMiddleware,
  ToolExecutionInfo,
  ToolParameterSchema,
} from './types';

// =============================================================================
// 内置中间件
// =============================================================================

/**
 * 日志中间件
 */
const loggingMiddleware: ToolMiddleware = async (info, next) => {
  console.log(`[Tool] Executing: ${info.toolName}`, info.args);
  try {
    const result = await next();
    console.log(`[Tool] Success: ${info.toolName}`, result.success);
    return result;
  } catch (error) {
    console.error(`[Tool] Error: ${info.toolName}`, error);
    throw error;
  }
};

/**
 * 计时中间件
 */
const timingMiddleware: ToolMiddleware = async (info, next) => {
  const start = Date.now();
  try {
    const result = await next();
    const duration = Date.now() - start;
    return {
      ...result,
      metadata: {
        ...result.metadata,
        duration: `${duration}ms`,
      },
    };
  } catch (error) {
    const duration = Date.now() - start;
    console.error(`[Tool] ${info.toolName} failed after ${duration}ms`);
    throw error;
  }
};

// =============================================================================
// ToolManager 类
// =============================================================================

/**
 * 工具管理器
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import { ToolManager, BaseTool } from './tool';
 *
 * // 定义工具
 * class CalculatorTool extends BaseTool {
 *   parameters = z.object({
 *     expression: z.string().describe('数学表达式'),
 *   });
 *
 *   get meta() {
 *     return {
 *       name: 'calculator',
 *       description: '执行数学计算',
 *       parameters: this.parameters,
 *     };
 *   }
 *
 *   async execute(args) {
 *     const result = eval(args.expression);
 *     return this.success(result);
 *   }
 * }
 *
 * // 创建管理器并注册工具
 * const toolManager = new ToolManager({
 *   maxConcurrency: 10,
 *   timeout: 30000,
 * });
 *
 * toolManager.register(new CalculatorTool());
 *
 * // 在 Agent 中使用
 * const agent = new Agent({
 *   provider,
 *   toolManager,
 * });
 * ```
 */
export class ToolManager {
  private tools: Map<string, BaseTool<any>> = new Map();
  private middlewares: ToolMiddleware[] = [];
  private config: Required<ToolManagerConfig>;

  constructor(config?: ToolManagerConfig) {
    this.config = {
      maxConcurrency: config?.maxConcurrency ?? 5,
      timeout: config?.timeout ?? 60000,
      enableLogging: config?.enableLogging ?? false,
      enableTiming: config?.enableTiming ?? false,
      middlewares: config?.middlewares ?? [],
    };

    // 添加内置中间件
    if (this.config.enableTiming) {
      this.middlewares.push(timingMiddleware);
    }
    if (this.config.enableLogging) {
      this.middlewares.push(loggingMiddleware);
    }

    // 添加自定义中间件
    this.middlewares.push(...this.config.middlewares);
  }

  // ===========================================================================
  // 工具注册
  // ===========================================================================

  /**
   * 注册单个工具
   */
  register<T extends ToolParameterSchema>(tool: BaseTool<T>): this {
    const name = tool.name;
    if (this.tools.has(name)) {
      console.warn(`[ToolManager] Tool "${name}" already registered, will be overwritten`);
    }
    this.tools.set(name, tool);
    return this;
  }

  /**
   * 批量注册工具
   */
  registerMany(tools: BaseTool<any>[]): this {
    for (const tool of tools) {
      this.register(tool);
    }
    return this;
  }

  /**
   * 注销工具
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * 清空所有工具
   */
  clear(): void {
    this.tools.clear();
  }

  // ===========================================================================
  // 工具查询
  // ===========================================================================

  /**
   * 获取工具
   */
  getTool<T extends ToolParameterSchema = ToolParameterSchema>(
    name: string
  ): BaseTool<T> | undefined {
    return this.tools.get(name);
  }

  /**
   * 检查工具是否存在
   */
  hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 获取所有工具名称
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * 获取所有工具
   */
  getTools(): BaseTool<any>[] {
    return Array.from(this.tools.values());
  }

  /**
   * 获取工具数量
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * 按分类获取工具
   */
  getToolsByCategory(category: string): BaseTool<any>[] {
    return this.getTools().filter((tool) => tool.meta.category === category);
  }

  /**
   * 按标签获取工具
   */
  getToolsByTag(tag: string): BaseTool<any>[] {
    return this.getTools().filter((tool) => tool.meta.tags?.includes(tag));
  }

  /**
   * 获取危险工具
   */
  getDangerousTools(): BaseTool<any>[] {
    return this.getTools().filter((tool) => tool.meta.dangerous);
  }

  /**
   * 获取启用的工具
   */
  getEnabledTools(): BaseTool<any>[] {
    return this.getTools().filter((tool) => tool.meta.enabled !== false);
  }

  // ===========================================================================
  // Schema 生成
  // ===========================================================================

  /**
   * 生成 LLM Provider 需要的 Tool Schema 列表
   */
  toToolsSchema(): Tool[] {
    return this.getEnabledTools().map((tool) => tool.toToolSchema());
  }

  /**
   * 获取所有工具的元数据
   */
  getToolsMeta(): ToolMeta[] {
    return this.getEnabledTools().map((tool) => tool.meta);
  }

  // ===========================================================================
  // 工具执行
  // ===========================================================================

  /**
   * 执行单个工具
   */
  async executeTool<T extends ToolParameterSchema = ToolParameterSchema>(
    name: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const tool = this.tools.get(name) as BaseTool<T> | undefined;
    if (!tool) {
      return {
        success: false,
        error: `Tool not found: ${name}`,
      };
    }

    // 检查是否启用
    if (tool.meta.enabled === false) {
      return {
        success: false,
        error: `Tool is disabled: ${name}`,
      };
    }

    // 参数校验
    let validatedArgs: z.infer<T>;
    try {
      validatedArgs = tool.validateArgs(args);
    } catch (error) {
      let errorMessage: string;
      if (error instanceof z.ZodError) {
        // zod v3/v4 兼容
        const issues = (error as any).issues || (error as any).errors || [];
        errorMessage = `Invalid arguments: ${issues.map((e: any) => e.message).join(', ')}`;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      } else {
        errorMessage = String(error);
      }

      return {
        success: false,
        error: errorMessage,
      };
    }

    // 构建执行信息
    const info: ToolExecutionInfo<T> = {
      toolName: name,
      args: validatedArgs,
      rawArgs: args,
      context,
      meta: tool.meta,
      startTime: Date.now(),
    };

    // 构建中间件链
    const executeChain = this.buildMiddlewareChain(tool, info, validatedArgs);

    try {
      return await executeChain();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // 调用错误钩子
      if (tool.onError) {
        const handled = await tool.onError(err, validatedArgs, context);
        if (handled) {
          return handled;
        }
      }

      return {
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * 批量执行工具（并发）
   */
  async executeTools(
    toolCalls: ToolCall[],
    context: Omit<ToolExecutionContext, 'toolCallId'>
  ): Promise<Array<{ toolCallId: string; result: ToolResult }>> {
    if (toolCalls.length === 0) {
      return [];
    }

    // 如果工具数量小于等于最大并发数，直接并发执行
    if (toolCalls.length <= this.config.maxConcurrency) {
      return this.executeToolBatch(toolCalls, context);
    }

    // 分批执行
    const results: Array<{ toolCallId: string; result: ToolResult }> = [];
    for (let i = 0; i < toolCalls.length; i += this.config.maxConcurrency) {
      const batch = toolCalls.slice(i, i + this.config.maxConcurrency);
      const batchResults = await this.executeToolBatch(batch, context);
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * 执行一批工具调用（并发）
   */
  private async executeToolBatch(
    toolCalls: ToolCall[],
    context: Omit<ToolExecutionContext, 'toolCallId'>
  ): Promise<Array<{ toolCallId: string; result: ToolResult }>> {
    const promises = toolCalls.map((toolCall) =>
      this.executeSingleToolWithTimeout(toolCall, context)
    );
    const results = await Promise.all(promises);
    return results.map((r) => ({ toolCallId: r.toolCallId, result: r.result }));
  }

  /**
   * 执行单个工具调用（带超时）
   */
  private async executeSingleToolWithTimeout(
    toolCall: ToolCall,
    context: Omit<ToolExecutionContext, 'toolCallId'>
  ): Promise<{ toolCallId: string; result: ToolResult }> {
    const fullContext: ToolExecutionContext = {
      ...context,
      toolCallId: toolCall.id,
    };

    try {
      const args = this.parseToolArgs(toolCall.function.arguments);
      const result = await this.withTimeout(
        this.executeTool(toolCall.function.name, args, fullContext),
        this.config.timeout,
        `Tool "${toolCall.function.name}" execution timed out after ${this.config.timeout}ms`
      );
      return { toolCallId: toolCall.id, result };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return {
        toolCallId: toolCall.id,
        result: { success: false, error: err.message },
      };
    }
  }

  /**
   * 解析工具参数
   */
  private parseToolArgs(argsString: string): Record<string, unknown> {
    try {
      return JSON.parse(argsString);
    } catch {
      return {};
    }
  }

  /**
   * 带超时的 Promise 执行
   */
  private async withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), ms);
      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }

  /**
   * 构建中间件链
   */
  private buildMiddlewareChain<T extends ToolParameterSchema>(
    tool: BaseTool<T>,
    info: ToolExecutionInfo<T>,
    validatedArgs: z.infer<T>
  ): () => Promise<ToolResult> {
    // 核心执行函数
    const coreExecute = async (): Promise<ToolResult> => {
      // 1. 执行前钩子
      let args = validatedArgs;
      if (tool.beforeExecute) {
        const modifiedArgs = await tool.beforeExecute(args, info.context);
        if (modifiedArgs) {
          args = modifiedArgs;
        }
      }

      // 2. 执行工具
      let result = await tool.execute(args, info.context);

      // 3. 执行后钩子
      if (tool.afterExecute) {
        result = await tool.afterExecute(result, args, info.context);
      }

      return result;
    };

    // 从后向前构建中间件链
    let chain = coreExecute;

    for (let i = this.middlewares.length - 1; i >= 0; i--) {
      const middleware = this.middlewares[i];
      const next = chain;
      chain = () => middleware(info, next);
    }

    return chain;
  }

  // ===========================================================================
  // 中间件管理
  // ===========================================================================

  /**
   * 添加中间件
   */
  use(middleware: ToolMiddleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * 移除中间件
   */
  removeMiddleware(middleware: ToolMiddleware): boolean {
    const index = this.middlewares.indexOf(middleware);
    if (index > -1) {
      this.middlewares.splice(index, 1);
      return true;
    }
    return false;
  }

  // ===========================================================================
  // 工具状态管理
  // ===========================================================================

  /**
   * 启用工具
   */
  enableTool(name: string): boolean {
    const tool = this.tools.get(name);
    if (tool) {
      tool.meta.enabled = true;
      return true;
    }
    return false;
  }

  /**
   * 禁用工具
   */
  disableTool(name: string): boolean {
    const tool = this.tools.get(name);
    if (tool) {
      tool.meta.enabled = false;
      return true;
    }
    return false;
  }

  /**
   * 设置工具优先级
   */
  setToolPriority(name: string, priority: number): boolean {
    const tool = this.tools.get(name);
    if (tool) {
      tool.meta.priority = priority;
      return true;
    }
    return false;
  }
}

// =============================================================================
// 便捷函数
// =============================================================================

/**
 * 创建工具管理器
 */
export function createToolManager(config?: ToolManagerConfig): ToolManager {
  return new ToolManager(config);
}

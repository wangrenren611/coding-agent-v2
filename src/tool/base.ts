/**
 * BaseTool 抽象基类
 *
 * 所有工具都必须继承此类，提供统一的工具接口
 * 使用 Zod 进行参数校验
 */

import { z } from 'zod';
import type { Tool } from '../providers';
import type { ToolResult, ToolExecutionContext } from '../agent/types';
import type { ToolMeta, ToolParameterSchema, SimpleToolConfig, SimpleToolExecutor } from './types';

// =============================================================================
// BaseTool 抽象类
// =============================================================================

/**
 * 工具抽象基类
 *
 * 所有工具都必须继承此类并实现抽象方法
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 *
 * class CalculatorTool extends BaseTool {
 *   // 定义参数 Schema
 *   parameters = z.object({
 *     expression: z.string().describe('数学表达式'),
 *   });
 *
 *   get meta(): ToolMeta<typeof this.parameters> {
 *     return {
 *       name: 'calculator',
 *       description: '执行数学计算',
 *       parameters: this.parameters,
 *     };
 *   }
 *
 *   async execute(args, context): Promise<ToolResult> {
 *     // args 已经是类型安全的，自动推断为 { expression: string }
 *     const result = eval(args.expression);
 *     return this.success(result);
 *   }
 * }
 * ```
 */
export abstract class BaseTool<T extends ToolParameterSchema = ToolParameterSchema> {
  // ===========================================================================
  // 抽象属性和方法（必须实现）
  // ===========================================================================

  /**
   * 工具元数据
   *
   * 必须返回工具的名称、描述和 Zod 参数定义
   */
  abstract get meta(): ToolMeta<T>;

  /**
   * 执行工具
   *
   * @param args 已校验的工具参数（类型安全）
   * @param context 执行上下文
   * @returns 执行结果
   */
  abstract execute(args: z.infer<T>, context: ToolExecutionContext): Promise<ToolResult>;

  // ===========================================================================
  // 可选的生命周期钩子
  // ===========================================================================

  /**
   * 执行前钩子
   *
   * 可用于参数修改、权限检查等
   * 返回修改后的参数，或者不返回（保持原参数）
   * 抛出错误将阻止执行
   */
  async beforeExecute?(args: z.infer<T>, context: ToolExecutionContext): Promise<void | z.infer<T>>;

  /**
   * 执行后钩子
   *
   * 可用于结果后处理、日志记录等
   */
  async afterExecute?(
    result: ToolResult,
    args: z.infer<T>,
    context: ToolExecutionContext
  ): Promise<ToolResult>;

  /**
   * 错误处理钩子
   *
   * 可用于自定义错误处理、错误恢复等
   * 返回 ToolResult 将作为最终结果，不返回则使用默认错误处理
   */
  async onError?(
    error: Error,
    args: Partial<z.infer<T>>,
    context: ToolExecutionContext
  ): Promise<ToolResult | void>;

  // ===========================================================================
  // 便捷方法
  // ===========================================================================

  /**
   * 获取工具名称
   */
  get name(): string {
    return this.meta.name;
  }

  /**
   * 获取工具描述
   */
  get description(): string {
    return this.meta.description;
  }

  /**
   * 获取参数 Schema
   */
  get parameterSchema(): T {
    return this.meta.parameters;
  }

  /**
   * 验证参数
   *
   * 使用 Zod 进行严格的参数校验
   *
   * @param args 原始参数
   * @returns 校验后的参数（类型安全）
   * @throws ZodError 如果校验失败
   */
  validateArgs(args: Record<string, unknown>): z.infer<T> {
    return this.meta.parameters.parse(args);
  }

  /**
   * 安全验证参数（不抛出错误）
   *
   * @param args 原始参数
   * @returns 校验结果，包含 success 和 data/error
   */
  safeValidateArgs(
    args: Record<string, unknown>
  ): { success: true; data: z.infer<T> } | { success: false; error: z.ZodError } {
    const result = this.meta.parameters.safeParse(args);
    if (result.success) {
      return { success: true, data: result.data };
    }
    return { success: false, error: result.error };
  }

  /**
   * 转换为 LLM Provider 需要的 Tool 格式
   *
   * 将 Zod Schema 转换为 JSON Schema
   */
  toToolSchema(): Tool {
    const { name, description, parameters } = this.meta;

    return {
      type: 'function',
      function: {
        name,
        description,
        parameters: zodToJsonSchema(parameters),
      },
    };
  }

  /**
   * 创建成功结果
   */
  protected success(data: unknown, message?: string): ToolResult {
    return {
      success: true,
      data,
      metadata: message ? { message } : undefined,
    };
  }

  /**
   * 创建失败结果
   */
  protected failure(error: string, details?: unknown): ToolResult {
    return {
      success: false,
      error,
      data: details,
    };
  }
}

// =============================================================================
// Zod to JSON Schema 转换
// =============================================================================

/**
 * 将 Zod Schema 转换为 JSON Schema
 *
 * 支持 zod v3 和 v4
 */
function zodToJsonSchema(schema: z.ZodType<any, any, any>): Record<string, unknown> {
  const def = (schema as any)._zod_def || (schema as any)._def;
  const typeName = def?.typeName;

  // 使用 typeName 字符串比较，兼容 zod v3 和 v4
  if (typeName === 'ZodObject' || typeName === 'Object') {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    const shape = typeof def.shape === 'function' ? def.shape() : def.shape;

    for (const [key, value] of Object.entries(shape as Record<string, z.ZodType<any, any, any>>)) {
      const propDef = (value as any)._zod_def || (value as any)._def;
      properties[key] = zodToJsonSchema(value as z.ZodType<any, any, any>);

      // 检查是否是可选字段
      const propTypeName = propDef?.typeName;
      if (propTypeName !== 'ZodOptional' && propTypeName !== 'Optional') {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  if (typeName === 'ZodString' || typeName === 'String') {
    const result: Record<string, unknown> = { type: 'string' };
    if (def.description) {
      result.description = def.description;
    }
    if (def.checks) {
      for (const check of def.checks) {
        if (check.kind === 'min') {
          result.minLength = check.value;
        } else if (check.kind === 'max') {
          result.maxLength = check.value;
        } else if (check.kind === 'regex') {
          result.pattern = check.regex?.source;
        }
      }
    }
    return result;
  }

  if (typeName === 'ZodNumber' || typeName === 'Number') {
    const result: Record<string, unknown> = { type: 'number' };
    if (def.description) {
      result.description = def.description;
    }
    if (def.checks) {
      for (const check of def.checks) {
        if (check.kind === 'min') {
          result.minimum = check.value;
        } else if (check.kind === 'max') {
          result.maximum = check.value;
        } else if (check.kind === 'int') {
          result.type = 'integer';
        }
      }
    }
    return result;
  }

  if (typeName === 'ZodBoolean' || typeName === 'Boolean') {
    return {
      type: 'boolean',
      ...(def.description && { description: def.description }),
    };
  }

  if (typeName === 'ZodArray' || typeName === 'Array') {
    return {
      type: 'array',
      items: zodToJsonSchema(def.type),
      ...(def.description && { description: def.description }),
    };
  }

  if (typeName === 'ZodEnum') {
    return {
      type: 'string',
      enum: def.values,
      ...(def.description && { description: def.description }),
    };
  }

  if (typeName === 'ZodLiteral' || typeName === 'Literal') {
    const value = def.value;
    if (typeof value === 'string') {
      return { type: 'string', const: value };
    }
    if (typeof value === 'number') {
      return { type: 'number', const: value };
    }
    if (typeof value === 'boolean') {
      return { type: 'boolean', const: value };
    }
    return { const: value };
  }

  if (typeName === 'ZodOptional' || typeName === 'Optional') {
    return zodToJsonSchema(def.innerType);
  }

  if (typeName === 'ZodDefault' || typeName === 'Default') {
    return {
      ...zodToJsonSchema(def.innerType),
      default: typeof def.defaultValue === 'function' ? def.defaultValue() : def.defaultValue,
    };
  }

  if (typeName === 'ZodNullable' || typeName === 'Nullable') {
    return {
      ...zodToJsonSchema(def.innerType),
      nullable: true,
    };
  }

  if (typeName === 'ZodUnion' || typeName === 'Union') {
    return {
      oneOf: def.options.map((option: z.ZodType<any, any, any>) => zodToJsonSchema(option)),
    };
  }

  if (typeName === 'ZodIntersection' || typeName === 'Intersection') {
    return {
      allOf: [zodToJsonSchema(def.left), zodToJsonSchema(def.right)],
    };
  }

  if (typeName === 'ZodRecord' || typeName === 'Record') {
    return {
      type: 'object',
      additionalProperties: zodToJsonSchema(def.valueType),
    };
  }

  if (typeName === 'ZodTuple' || typeName === 'Tuple') {
    return {
      type: 'array',
      items: def.items.map((item: z.ZodType<any, any, any>) => zodToJsonSchema(item)),
    };
  }

  if (typeName === 'ZodNull' || typeName === 'Null') {
    return { type: 'null' };
  }

  if (
    typeName === 'ZodAny' ||
    typeName === 'Any' ||
    typeName === 'ZodUnknown' ||
    typeName === 'Unknown'
  ) {
    return {};
  }

  // 对于不支持的类型，返回空对象
  return {};
}

// =============================================================================
// 简单工具类（用于快速创建工具）
// =============================================================================

/**
 * 简单工具类
 *
 * 用于快速创建不需要复杂逻辑的工具
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 *
 * const echoTool = new SimpleTool(
 *   {
 *     name: 'echo',
 *     description: '返回输入的文本',
 *     parameters: z.object({
 *       text: z.string().describe('要返回的文本'),
 *     }),
 *   },
 *   async (args) => ({ success: true, data: args.text })
 * );
 * ```
 */
export class SimpleTool<T extends ToolParameterSchema = ToolParameterSchema> extends BaseTool<T> {
  private config: SimpleToolConfig<T>;
  private executor: SimpleToolExecutor<T>;

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

// 重新导出类型，方便使用
export type { SimpleToolConfig, SimpleToolExecutor } from './types';

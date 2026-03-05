/**
 * BaseTool 抽象基类
 *
 * 所有工具都必须继承此类，提供统一的工具接口
 * 使用 Zod 进行参数校验
 */

import { z } from 'zod';
import type { Tool } from '../providers';
import type { ToolResult, ToolExecutionContext } from '../agent/types';
import type { ToolMeta, ToolParameterSchema } from './types';

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
  /** 默认超时时间（毫秒） */
  protected timeout = 60000;

  /** 默认最大输出长度 */
  protected maxOutputLength = 30000;

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

  /**
   * 执行前是否需要用户确认
   */
  shouldConfirm?(
    args: z.infer<T>,
    context: ToolExecutionContext
  ):
    | Promise<boolean | { required: boolean; reason?: string }>
    | boolean
    | { required: boolean; reason?: string };

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
   * 获取工具默认超时时间（毫秒）
   */
  getTimeoutMs(): number {
    return this.timeout;
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

  /**
   * 结果截断（用于大文本输出）
   */
  protected resultTruncation(
    output: string,
    options?: {
      maxLength?: number;
      headLength?: number;
      tailLength?: number;
      marker?: string;
    }
  ): { output: string; truncated: boolean } {
    const maxLength =
      typeof options?.maxLength === 'number' && options.maxLength > 0
        ? Math.floor(options.maxLength)
        : this.maxOutputLength;

    if (output.length <= maxLength) {
      return { output, truncated: false };
    }

    const marker = options?.marker ?? '[... Output Truncated ...]';
    const sep = '\n\n';
    const fixedLength = marker.length + sep.length * 2;
    const available = maxLength - fixedLength;

    if (available <= 20) {
      return {
        output: output.slice(0, Math.max(0, maxLength)),
        truncated: true,
      };
    }

    let headLength =
      typeof options?.headLength === 'number' && options.headLength > 0
        ? Math.floor(options.headLength)
        : Math.floor(available / 2);
    let tailLength =
      typeof options?.tailLength === 'number' && options.tailLength > 0
        ? Math.floor(options.tailLength)
        : available - headLength;

    if (headLength + tailLength > available) {
      headLength = Math.floor(available / 2);
      tailLength = available - headLength;
    }

    return {
      output:
        output.slice(0, headLength) +
        `${sep}${marker}${sep}` +
        output.slice(Math.max(0, output.length - tailLength)),
      truncated: true,
    };
  }
}

// =============================================================================
// Zod to JSON Schema 转换
// =============================================================================

/**
 * Zod 定义类型（兼容 v3 和 v4）
 */
interface ZodDef {
  typeName?: string;
  shape?: unknown;
  description?: string;
  checks?: Array<{ kind: string; value?: number; regex?: { source: string } }>;
  type?: z.ZodType;
  values?: unknown[];
  value?: unknown;
  innerType?: z.ZodType;
  defaultValue?: unknown;
  left?: z.ZodType;
  right?: z.ZodType;
  valueType?: z.ZodType;
  items?: z.ZodType[];
  options?: z.ZodType[];
}

/**
 * 将 Zod Schema 转换为 JSON Schema
 *
 * 支持 zod v3 和 v4
 */
function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  // 使用 unknown 作为中间类型来避免复杂的类型约束
  const schemaAny = schema as unknown;

  // Zod v4 有内置的 toJSONSchema 方法
  if (typeof (schemaAny as { toJSONSchema?: unknown }).toJSONSchema === 'function') {
    try {
      const result = (schemaAny as { toJSONSchema: () => Record<string, unknown> }).toJSONSchema();
      if (result && typeof result === 'object') {
        return result;
      }
    } catch {
      // 如果内置方法失败，回退到手动转换
    }
  }

  const def = ((schemaAny as { _zod_def?: ZodDef })._zod_def ||
    (schemaAny as { _def?: ZodDef })._def) as ZodDef | undefined;

  // Zod v4 使用 _def.type 而不是 typeName
  const typeName = def?.typeName || (def as { type?: string } | undefined)?.type;

  // 使用 typeName 字符串比较，兼容 zod v3 和 v4
  if (typeName === 'ZodObject' || typeName === 'Object') {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    if (!def) return { type: 'object' };

    const shape = typeof def.shape === 'function' ? (def.shape as () => unknown)() : def.shape;

    for (const [key, value] of Object.entries(shape as Record<string, unknown>)) {
      const valueAny = value as unknown;
      const propDef = ((valueAny as { _zod_def?: ZodDef })._zod_def ||
        (valueAny as { _def?: ZodDef })._def) as ZodDef | undefined;
      properties[key] = zodToJsonSchema(valueAny as z.ZodType);

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
    if (def?.description) {
      result.description = def.description;
    }
    if (def?.checks) {
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
    if (def?.description) {
      result.description = def.description;
    }
    if (def?.checks) {
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
      ...(def?.description && { description: def.description }),
    };
  }

  if (typeName === 'ZodArray' || typeName === 'Array') {
    return {
      type: 'array',
      items: def?.type ? zodToJsonSchema(def.type as unknown as z.ZodType) : {},
      ...(def?.description && { description: def.description }),
    };
  }

  if (typeName === 'ZodEnum') {
    return {
      type: 'string',
      enum: def?.values || [],
      ...(def?.description && { description: def.description }),
    };
  }

  if (typeName === 'ZodLiteral' || typeName === 'Literal') {
    const value = def?.value;
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
    return def?.innerType ? zodToJsonSchema(def.innerType as unknown as z.ZodType) : {};
  }

  if (typeName === 'ZodDefault' || typeName === 'Default') {
    const innerSchema = def?.innerType
      ? zodToJsonSchema(def.innerType as unknown as z.ZodType)
      : {};
    return {
      ...innerSchema,
      default: typeof def?.defaultValue === 'function' ? def.defaultValue() : def?.defaultValue,
    };
  }

  if (typeName === 'ZodNullable' || typeName === 'Nullable') {
    const innerSchema = def?.innerType
      ? zodToJsonSchema(def.innerType as unknown as z.ZodType)
      : {};
    return {
      ...innerSchema,
      nullable: true,
    };
  }

  if (typeName === 'ZodUnion' || typeName === 'Union') {
    return {
      oneOf:
        def?.options?.map((option: z.ZodType) => zodToJsonSchema(option as unknown as z.ZodType)) ||
        [],
    };
  }

  if (typeName === 'ZodIntersection' || typeName === 'Intersection') {
    return {
      allOf: [
        def?.left ? zodToJsonSchema(def.left as unknown as z.ZodType) : {},
        def?.right ? zodToJsonSchema(def.right as unknown as z.ZodType) : {},
      ],
    };
  }

  if (typeName === 'ZodRecord' || typeName === 'Record') {
    return {
      type: 'object',
      additionalProperties: def?.valueType
        ? zodToJsonSchema(def.valueType as unknown as z.ZodType)
        : {},
    };
  }

  if (typeName === 'ZodTuple' || typeName === 'Tuple') {
    return {
      type: 'array',

      items:
        def?.items?.map((item: z.ZodType) => zodToJsonSchema(item as unknown as z.ZodType)) || [],
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

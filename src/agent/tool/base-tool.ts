import { z } from 'zod';
import type { LLMTool, ToolConcurrencyMode, ToolExecutionContext } from './types';
import { ToolExecutionError } from './error';

export type ToolParameterSchema = z.ZodType;

interface ZodDef {
  typeName?: string;
  shape?: unknown;
  description?: string;
  checks?: Array<{
    kind?: string;
    value?: number;
    regex?: { source: string };
    check?: string;
    minimum?: number;
    maximum?: number;
    pattern?: string | RegExp;
    format?: string;
    inclusive?: boolean;
  }>;
  type?: z.ZodType | string;
  values?: unknown[];
  entries?: Record<string, unknown>;
  value?: unknown;
  innerType?: z.ZodType;
  defaultValue?: unknown;
  left?: z.ZodType;
  right?: z.ZodType;
  valueType?: z.ZodType;
  items?: z.ZodType[];
  options?: z.ZodType[];
  element?: z.ZodType;
}

function normalizeTypeName(rawTypeName?: string): string | undefined {
  if (!rawTypeName) return undefined;
  const trimmed = rawTypeName.trim();
  if (!trimmed) return undefined;
  const withoutPrefix = trimmed.startsWith('Zod') ? trimmed.slice(3) : trimmed;
  return withoutPrefix.toLowerCase();
}

function getSchemaDef(schemaAny: unknown): ZodDef | undefined {
  return ((schemaAny as { _zod_def?: ZodDef })._zod_def ||
    (schemaAny as { _def?: ZodDef })._def) as ZodDef | undefined;
}

function getSchemaKind(schemaAny: unknown): string | undefined {
  const def = getSchemaDef(schemaAny);
  const rawType = (def as { type?: unknown } | undefined)?.type;
  const fromTypeField = typeof rawType === 'string' ? rawType : undefined;
  const nestedTypeName = (rawType as { _def?: { typeName?: string } } | undefined)?._def?.typeName;
  return normalizeTypeName(def?.typeName || fromTypeField || nestedTypeName);
}

function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const schemaAny = schema as unknown;

  if (typeof (z as unknown as { toJSONSchema?: unknown }).toJSONSchema === 'function') {
    try {
      const result = (z as unknown as { toJSONSchema: (s: z.ZodType) => unknown }).toJSONSchema(
        schema
      );
      if (result && typeof result === 'object') {
        return result as Record<string, unknown>;
      }
    } catch {
      // fallback to local conversion
    }
  }

  if (typeof (schemaAny as { toJSONSchema?: unknown }).toJSONSchema === 'function') {
    try {
      const result = (schemaAny as { toJSONSchema: () => Record<string, unknown> }).toJSONSchema();
      if (result && typeof result === 'object') {
        return result;
      }
    } catch {
      // fallback to local conversion
    }
  }

  const def = getSchemaDef(schemaAny);
  const typeName = getSchemaKind(schemaAny);

  if (typeName === 'object') {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    if (!def) return { type: 'object' };

    const shape = typeof def.shape === 'function' ? (def.shape as () => unknown)() : def.shape;

    for (const [key, value] of Object.entries(shape as Record<string, unknown>)) {
      const valueAny = value as unknown;
      properties[key] = zodToJsonSchema(valueAny as z.ZodType);

      const propTypeName = getSchemaKind(valueAny);
      if (propTypeName !== 'optional' && propTypeName !== 'default') {
        required.push(key);
      }
    }

    return {
      type: 'object',
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  if (typeName === 'string') {
    const result: Record<string, unknown> = { type: 'string' };
    if (def?.description) {
      result.description = def.description;
    }
    if (def?.checks) {
      for (const check of def.checks) {
        const checkKind = check.kind || check.check;
        if (checkKind === 'min') {
          result.minLength = check.value;
        } else if (checkKind === 'max') {
          result.maxLength = check.value;
        } else if (checkKind === 'regex') {
          result.pattern = check.regex?.source;
        } else if (checkKind === 'min_length') {
          result.minLength = check.minimum;
        } else if (checkKind === 'max_length') {
          result.maxLength = check.maximum;
        } else if (checkKind === 'string_format' && check.format === 'regex') {
          result.pattern =
            typeof check.pattern === 'string'
              ? check.pattern
              : check.pattern instanceof RegExp
                ? check.pattern.source
                : undefined;
        }
      }
    }
    return result;
  }

  if (typeName === 'number') {
    const result: Record<string, unknown> = { type: 'number' };
    if (def?.description) {
      result.description = def.description;
    }
    if (def?.checks) {
      for (const check of def.checks) {
        const checkKind = check.kind || check.check;
        if (checkKind === 'min') {
          result.minimum = check.value;
        } else if (checkKind === 'max') {
          result.maximum = check.value;
        } else if (checkKind === 'int') {
          result.type = 'integer';
        } else if (checkKind === 'greater_than') {
          if (check.inclusive) {
            result.minimum = check.value;
          } else {
            result.exclusiveMinimum = check.value;
          }
        } else if (checkKind === 'less_than') {
          if (check.inclusive) {
            result.maximum = check.value;
          } else {
            result.exclusiveMaximum = check.value;
          }
        } else if (checkKind === 'number_format') {
          result.type = 'integer';
        }
      }
    }
    return result;
  }

  if (typeName === 'boolean') {
    return {
      type: 'boolean',
      ...(def?.description && { description: def.description }),
    };
  }

  if (typeName === 'array') {
    const itemSchema = def?.element || (def?.type as z.ZodType | undefined);
    return {
      type: 'array',
      items: itemSchema ? zodToJsonSchema(itemSchema as z.ZodType) : {},
      ...(def?.description && { description: def.description }),
    };
  }

  if (typeName === 'enum') {
    const enumValues = def?.values || (def?.entries ? Object.values(def.entries) : []);
    return {
      type: 'string',
      enum: enumValues,
      ...(def?.description && { description: def.description }),
    };
  }

  if (typeName === 'literal') {
    const value = def?.value ?? def?.values?.[0];
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

  if (typeName === 'optional') {
    return def?.innerType ? zodToJsonSchema(def.innerType as unknown as z.ZodType) : {};
  }

  if (typeName === 'default') {
    const innerSchema = def?.innerType
      ? zodToJsonSchema(def.innerType as unknown as z.ZodType)
      : {};
    return {
      ...innerSchema,
      default:
        typeof def?.defaultValue === 'function'
          ? (def.defaultValue as () => unknown)()
          : def?.defaultValue,
    };
  }

  if (typeName === 'nullable') {
    const innerSchema = def?.innerType
      ? zodToJsonSchema(def.innerType as unknown as z.ZodType)
      : {};
    return {
      ...innerSchema,
      nullable: true,
    };
  }

  if (typeName === 'union') {
    return {
      oneOf:
        def?.options?.map((option: z.ZodType) => zodToJsonSchema(option as unknown as z.ZodType)) ||
        [],
    };
  }

  if (typeName === 'intersection') {
    return {
      allOf: [
        def?.left ? zodToJsonSchema(def.left as unknown as z.ZodType) : {},
        def?.right ? zodToJsonSchema(def.right as unknown as z.ZodType) : {},
      ],
    };
  }

  if (typeName === 'record') {
    return {
      type: 'object',
      additionalProperties: def?.valueType
        ? zodToJsonSchema(def.valueType as unknown as z.ZodType)
        : {},
    };
  }

  if (typeName === 'tuple') {
    return {
      type: 'array',
      items:
        def?.items?.map((item: z.ZodType) => zodToJsonSchema(item as unknown as z.ZodType)) || [],
    };
  }

  if (typeName === 'null') {
    return { type: 'null' };
  }

  if (typeName === 'any' || typeName === 'unknown') {
    return {};
  }

  return {};
}

export interface ToolResult {
  success: boolean;
  output?: string;
  summary?: string;
  payload?: unknown;
  error?: ToolExecutionError;
  metadata?: Record<string, unknown>;
}

export interface ToolConfirmDetails {
  reason?: string;
  metadata?: Record<string, unknown>;
}

export abstract class BaseTool<T extends ToolParameterSchema = ToolParameterSchema> {
  abstract name: string;
  abstract description: string;
  abstract parameters: T;

  shouldConfirm(_args: z.input<T>): boolean {
    return false;
  }

  getConfirmDetails(_args: z.input<T>): ToolConfirmDetails | null {
    return null;
  }

  getConcurrencyMode(_args: z.input<T>): ToolConcurrencyMode {
    return 'exclusive';
  }

  getConcurrencyLockKey(_args: z.input<T>): string | undefined {
    return undefined;
  }

  abstract execute(args: z.input<T>, context?: ToolExecutionContext): Promise<ToolResult>;

  safeValidateArgs(
    args: Record<string, unknown>
  ): { success: true; data: z.infer<T> } | { success: false; error: z.ZodError } {
    const result = this.parameters.safeParse(args);
    if (result.success) {
      return { success: true, data: result.data };
    }
    return { success: false, error: result.error };
  }

  toToolSchema(): LLMTool {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: zodToJsonSchema(this.parameters),
      },
    };
  }
}

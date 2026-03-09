import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BaseTool } from '../base-tool';

const demoSchema = z.object({
  text: z.string().min(1),
  count: z.number().int().optional(),
});

class DemoTool extends BaseTool<typeof demoSchema> {
  name = 'demo';
  description = 'demo tool';
  parameters = demoSchema;

  async execute(args: z.infer<typeof demoSchema>) {
    return {
      success: true,
      output: `${args.text}:${args.count ?? 0}`,
    };
  }
}

describe('BaseTool', () => {
  it('shouldConfirm defaults to false', () => {
    const tool = new DemoTool();
    expect(tool.shouldConfirm({ text: 'a' })).toBe(false);
  });

  it('safeValidateArgs returns success with parsed data', () => {
    const tool = new DemoTool();
    const result = tool.safeValidateArgs({ text: 'hello', count: 3 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ text: 'hello', count: 3 });
    }
  });

  it('safeValidateArgs returns validation error on bad args', () => {
    const tool = new DemoTool();
    const result = tool.safeValidateArgs({ text: '' });

    expect(result.success).toBe(false);
    if (!('error' in result)) return;
    expect(result.error.issues.length).toBeGreaterThan(0);
  });

  it('execute can be implemented by subclass', async () => {
    const tool = new DemoTool();
    const result = await tool.execute({ text: 'ok', count: 2 });

    expect(result.success).toBe(true);
    expect(result.output).toBe('ok:2');
  });

  it('default concurrency strategy is exclusive with no lock key', () => {
    const tool = new DemoTool();
    expect(tool.getConcurrencyMode({ text: 'x' })).toBe('exclusive');
    expect(tool.getConcurrencyLockKey({ text: 'x' })).toBeUndefined();
  });

  it('toToolSchema exports function schema structure', () => {
    const tool = new DemoTool();
    const schema = tool.toToolSchema();
    expect(schema.type).toBe('function');
    expect(schema.function.name).toBe('demo');
    expect(schema.function.description).toBe('demo tool');
    expect(schema.function.parameters).toMatchObject({
      type: 'object',
    });
  });

  it('toToolSchema handles rich zod schema types', () => {
    const complexSchema = z.object({
      str: z.string().min(1).max(3).regex(/a/),
      num: z.number().min(1).max(9).int(),
      bool: z.boolean(),
      arr: z.array(z.string()),
      en: z.enum(['x', 'y']),
      lit: z.literal('fixed'),
      optionalField: z.string().optional(),
      defaultField: z.number().default(1),
      nullableField: z.string().nullable(),
      unionField: z.union([z.string(), z.number()]),
      intersectionField: z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() })),
      recordField: z.record(z.string(), z.string()),
      tupleField: z.tuple([z.string(), z.number()]),
      nullField: z.null(),
      anyField: z.any(),
    });

    class ComplexTool extends BaseTool<typeof complexSchema> {
      name = 'complex';
      description = 'complex';
      parameters = complexSchema;

      async execute() {
        return { success: true, output: 'ok' };
      }
    }

    const tool = new ComplexTool();
    const parameters = tool.toToolSchema().function.parameters as Record<string, unknown>;
    expect(parameters).toMatchObject({
      type: 'object',
    });
    expect((parameters.properties as Record<string, unknown>)['str']).toBeDefined();
    expect((parameters.properties as Record<string, unknown>)['num']).toBeDefined();
    expect((parameters.properties as Record<string, unknown>)['unionField']).toBeDefined();
    expect((parameters.properties as Record<string, unknown>)['tupleField']).toBeDefined();
  });

  it('toToolSchema uses schema instance toJSONSchema when available', () => {
    const schemaWithInstanceJson = {
      toJSONSchema: () => ({ type: 'object', properties: { ok: { type: 'boolean' } } }),
      safeParse: () => ({ success: true, data: {} }),
    } as unknown as z.ZodType;

    class InstanceJsonTool extends BaseTool<typeof schemaWithInstanceJson> {
      name = 'instance-json';
      description = 'instance json';
      parameters = schemaWithInstanceJson;

      async execute() {
        return { success: true };
      }
    }

    const tool = new InstanceJsonTool();
    expect(tool.toToolSchema().function.parameters).toMatchObject({
      type: 'object',
      properties: { ok: { type: 'boolean' } },
    });
  });

  it('toToolSchema fallback supports zod v4 lower-case defs and unknown type', () => {
    const schema = {
      _def: {
        type: 'object',
        shape: {
          text: {
            _def: {
              type: 'string',
              checks: [
                { check: 'min_length', minimum: 1 },
                { check: 'max_length', maximum: 4 },
                { check: 'string_format', format: 'regex', pattern: /x/ },
              ],
            },
          },
          textWithDesc: {
            _def: {
              type: 'string',
              description: 'string desc',
              checks: [{ check: 'string_format', format: 'regex', pattern: 'abc' }],
            },
          },
          textPatternUnknown: {
            _def: {
              type: 'string',
              checks: [
                { check: 'string_format', format: 'regex', pattern: 123 as unknown as RegExp },
              ],
            },
          },
          num: {
            _def: {
              type: 'number',
              checks: [
                { check: 'greater_than', value: 1, inclusive: true },
                { check: 'less_than', value: 9, inclusive: false },
                { check: 'number_format', format: 'safeint' },
              ],
            },
          },
          numExclusiveMin: {
            _def: {
              type: 'number',
              checks: [{ check: 'greater_than', value: 2, inclusive: false }],
            },
          },
          numInclusiveMax: {
            _def: {
              type: 'number',
              checks: [{ check: 'less_than', value: 7, inclusive: true }],
            },
          },
          bool: { _def: { type: 'boolean' } },
          arr: { _def: { type: 'array', element: { _def: { type: 'string' } } } },
          en: { _def: { type: 'enum', entries: { a: 'a', b: 'b' } } },
          lit: { _def: { type: 'literal', values: ['fixed'] } },
          optionalField: {
            _def: { type: 'optional', innerType: { _def: { type: 'string' } } },
          },
          defaultField: {
            _def: {
              type: 'default',
              innerType: { _def: { type: 'number' } },
              defaultValue: () => 2,
            },
          },
          defaultNoInner: {
            _def: {
              type: 'default',
              defaultValue: 3,
            },
          },
          nullableField: {
            _def: { type: 'nullable', innerType: { _def: { type: 'string' } } },
          },
          nullableNoInner: {
            _def: { type: 'nullable' },
          },
          unionField: {
            _def: {
              type: 'union',
              options: [{ _def: { type: 'string' } }, { _def: { type: 'number' } }],
            },
          },
          unionNoOptions: {
            _def: {
              type: 'union',
            },
          },
          intersectionField: {
            _def: {
              type: 'intersection',
              left: { _def: { type: 'object', shape: { a: { _def: { type: 'string' } } } } },
              right: { _def: { type: 'object', shape: { b: { _def: { type: 'number' } } } } },
            },
          },
          recordField: {
            _def: {
              type: 'record',
              valueType: { _def: { type: 'string' } },
            },
          },
          tupleField: {
            _def: {
              type: 'tuple',
              items: [{ _def: { type: 'string' } }, { _def: { type: 'number' } }],
            },
          },
          nullField: { _def: { type: 'null' } },
          anyField: { _def: { type: 'any' } },
          unknownField: { _def: { type: 'unknown' } },
          literalNumber: { _def: { type: 'literal', value: 42 } },
          literalObject: { _def: { type: 'literal', value: { k: 1 } } },
          unknownKind: { _def: { type: 'mystery_type' } },
        },
      },
      safeParse: () => ({ success: true, data: {} }),
    } as unknown as z.ZodType;

    class FallbackTool extends BaseTool<typeof schema> {
      name = 'fallback';
      description = 'fallback';
      parameters = schema;

      async execute() {
        return { success: true };
      }
    }

    const parameters = new FallbackTool().toToolSchema().function.parameters as Record<
      string,
      unknown
    >;
    expect(parameters.type).toBe('object');
    expect((parameters.properties as Record<string, unknown>)['unknownField']).toEqual({});
    expect((parameters.properties as Record<string, unknown>)['tupleField']).toMatchObject({
      type: 'array',
    });
    expect((parameters.properties as Record<string, unknown>)['defaultNoInner']).toMatchObject({
      default: 3,
    });
    expect((parameters.properties as Record<string, unknown>)['nullableNoInner']).toMatchObject({
      nullable: true,
    });
    expect((parameters.properties as Record<string, unknown>)['unionNoOptions']).toMatchObject({
      oneOf: [],
    });
    expect((parameters.properties as Record<string, unknown>)['textWithDesc']).toMatchObject({
      type: 'string',
      description: 'string desc',
      pattern: 'abc',
    });
    expect((parameters.properties as Record<string, unknown>)['textPatternUnknown']).toMatchObject({
      type: 'string',
      pattern: undefined,
    });
    expect((parameters.properties as Record<string, unknown>)['numExclusiveMin']).toMatchObject({
      exclusiveMinimum: 2,
    });
    expect((parameters.properties as Record<string, unknown>)['numInclusiveMax']).toMatchObject({
      maximum: 7,
    });
    expect((parameters.properties as Record<string, unknown>)['literalNumber']).toMatchObject({
      type: 'number',
      const: 42,
    });
    expect((parameters.properties as Record<string, unknown>)['literalObject']).toMatchObject({
      const: { k: 1 },
    });
    expect((parameters.properties as Record<string, unknown>)['unknownKind']).toEqual({});
  });

  it('toToolSchema fallback supports legacy zod v3-style defs', () => {
    const schema = {
      _def: {
        typeName: 'ZodObject',
        shape: {
          optionalOnly: {
            _def: { typeName: 'ZodOptional', innerType: { _def: { typeName: 'ZodString' } } },
          },
          defaultOnly: {
            _def: {
              typeName: 'ZodDefault',
              innerType: { _def: { typeName: 'ZodNumber', checks: [{ kind: 'int' }] } },
              defaultValue: 1,
            },
          },
          legacyString: {
            _def: {
              typeName: 'ZodString',
              checks: [
                { kind: 'min', value: 1 },
                { kind: 'max', value: 3 },
                { kind: 'regex', regex: { source: 'abc' } },
              ],
            },
          },
          legacyNumber: {
            _def: {
              typeName: 'ZodNumber',
              description: 'legacy number',
              checks: [
                { kind: 'min', value: 1 },
                { kind: 'max', value: 9 },
              ],
            },
          },
          legacyArray: {
            _def: {
              typeName: 'ZodArray',
              type: { _def: { typeName: 'ZodBoolean' } },
            },
          },
          legacyEnum: {
            _def: {
              typeName: 'ZodEnum',
              values: ['x', 'y'],
            },
          },
          legacyLiteral: {
            _def: {
              typeName: 'ZodLiteral',
              value: true,
            },
          },
          legacyIntersection: {
            _def: {
              typeName: 'ZodIntersection',
              left: {
                _def: { typeName: 'ZodObject', shape: { a: { _def: { typeName: 'ZodString' } } } },
              },
              right: {
                _def: { typeName: 'ZodObject', shape: { b: { _def: { typeName: 'ZodNumber' } } } },
              },
            },
          },
        },
      },
      safeParse: () => ({ success: true, data: {} }),
    } as unknown as z.ZodType;

    class LegacyTool extends BaseTool<typeof schema> {
      name = 'legacy';
      description = 'legacy';
      parameters = schema;

      async execute() {
        return { success: true };
      }
    }

    const parameters = new LegacyTool().toToolSchema().function.parameters as Record<
      string,
      unknown
    >;
    expect(parameters.type).toBe('object');
    expect(parameters.required).toBeInstanceOf(Array);
    expect(parameters.required as string[]).not.toContain('optionalOnly');
    expect(parameters.required as string[]).not.toContain('defaultOnly');
    expect(parameters.required as string[]).toContain('legacyString');
    const props = parameters.properties as Record<string, Record<string, unknown>>;
    expect(props.legacyString).toMatchObject({
      type: 'string',
      minLength: 1,
      maxLength: 3,
      pattern: 'abc',
    });
    expect(props.legacyNumber).toMatchObject({
      type: 'number',
      minimum: 1,
      maximum: 9,
      description: 'legacy number',
    });
    expect(props.legacyArray).toMatchObject({ type: 'array' });
    expect(props.legacyEnum).toMatchObject({ enum: ['x', 'y'] });
    expect(props.legacyLiteral).toMatchObject({ type: 'boolean', const: true });
  });
});

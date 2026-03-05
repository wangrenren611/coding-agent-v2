import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BaseTool } from '../base';
import { BashTool } from '../bash';
import { ToolManager } from '../manager';
import type { ToolExecutionContext, ToolResult } from '../types';
import type { ToolCall } from '../../providers';

const textSchema = z.object({
  text: z.string(),
});

const emptySchema = z.object({});

type ErrorLike = Error & { code?: string };

const executeContext: ToolExecutionContext = {
  toolCallId: 'call-1',
  loopIndex: 0,
  stepIndex: 0,
  agent: {
    getSessionId: () => 'session-1',
  } as ToolExecutionContext['agent'],
};

const batchContext: Omit<ToolExecutionContext, 'toolCallId'> = {
  loopIndex: 0,
  stepIndex: 0,
  agent: executeContext.agent,
};

function createToolCall(name: string, args: string): ToolCall {
  return {
    id: `tool-${name}`,
    type: 'function',
    index: 0,
    function: {
      name,
      arguments: args,
    },
  };
}

class EchoTool extends BaseTool<typeof textSchema> {
  get meta() {
    return {
      name: 'echo',
      description: 'Echo input',
      parameters: textSchema,
    };
  }

  async execute(args: z.infer<typeof textSchema>) {
    return { success: true, data: { text: args.text } };
  }
}

class ThrowTool extends BaseTool<typeof emptySchema> {
  constructor(private readonly errorFactory: () => unknown) {
    super();
  }

  get meta() {
    return {
      name: 'thrower',
      description: 'Always throws',
      parameters: emptySchema,
    };
  }

  async execute(): Promise<ToolResult> {
    throw this.errorFactory();
  }
}

class FailingTool extends BaseTool<typeof emptySchema> {
  get meta() {
    return {
      name: 'failing',
      description: 'Returns failure result',
      parameters: emptySchema,
    };
  }

  async execute() {
    return { success: false, error: 'operation failed' };
  }
}

class ConflictTool extends BaseTool<typeof emptySchema> {
  get meta() {
    return {
      name: 'conflict',
      description: 'Returns structured conflict',
      parameters: emptySchema,
    };
  }

  async execute() {
    return {
      success: false,
      error: 'PATCH_CONFLICT: patch cannot be applied',
      data: {
        error: 'PATCH_CONFLICT',
        code: 'PATCH_CONFLICT',
        recoverable: true,
        next_actions: ['read', 'patch'],
      },
    };
  }
}

class SlowTool extends BaseTool<typeof emptySchema> {
  get meta() {
    return {
      name: 'slow',
      description: 'Sleeps for timeout tests',
      parameters: emptySchema,
    };
  }

  async execute() {
    await new Promise((resolve) => setTimeout(resolve, 80));
    return { success: true, data: { done: true } };
  }
}

class ToolDefaultTimeoutTool extends BaseTool<typeof emptySchema> {
  protected timeout = 10;

  get meta() {
    return {
      name: 'tool-default-timeout',
      description: 'Uses BaseTool default timeout',
      parameters: emptySchema,
    };
  }

  async execute() {
    await new Promise((resolve) => setTimeout(resolve, 80));
    return { success: true, data: { done: true } };
  }
}

class ToolLongTimeoutTool extends BaseTool<typeof emptySchema> {
  protected timeout = 1000;

  get meta() {
    return {
      name: 'tool-long-timeout',
      description: 'Uses explicit long timeout',
      parameters: emptySchema,
    };
  }

  async execute() {
    await new Promise((resolve) => setTimeout(resolve, 80));
    return { success: true, data: { done: true } };
  }
}

class AbortAwareSlowTool extends BaseTool<typeof emptySchema> {
  constructor(private readonly state: { aborted: boolean }) {
    super();
  }

  get meta() {
    return {
      name: 'abort-aware-slow',
      description: 'Listens to tool abort signal',
      parameters: emptySchema,
    };
  }

  async execute(_args: z.infer<typeof emptySchema>, context: ToolExecutionContext) {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 200);
      const onAbort = () => {
        this.state.aborted = true;
        clearTimeout(timer);
        resolve();
      };
      if (context.toolAbortSignal?.aborted) {
        onAbort();
        return;
      }
      context.toolAbortSignal?.addEventListener('abort', onAbort, { once: true });
    });
    return { success: true, data: { aborted: this.state.aborted } };
  }
}

class OnErrorCrashTool extends BaseTool<typeof emptySchema> {
  get meta() {
    return {
      name: 'onerror-crash',
      description: 'onError throws',
      parameters: emptySchema,
    };
  }

  async execute(): Promise<ToolResult> {
    const error = new Error('base execution failure') as ErrorLike;
    error.code = 'BASE_FAILURE';
    throw error;
  }

  async onError() {
    throw new Error('onError handler exploded');
  }
}

class ConfirmedTool extends BaseTool<typeof emptySchema> {
  get meta() {
    return {
      name: 'confirmed',
      description: 'Requires confirmation',
      parameters: emptySchema,
      requireConfirm: true,
    };
  }

  async execute() {
    return { success: true, data: { ok: true } };
  }
}

class DynamicConfirmTool extends BaseTool<typeof textSchema> {
  get meta() {
    return {
      name: 'dynamic-confirm',
      description: 'Conditionally requires confirmation',
      parameters: textSchema,
    };
  }

  async shouldConfirm(args: z.infer<typeof textSchema>) {
    if (args.text.includes('danger')) {
      return { required: true, reason: 'dangerous content' };
    }
    return false;
  }

  async execute(args: z.infer<typeof textSchema>) {
    return { success: true, data: { echoed: args.text } };
  }
}

describe('ToolManager error normalization', () => {
  it('should normalize missing tool as structured error', async () => {
    const manager = new ToolManager();
    const result = await manager.executeTool('unknown-tool', {}, executeContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain('TOOL_NOT_FOUND');
    expect(result.data).toMatchObject({
      code: 'TOOL_NOT_FOUND',
      error: 'TOOL_NOT_FOUND',
      stage: 'lookup',
      recoverable: true,
    });
  });

  it('should normalize validation error with actionable details', async () => {
    const manager = new ToolManager();
    manager.register(new EchoTool());
    const result = await manager.executeTool('echo', {}, executeContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain('TOOL_VALIDATION_ERROR');
    expect(result.data).toMatchObject({
      code: 'TOOL_VALIDATION_ERROR',
      stage: 'validation',
      recoverable: true,
    });
    expect(result.data).toHaveProperty('details');
  });

  it('should keep domain error code from thrown error', async () => {
    const manager = new ToolManager();
    manager.register(
      new ThrowTool(() => {
        const error = new Error('disk unavailable') as ErrorLike;
        error.code = 'DISK_UNAVAILABLE';
        return error;
      })
    );

    const result = await manager.executeTool('thrower', {}, executeContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('DISK_UNAVAILABLE');
    expect(result.data).toMatchObject({
      code: 'DISK_UNAVAILABLE',
      error: 'DISK_UNAVAILABLE',
      stage: 'execution',
    });
  });

  it('should normalize tool-returned unstructured failure', async () => {
    const manager = new ToolManager();
    manager.register(new FailingTool());
    const result = await manager.executeTool('failing', {}, executeContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain('TOOL_EXECUTION_ERROR');
    expect(result.data).toMatchObject({
      code: 'TOOL_EXECUTION_ERROR',
      stage: 'execution',
      recoverable: true,
    });
  });

  it('should preserve tool-level structured conflict payload', async () => {
    const manager = new ToolManager();
    manager.register(new ConflictTool());
    const result = await manager.executeTool('conflict', {}, executeContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain('PATCH_CONFLICT');
    expect(result.data).toMatchObject({
      code: 'PATCH_CONFLICT',
      error: 'PATCH_CONFLICT',
      stage: 'execution',
      next_actions: ['read', 'patch'],
      recoverable: true,
    });
  });

  it('should normalize invalid tool arguments JSON in executeTools', async () => {
    const manager = new ToolManager();
    manager.register(new EchoTool());

    const [valid] = await manager.executeTools(
      [createToolCall('echo', '{"text":"ok"}')],
      batchContext
    );
    expect(valid.result.success).toBe(true);

    const [result] = await manager.executeTools(
      [createToolCall('echo', '{"text":"x"')],
      batchContext
    );
    expect(result.result.success).toBe(false);
    expect(result.result.error).toContain('TOOL_ARGUMENTS_PARSE_ERROR');
    expect(result.result.data).toMatchObject({
      code: 'TOOL_ARGUMENTS_PARSE_ERROR',
      stage: 'parse_args',
      recoverable: true,
    });
  });

  it('should normalize timeout errors in executeTools', async () => {
    const manager = new ToolManager({ timeout: 10 });
    manager.register(new SlowTool());

    const [result] = await manager.executeTools([createToolCall('slow', '{}')], batchContext);
    expect(result.result.success).toBe(false);
    expect(result.result.error).toContain('TOOL_TIMEOUT');
    expect(result.result.data).toMatchObject({
      code: 'TOOL_TIMEOUT',
      stage: 'timeout',
      recoverable: true,
    });
  });

  it('should use the smaller timeout from tool arguments and manager config', async () => {
    const manager = new ToolManager({ timeout: 1000 });
    manager.register(new SlowTool());

    const [result] = await manager.executeTools(
      [createToolCall('slow', '{"timeout":10}')],
      batchContext
    );
    expect(result.result.success).toBe(false);
    expect(result.result.error).toContain('TOOL_TIMEOUT');
    expect(result.result.data).toMatchObject({
      code: 'TOOL_TIMEOUT',
      stage: 'timeout',
    });
  });

  it('should use tool default timeout when it is smaller than manager timeout', async () => {
    const manager = new ToolManager({ timeout: 1000 });
    manager.register(new ToolDefaultTimeoutTool());

    const [result] = await manager.executeTools(
      [createToolCall('tool-default-timeout', '{}')],
      batchContext
    );
    expect(result.result.success).toBe(false);
    expect(result.result.error).toContain('TOOL_TIMEOUT');
    expect(result.result.data).toMatchObject({
      code: 'TOOL_TIMEOUT',
      stage: 'timeout',
    });
  });

  it('should honor explicit long tool timeout over manager timeout', async () => {
    const manager = new ToolManager({ timeout: 10 });
    manager.register(new ToolLongTimeoutTool());

    const [result] = await manager.executeTools(
      [createToolCall('tool-long-timeout', '{}')],
      batchContext
    );
    expect(result.result.success).toBe(true);
    expect(result.result.data).toMatchObject({ done: true });
  });

  it('should abort running tool when timeout is reached', async () => {
    const manager = new ToolManager({ timeout: 10 });
    const state = { aborted: false };
    manager.register(new AbortAwareSlowTool(state));

    const [result] = await manager.executeTools(
      [createToolCall('abort-aware-slow', '{}')],
      batchContext
    );
    expect(result.result.success).toBe(false);
    expect(result.result.error).toContain('TOOL_TIMEOUT');

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(state.aborted).toBe(true);
  });

  it('should normalize onError hook failures', async () => {
    const manager = new ToolManager();
    manager.register(new OnErrorCrashTool());

    const result = await manager.executeTool('onerror-crash', {}, executeContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('TOOL_ONERROR_FAILED');
    expect(result.data).toMatchObject({
      code: 'TOOL_ONERROR_FAILED',
      stage: 'execution',
    });
    expect(result.data).toHaveProperty('details');
  });

  it('should require confirmation when tool meta requires it and no callback is provided', async () => {
    const manager = new ToolManager();
    manager.register(new ConfirmedTool());

    const [result] = await manager.executeTools([createToolCall('confirmed', '{}')], batchContext);
    expect(result.result.success).toBe(false);
    expect(result.result.error).toContain('TOOL_CONFIRMATION_REQUIRED');
    expect(result.result.data).toMatchObject({
      code: 'TOOL_CONFIRMATION_REQUIRED',
      stage: 'confirmation',
    });
  });

  it('should deny execution when user confirmation callback returns deny', async () => {
    const manager = new ToolManager();
    manager.register(new ConfirmedTool());

    const [result] = await manager.executeTools([createToolCall('confirmed', '{}')], batchContext, {
      onToolConfirm: async () => 'deny' as const,
    });

    expect(result.result.success).toBe(false);
    expect(result.result.error).toContain('TOOL_CONFIRMATION_DENIED');
  });

  it('should execute tool when user confirmation callback returns approve', async () => {
    const manager = new ToolManager();
    manager.register(new ConfirmedTool());

    const [result] = await manager.executeTools([createToolCall('confirmed', '{}')], batchContext, {
      onToolConfirm: async () => 'approve' as const,
    });

    expect(result.result.success).toBe(true);
    expect(result.result.data).toMatchObject({ ok: true });
  });

  it('should pass dynamic confirmation reason to callback', async () => {
    const manager = new ToolManager();
    manager.register(new DynamicConfirmTool());
    const seenReasons: string[] = [];

    const [result] = await manager.executeTools(
      [createToolCall('dynamic-confirm', '{"text":"danger operation"}')],
      batchContext,
      {
        onToolConfirm: async (request) => {
          if (request.reason) {
            seenReasons.push(request.reason);
          }
          return 'approve' as const;
        },
      }
    );

    expect(result.result.success).toBe(true);
    expect(seenReasons).toContain('dangerous content');
  });

  it('should require confirmation for bash commands outside allowlist instead of direct block', async () => {
    const manager = new ToolManager();
    manager.register(new BashTool());

    const [result] = await manager.executeTools(
      [createToolCall('bash', '{"command":"unknowncmd --help"}')],
      batchContext
    );

    expect(result.result.success).toBe(false);
    expect(result.result.error).toContain('TOOL_CONFIRMATION_REQUIRED');
    expect(result.result.error).not.toContain('COMMAND_BLOCKED_BY_POLICY');
    expect(result.result.data).toMatchObject({
      code: 'TOOL_CONFIRMATION_REQUIRED',
      stage: 'confirmation',
      tool: 'bash',
    });
  });
});

describe('ToolManager toToolsSchema', () => {
  it('should generate tool schema with correct parameters from Zod schema', () => {
    const manager = new ToolManager();
    manager.register(new EchoTool());

    const schemas = manager.toToolsSchema();

    expect(schemas).toHaveLength(1);
    expect(schemas[0].type).toBe('function');
    expect(schemas[0].function.name).toBe('echo');
    expect(schemas[0].function.description).toBe('Echo input');
    expect(schemas[0].function.parameters).toMatchObject({
      type: 'object',
      properties: {
        text: {
          type: 'string',
        },
      },
      required: ['text'],
    });
  });

  it('should generate schema for multiple tools', () => {
    const manager = new ToolManager();
    manager.register([new EchoTool(), new FailingTool()]);

    const schemas = manager.toToolsSchema();

    expect(schemas).toHaveLength(2);
    expect(schemas.map((s) => s.function.name)).toContain('echo');
    expect(schemas.map((s) => s.function.name)).toContain('failing');
  });

  it('should filter out disabled tools', () => {
    class DisabledTool extends BaseTool<typeof emptySchema> {
      get meta() {
        return {
          name: 'disabled',
          description: 'Disabled tool',
          parameters: emptySchema,
          enabled: false,
        };
      }

      async execute() {
        return { success: true, data: {} };
      }
    }

    const manager = new ToolManager();
    manager.register([new EchoTool(), new DisabledTool()]);

    const schemas = manager.toToolsSchema();

    expect(schemas).toHaveLength(1);
    expect(schemas[0].function.name).toBe('echo');
  });

  it('should include complex parameter types in schema', () => {
    const complexSchema = z.object({
      name: z.string().describe('The name'),
      count: z.number().int().min(0).max(100),
      enabled: z.boolean(),
      tags: z.array(z.string()),
      mode: z.enum(['auto', 'manual']),
      optional: z.string().optional(),
    });

    class ComplexTool extends BaseTool<typeof complexSchema> {
      get meta() {
        return {
          name: 'complex',
          description: 'Complex parameter types',
          parameters: complexSchema,
        };
      }

      async execute() {
        return { success: true, data: {} };
      }
    }

    const manager = new ToolManager();
    manager.register(new ComplexTool());

    const schemas = manager.toToolsSchema();
    const params = schemas[0].function.parameters as Record<string, unknown>;

    expect(params).toMatchObject({
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The name' },
        count: { type: 'integer', minimum: 0, maximum: 100 },
        enabled: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string' } },
        mode: { type: 'string', enum: ['auto', 'manual'] },
      },
    });

    // optional field should not be in required
    const required = params.required as string[];
    expect(required).toContain('name');
    expect(required).toContain('count');
    expect(required).toContain('enabled');
    expect(required).toContain('tags');
    expect(required).toContain('mode');
    expect(required).not.toContain('optional');
  });

  it('should return empty array when no tools registered', () => {
    const manager = new ToolManager();

    const schemas = manager.toToolsSchema();

    expect(schemas).toEqual([]);
  });
});

// =============================================================================
// 取消和异常场景测试
// =============================================================================

describe('ToolManager cancellation and exception scenarios', () => {
  // ---------------------------------------------------------------------
  // 超时取消测试
  // ---------------------------------------------------------------------

  it('should cancel tool execution when manager timeout is reached', async () => {
    class VerySlowTool extends BaseTool<typeof emptySchema> {
      get meta() {
        return {
          name: 'very-slow-timeout',
          description: 'Very slow tool for timeout test',
          parameters: emptySchema,
        };
      }

      async execute() {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return { success: true, data: { done: true } };
      }
    }

    const manager = new ToolManager({ timeout: 50 });
    manager.register(new VerySlowTool());

    const startTime = Date.now();
    const [result] = await manager.executeTools(
      [createToolCall('very-slow-timeout', '{}')],
      batchContext
    );
    const elapsed = Date.now() - startTime;

    expect(result.result.success).toBe(false);
    expect(result.result.error).toContain('TOOL_TIMEOUT');
    // 应该接近超时时间
    expect(elapsed).toBeLessThan(300);
  });

  it('should cancel tool execution via AbortController', async () => {
    const manager = new ToolManager();
    const abortController = new AbortController();

    class AbortSignalTool extends BaseTool<typeof emptySchema> {
      get meta() {
        return {
          name: 'abort-signal-tool',
          description: 'Check abort signal',
          parameters: emptySchema,
        };
      }

      async execute(_args: z.infer<typeof emptySchema>, context: ToolExecutionContext) {
        await new Promise((_, reject) => {
          const timer = setTimeout(() => reject(new Error('timeout')), 1000);
          context.toolAbortSignal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
          });
        });
        return { success: true, data: {} };
      }
    }

    manager.register(new AbortSignalTool());

    // 启动执行后立即取消
    const executePromise = manager.executeTool(
      'abort-signal-tool',
      {},
      {
        ...executeContext,
        toolAbortSignal: abortController.signal,
      }
    );

    setTimeout(() => abortController.abort(), 50);

    const result = await executePromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('aborted');
  });

  it('should handle zero timeout as no timeout', async () => {
    const manager = new ToolManager({ timeout: 0 });
    manager.register(new SlowTool());

    const result = await manager.executeTool('slow', {}, executeContext);
    // 0 超时应被视为无超时
    expect(result.success).toBe(true);
  });

  it('should handle very long timeout gracefully', async () => {
    const manager = new ToolManager({ timeout: 600000 }); // 10分钟
    manager.register(new SlowTool());

    const result = await manager.executeTool('slow', {}, executeContext);
    expect(result.success).toBe(true);
  });

  // ---------------------------------------------------------------------
  // 工具执行取消测试
  // ---------------------------------------------------------------------

  it('should handle tool execution error with stack trace', async () => {
    const manager = new ToolManager();
    manager.register(
      new ThrowTool(() => {
        const error = new Error('Test error with stack');
        error.stack = 'Error: Test error with stack\n    at test (test.ts:1:1)';
        return error;
      })
    );

    const result = await manager.executeTool('thrower', {}, executeContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Test error with stack');
  });

  it('should handle multiple sequential tool failures', async () => {
    const manager = new ToolManager();
    manager.register(new FailingTool());

    const result1 = await manager.executeTool('failing', {}, executeContext);
    expect(result1.success).toBe(false);

    const result2 = await manager.executeTool('failing', {}, executeContext);
    expect(result2.success).toBe(false);
  });

  it('should handle concurrent tool executions', async () => {
    const manager = new ToolManager();
    manager.register(new EchoTool());

    const results = await Promise.all([
      manager.executeTool('echo', { text: 'one' }, executeContext),
      manager.executeTool('echo', { text: 'two' }, executeContext),
      manager.executeTool('echo', { text: 'three' }, executeContext),
    ]);

    expect(results.every((r) => r.success)).toBe(true);
    expect(results[0].data).toMatchObject({ text: 'one' });
    expect(results[1].data).toMatchObject({ text: 'two' });
    expect(results[2].data).toMatchObject({ text: 'three' });
  });

  it('should handle partial failure in batch execution', async () => {
    const manager = new ToolManager();
    manager.register([new EchoTool(), new FailingTool()]);

    const results = await manager.executeTools(
      [
        createToolCall('echo', '{"text":"ok"}'),
        createToolCall('failing', '{}'),
        createToolCall('echo', '{"text":"also ok"}'),
      ],
      batchContext
    );

    expect(results[0].result.success).toBe(true);
    expect(results[1].result.success).toBe(false);
    expect(results[2].result.success).toBe(true);
  });

  // ---------------------------------------------------------------------
  // 异常场景测试
  // ---------------------------------------------------------------------

  it('should handle tool that returns null data', async () => {
    class NullDataTool extends BaseTool<typeof emptySchema> {
      get meta() {
        return {
          name: 'null-data',
          description: 'Returns null data',
          parameters: emptySchema,
        };
      }

      async execute() {
        return { success: true, data: null as unknown as Record<string, unknown> };
      }
    }

    const manager = new ToolManager();
    manager.register(new NullDataTool());

    const result = await manager.executeTool('null-data', {}, executeContext);
    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });

  it('should handle tool that returns undefined', async () => {
    class UndefinedTool extends BaseTool<typeof emptySchema> {
      get meta() {
        return {
          name: 'undefined-tool',
          description: 'Returns undefined',
          parameters: emptySchema,
        };
      }

      async execute() {
        return undefined as unknown as ToolResult;
      }
    }

    const manager = new ToolManager();
    manager.register(new UndefinedTool());

    const result = await manager.executeTool('undefined-tool', {}, executeContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('TOOL_EXECUTION_ERROR');
  });

  it('should handle tool that returns non-object', async () => {
    class NonObjectTool extends BaseTool<typeof emptySchema> {
      get meta() {
        return {
          name: 'non-object',
          description: 'Returns non-object',
          parameters: emptySchema,
        };
      }

      async execute() {
        return 'string result' as unknown as ToolResult;
      }
    }

    const manager = new ToolManager();
    manager.register(new NonObjectTool());

    const result = await manager.executeTool('non-object', {}, executeContext);
    expect(result.success).toBe(false);
  });

  it('should handle tool that throws non-Error', async () => {
    const manager = new ToolManager();
    manager.register(new ThrowTool(() => 'string error'));

    const result = await manager.executeTool('thrower', {}, executeContext);
    expect(result.success).toBe(false);
  });

  it('should handle tool that throws null', async () => {
    const manager = new ToolManager();
    manager.register(new ThrowTool(() => null));

    const result = await manager.executeTool('thrower', {}, executeContext);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('should handle tool that throws undefined', async () => {
    const manager = new ToolManager();
    manager.register(new ThrowTool(() => undefined));

    const result = await manager.executeTool('thrower', {}, executeContext);
    expect(result.success).toBe(false);
  });

  it('should handle empty arguments object', async () => {
    const manager = new ToolManager();
    manager.register(new EchoTool());

    const result = await manager.executeTool('echo', {}, executeContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('TOOL_VALIDATION_ERROR');
  });

  it('should handle missing required arguments', async () => {
    const manager = new ToolManager();
    manager.register(new EchoTool());

    const result = await manager.executeTool('echo', { notText: 'value' }, executeContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('TOOL_VALIDATION_ERROR');
  });

  it('should handle invalid argument types', async () => {
    const manager = new ToolManager();
    manager.register(new EchoTool());

    const result = await manager.executeTool('echo', { text: 123 }, executeContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('TOOL_VALIDATION_ERROR');
  });

  it('should handle tool name with special characters', async () => {
    const manager = new ToolManager();
    manager.register(new EchoTool());

    const result = await manager.executeTool('ec\0ho', {}, executeContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('TOOL_NOT_FOUND');
  });

  it('should handle tool lookup case sensitivity', async () => {
    const manager = new ToolManager();
    manager.register(new EchoTool());

    const result = await manager.executeTool('ECHO', {}, executeContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('TOOL_NOT_FOUND');
  });

  it('should handle very long tool name', async () => {
    const manager = new ToolManager();
    manager.register(new EchoTool());

    const longName = 'e'.repeat(1000);
    const result = await manager.executeTool(longName, {}, executeContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain('TOOL_NOT_FOUND');
  });

  it('should handle tool execution in quick succession', async () => {
    const manager = new ToolManager();
    manager.register(new EchoTool());

    // 快速连续执行多个工具
    for (let i = 0; i < 10; i++) {
      const result = await manager.executeTool('echo', { text: `test-${i}` }, executeContext);
      expect(result.success).toBe(true);
    }
  });

  it('should handle batch execution with many tools', async () => {
    const manager = new ToolManager();
    manager.register(new EchoTool());

    // 创建大量工具调用
    const toolCalls = Array(50)
      .fill(null)
      .map((_, i) => createToolCall('echo', `{"text":"test-${i}"}`));

    const results = await manager.executeTools(toolCalls, batchContext);

    expect(results).toHaveLength(50);
    expect(results.every((r) => r.result.success)).toBe(true);
  });

  it('should handle tool that takes very long to execute beyond timeout', async () => {
    class VerySlowTool extends BaseTool<typeof emptySchema> {
      get meta() {
        return {
          name: 'very-slow-long',
          description: 'Very slow tool',
          parameters: emptySchema,
        };
      }

      async execute() {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return { success: true, data: {} };
      }
    }

    const manager = new ToolManager({ timeout: 100 });
    manager.register(new VerySlowTool());

    const startTime = Date.now();
    const [result] = await manager.executeTools(
      [createToolCall('very-slow-long', '{}')],
      batchContext
    );
    const elapsed = Date.now() - startTime;

    expect(result.result.success).toBe(false);
    expect(result.result.error).toContain('TOOL_TIMEOUT');
    // 应该在大约100ms后超时
    expect(elapsed).toBeLessThan(500);
  }, 10000);

  it('should handle tool returning success with empty data', async () => {
    class EmptyDataTool extends BaseTool<typeof emptySchema> {
      get meta() {
        return {
          name: 'empty-data',
          description: 'Returns empty data',
          parameters: emptySchema,
        };
      }

      async execute() {
        return { success: true, data: {} };
      }
    }

    const manager = new ToolManager();
    manager.register(new EmptyDataTool());

    const result = await manager.executeTool('empty-data', {}, executeContext);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({});
  });

  it('should handle tool with circular reference in returned data', async () => {
    class CircularTool extends BaseTool<typeof emptySchema> {
      get meta() {
        return {
          name: 'circular',
          description: 'Returns circular data',
          parameters: emptySchema,
        };
      }

      async execute() {
        const obj: Record<string, unknown> = { value: 'test' };
        obj.self = obj;
        return { success: true, data: obj };
      }
    }

    const manager = new ToolManager();
    manager.register(new CircularTool());

    const result = await manager.executeTool('circular', {}, executeContext);
    expect(result.success).toBe(true);
  });
});

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

import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { BaseTool, ToolResult } from '../base-tool';
import { DefaultToolManager } from '../tool-manager';
import {
  EmptyToolNameError,
  InvalidArgumentsError,
  ToolDeniedError,
  ToolExecutionError,
  ToolNotFoundError,
  ToolPolicyDeniedError,
  ToolValidationError,
} from '../error';
import type { ToolExecutionContext } from '../types';

const schema = z.object({
  input: z.string().min(1),
});

class EchoTool extends BaseTool<typeof schema> {
  name = 'echo';
  description = 'echo input';
  parameters = schema;

  shouldConfirm(): boolean {
    return false;
  }

  async execute(args: z.infer<typeof schema>): Promise<ToolResult> {
    return {
      success: true,
      output: args.input,
    };
  }
}

class ConfirmEchoTool extends EchoTool {
  override name = 'confirm-echo';

  override shouldConfirm(): boolean {
    return true;
  }
}

class ThrowingTool extends EchoTool {
  override async execute(): Promise<ToolResult> {
    throw new Error('run failed');
  }
}

class ParallelReadTool extends EchoTool {
  override name = 'parallel-echo';

  override getConcurrencyMode(): 'parallel-safe' {
    return 'parallel-safe';
  }

  override getConcurrencyLockKey(args: z.infer<typeof schema>): string | undefined {
    return `resource:${args.input}`;
  }
}

class ParallelNoLockTool extends EchoTool {
  override name = 'parallel-no-lock';

  override getConcurrencyMode(): 'parallel-safe' {
    return 'parallel-safe';
  }
}

const bashSchema = z.object({
  command: z.string().min(1),
});

class SafeBashTool extends BaseTool<typeof bashSchema> {
  name = 'bash';
  description = 'bash command';
  parameters = bashSchema;

  async execute(args: z.infer<typeof bashSchema>): Promise<ToolResult> {
    return {
      success: true,
      output: args.command,
    };
  }
}

function createContext(partial?: Partial<ToolExecutionContext>): ToolExecutionContext {
  return {
    toolCallId: 'call_1',
    loopIndex: 1,
    agent: {},
    ...partial,
  };
}

describe('DefaultToolManager', () => {
  it('returns EmptyToolNameError when tool name is empty', async () => {
    const manager = new DefaultToolManager();

    const result = await manager.execute(
      {
        id: 't1',
        type: 'function',
        index: 0,
        function: { name: '', arguments: '{}' },
      },
      createContext()
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(EmptyToolNameError);
    expect(result.output).toBe('Tool name is empty');
  });

  it('returns InvalidArgumentsError when arguments are invalid json', async () => {
    const manager = new DefaultToolManager();

    const result = await manager.execute(
      {
        id: 't2',
        type: 'function',
        index: 0,
        function: { name: 'echo', arguments: '{bad' },
      },
      createContext()
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(InvalidArgumentsError);
    expect(result.output).toContain('Invalid arguments format for tool echo');
  });

  it('returns ToolNotFoundError for missing handler', async () => {
    const manager = new DefaultToolManager();

    const result = await manager.execute(
      {
        id: 't3',
        type: 'function',
        index: 0,
        function: { name: 'missing', arguments: '{}' },
      },
      createContext()
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(ToolNotFoundError);
    expect(result.output).toBe('Tool missing not found');
  });

  it('returns ToolValidationError for invalid parameters', async () => {
    const manager = new DefaultToolManager();
    manager.registerTool(
      {
        name: 'echo',
        description: 'echo',
        parameters: {},
      },
      new EchoTool()
    );

    const result = await manager.execute(
      {
        id: 't4',
        type: 'function',
        index: 0,
        function: { name: 'echo', arguments: '{}' },
      },
      createContext()
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(ToolValidationError);
    expect(result.output).toContain('expected string');
  });

  it('returns ToolPolicyDeniedError when policy check rejects execution', async () => {
    const manager = new DefaultToolManager();
    manager.registerTool(
      {
        name: 'echo',
        description: 'echo',
        parameters: {},
      },
      new EchoTool()
    );

    const onPolicyCheck = vi.fn().mockResolvedValue({
      allowed: false,
      code: 'PATH_NOT_ALLOWED',
      message: 'outside workspace',
    });
    const result = await manager.execute(
      {
        id: 't4_policy',
        type: 'function',
        index: 0,
        function: { name: 'echo', arguments: '{"input":"abc"}' },
      },
      createContext({ onPolicyCheck })
    );

    expect(onPolicyCheck).toHaveBeenCalledOnce();
    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(ToolPolicyDeniedError);
    expect(result.output).toContain('[PATH_NOT_ALLOWED]');
  });

  it('blocks dangerous bash command with built-in policy and includes audit details', async () => {
    const manager = new DefaultToolManager();
    manager.registerTool(
      {
        name: 'bash',
        description: 'bash',
        parameters: {},
      },
      new SafeBashTool()
    );

    const result = await manager.execute(
      {
        id: 't4_builtin_policy',
        type: 'function',
        index: 0,
        function: { name: 'bash', arguments: '{"command":"rm -rf /"}' },
      },
      createContext()
    );

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(ToolPolicyDeniedError);
    expect(result.output).toContain('[DANGEROUS_COMMAND]');
    expect((result.error as ToolPolicyDeniedError).details).toMatchObject({
      toolName: 'bash',
      reasonCode: 'DANGEROUS_COMMAND',
      audit: {
        toolCallId: 't4_builtin_policy',
        toolName: 'bash',
        source: 'builtin',
      },
    });
  });

  it('executes when policy check allows and receives parsed arguments', async () => {
    const manager = new DefaultToolManager();
    const tool = new EchoTool();
    const executeSpy = vi.spyOn(tool, 'execute');
    manager.registerTool(
      {
        name: 'echo',
        description: 'echo',
        parameters: {},
      },
      tool
    );

    const onPolicyCheck = vi.fn().mockResolvedValue({
      allowed: true,
    });
    const result = await manager.execute(
      {
        id: 't4_policy_allow',
        type: 'function',
        index: 0,
        function: { name: 'echo', arguments: '{"input":"abc"}' },
      },
      createContext({ onPolicyCheck })
    );

    expect(onPolicyCheck).toHaveBeenCalledWith({
      toolCallId: 't4_policy_allow',
      toolName: 'echo',
      arguments: '{"input":"abc"}',
      parsedArguments: { input: 'abc' },
    });
    expect(executeSpy).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(result.output).toBe('abc');
  });

  it('returns ToolDeniedError when user rejects confirmation', async () => {
    const manager = new DefaultToolManager();
    manager.registerTool(
      {
        name: 'echo',
        description: 'echo',
        parameters: {},
      },
      new ConfirmEchoTool()
    );

    const onConfirm = vi.fn().mockResolvedValue({ approved: false, message: 'deny' });
    const result = await manager.execute(
      {
        id: 't5',
        type: 'function',
        index: 0,
        function: { name: 'echo', arguments: '{"input":"abc"}' },
      },
      createContext({ onConfirm })
    );

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(ToolDeniedError);
    expect(result.output).toBe('Tool echo denied: deny');
  });

  it('executes after confirmation approval', async () => {
    const manager = new DefaultToolManager();
    const tool = new ConfirmEchoTool();
    const execSpy = vi.spyOn(tool, 'execute');
    manager.registerTool(
      {
        name: 'echo',
        description: 'echo',
        parameters: {},
      },
      tool
    );

    const onConfirm = vi.fn().mockResolvedValue({ approved: true });
    const result = await manager.execute(
      {
        id: 't6',
        type: 'function',
        index: 0,
        function: { name: 'echo', arguments: '{"input":"abc"}' },
      },
      createContext({ onConfirm })
    );

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(execSpy).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(result.output).toBe('abc');
  });

  it('executes directly when confirm callback is not provided', async () => {
    const manager = new DefaultToolManager();
    const tool = new ConfirmEchoTool();
    const execSpy = vi.spyOn(tool, 'execute');
    manager.registerTool(
      {
        name: 'echo',
        description: 'echo',
        parameters: {},
      },
      tool
    );

    const result = await manager.execute(
      {
        id: 't7',
        type: 'function',
        index: 0,
        function: { name: 'echo', arguments: '{"input":"no-confirm"}' },
      },
      createContext()
    );

    expect(execSpy).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(result.output).toBe('no-confirm');
  });

  it('wraps handler execution error with ToolExecutionError and emits stderr chunk', async () => {
    const manager = new DefaultToolManager();
    manager.registerTool(
      {
        name: 'echo',
        description: 'echo',
        parameters: {},
      },
      new ThrowingTool()
    );

    const onChunk = vi.fn();
    const result = await manager.execute(
      {
        id: 't8',
        type: 'function',
        index: 0,
        function: { name: 'echo', arguments: '{"input":"x"}' },
      },
      createContext({ onChunk })
    );

    expect(onChunk).toHaveBeenCalledWith({ type: 'stderr', data: 'run failed' });
    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(ToolExecutionError);
    expect(result.output).toBe('run failed');
  });

  it('registerTool and getTools returns all tools', () => {
    const manager = new DefaultToolManager();
    manager.registerTool(
      {
        name: 'echo',
        description: 'echo',
        parameters: { type: 'object' },
      },
      new EchoTool()
    );
    manager.registerTool(
      {
        name: 'confirm-echo',
        description: 'confirm echo',
        parameters: { type: 'object' },
      },
      new ConfirmEchoTool()
    );

    const tools = manager.getTools();
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).toEqual(['echo', 'confirm-echo']);
  });

  it('toToolsSchema maps registered handlers to LLM tool schemas', () => {
    const manager = new DefaultToolManager();
    manager.registerTool(
      {
        name: 'echo',
        description: 'echo',
        parameters: { type: 'object' },
      },
      new EchoTool()
    );

    const schemas = manager.toToolsSchema();
    expect(schemas).toHaveLength(1);
    expect(schemas[0]).toMatchObject({
      type: 'function',
      function: { name: 'echo' },
    });
  });

  it('getConcurrencyPolicy returns exclusive for unknown tool', () => {
    const manager = new DefaultToolManager();
    const policy = manager.getConcurrencyPolicy({
      id: 'c1',
      type: 'function',
      index: 0,
      function: { name: 'missing', arguments: '{}' },
    });

    expect(policy).toEqual({ mode: 'exclusive' });
  });

  it('getConcurrencyPolicy reads mode and lockKey from tool handler', () => {
    const manager = new DefaultToolManager();
    manager.registerTool(
      {
        name: 'parallel-echo',
        description: 'parallel echo',
        parameters: {},
      },
      new ParallelReadTool()
    );

    const policy = manager.getConcurrencyPolicy({
      id: 'c2',
      type: 'function',
      index: 0,
      function: { name: 'parallel-echo', arguments: '{"input":"abc"}' },
    });

    expect(policy).toEqual({
      mode: 'parallel-safe',
      lockKey: 'resource:abc',
    });
  });

  it('getConcurrencyPolicy returns mode-only when handler has no lock key', () => {
    const manager = new DefaultToolManager();
    manager.registerTool(
      {
        name: 'parallel-no-lock',
        description: 'parallel no lock',
        parameters: {},
      },
      new ParallelNoLockTool()
    );

    const policy = manager.getConcurrencyPolicy({
      id: 'c5',
      type: 'function',
      index: 0,
      function: { name: 'parallel-no-lock', arguments: '{"input":"abc"}' },
    });

    expect(policy).toEqual({ mode: 'parallel-safe' });
  });

  it('getConcurrencyPolicy falls back to exclusive for invalid json args', () => {
    const manager = new DefaultToolManager();
    manager.registerTool(
      {
        name: 'parallel-echo',
        description: 'parallel echo',
        parameters: {},
      },
      new ParallelReadTool()
    );

    const policy = manager.getConcurrencyPolicy({
      id: 'c3',
      type: 'function',
      index: 0,
      function: { name: 'parallel-echo', arguments: '{bad' },
    });

    expect(policy).toEqual({ mode: 'exclusive' });
  });

  it('getConcurrencyPolicy falls back to exclusive for validation failure', () => {
    const manager = new DefaultToolManager();
    manager.registerTool(
      {
        name: 'parallel-echo',
        description: 'parallel echo',
        parameters: {},
      },
      new ParallelReadTool()
    );

    const policy = manager.getConcurrencyPolicy({
      id: 'c4',
      type: 'function',
      index: 0,
      function: { name: 'parallel-echo', arguments: '{}' },
    });

    expect(policy).toEqual({ mode: 'exclusive' });
  });
});

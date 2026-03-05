/**
 * Hook 类型定义测试
 *
 * 测试覆盖：
 * - 类型导出正确性
 * - 类型约束验证
 * - 类型兼容性
 */

import { describe, it, expect } from 'vitest';
import type {
  HookStrategy,
  ConfigHook,
  SystemPromptHook,
  UserPromptHook,
  ToolsHook,
  ToolUseHook,
  ToolResultHook,
  ToolStreamHook,
  ToolConfirmHook,
  StepHook,
  LoopHook,
  StopHook,
  TextDeltaHook,
  TextCompleteHook,
  Plugin,
  PluginEnforce,
  HookDefinition,
  HookPointConfig,
  HookContext,
} from '../types';
import type { Tool } from '../../providers';
import type { ToolCall, ToolResult, AgentLoopState, ToolStreamEvent } from '../../core/types';

// =============================================================================
// Type Guards & Helpers
// =============================================================================

/**
 * Helper function to verify type compatibility at compile time
 * This function will cause TypeScript errors if types are incompatible
 */
function assertType<T>(_value: T): void {
  // This function does nothing at runtime
  // It only serves to verify type compatibility at compile time
}

// =============================================================================
// Hook Strategy Type Tests
// =============================================================================

describe('HookStrategy Type', () => {
  it('should accept valid strategy values', () => {
    const strategies: HookStrategy[] = ['series', 'series-last', 'series-merge'];

    strategies.forEach((strategy) => {
      expect(['series', 'series-last', 'series-merge']).toContain(strategy);
    });
  });

  it('should have exactly three strategy options', () => {
    const validStrategies: HookStrategy[] = ['series', 'series-last', 'series-merge'];
    expect(validStrategies).toHaveLength(3);
  });
});

// =============================================================================
// Plugin Enforce Type Tests
// =============================================================================

describe('PluginEnforce Type', () => {
  it('should accept valid enforce values', () => {
    const enforceValues: PluginEnforce[] = ['pre', 'post'];

    enforceValues.forEach((enforce) => {
      expect(['pre', 'post']).toContain(enforce);
    });
  });
});

// =============================================================================
// ConfigHook Type Tests
// =============================================================================

describe('ConfigHook Type', () => {
  it('should accept sync config hook', () => {
    const hook: ConfigHook = (config, _ctx) => ({
      ...config,
      modified: true,
    });

    const result = hook({ original: true }, {} as HookContext);
    expect(result).toEqual({ original: true, modified: true });
  });

  it('should accept async config hook', async () => {
    const hook: ConfigHook = async (config, _ctx) => {
      await Promise.resolve();
      return { ...config, async: true };
    };

    const result = await hook({}, {} as HookContext);
    expect(result).toEqual({ async: true });
  });

  it('should support generic config type', () => {
    interface MyConfig {
      model: string;
      temperature?: number;
    }

    const hook: ConfigHook<MyConfig> = (config, _ctx) => ({
      ...config,
      temperature: config.temperature ?? 0.7,
    });

    const result = hook({ model: 'gpt-4' }, {} as HookContext);
    expect(result).toEqual({ model: 'gpt-4', temperature: 0.7 });
  });
});

// =============================================================================
// SystemPromptHook Type Tests
// =============================================================================

describe('SystemPromptHook Type', () => {
  it('should accept sync system prompt hook', () => {
    const hook: SystemPromptHook = (prompt, _ctx) => `${prompt}\n\nBe helpful.`;

    const result = hook('You are an assistant.', {} as HookContext);
    expect(result).toBe('You are an assistant.\n\nBe helpful.');
  });

  it('should accept async system prompt hook', async () => {
    const hook: SystemPromptHook = async (prompt, _ctx) => {
      await Promise.resolve();
      return `[System] ${prompt}`;
    };

    const result = await hook('Hello', {} as HookContext);
    expect(result).toBe('[System] Hello');
  });
});

// =============================================================================
// UserPromptHook Type Tests
// =============================================================================

describe('UserPromptHook Type', () => {
  it('should accept sync user prompt hook', () => {
    const hook: UserPromptHook = (prompt, _ctx) => `User: ${prompt}`;

    const result = hook('Hello', {} as HookContext);
    expect(result).toBe('User: Hello');
  });

  it('should accept async user prompt hook', async () => {
    const hook: UserPromptHook = async (prompt, _ctx) => {
      await Promise.resolve();
      return prompt.toUpperCase();
    };

    const result = await hook('hello', {} as HookContext);
    expect(result).toBe('HELLO');
  });
});

// =============================================================================
// ToolsHook Type Tests
// =============================================================================

describe('ToolsHook Type', () => {
  const mockTool: Tool = {
    type: 'function',
    function: {
      name: 'test-tool',
      description: 'A test tool',
      parameters: {},
    },
  };

  it('should accept sync tools hook', async () => {
    const hook: ToolsHook = (tools, _ctx) => [...tools, mockTool];

    const result = await hook([], {} as HookContext);
    expect(result).toHaveLength(1);
    expect(result[0].function.name).toBe('test-tool');
  });

  it('should accept async tools hook', async () => {
    const hook: ToolsHook = async (tools, _ctx) => {
      await Promise.resolve();
      return tools.filter((t) => t.function.name !== 'remove-me');
    };

    const result = await hook(
      [mockTool, { ...mockTool, function: { ...mockTool.function, name: 'remove-me' } }],
      {} as HookContext
    );
    expect(result).toHaveLength(1);
  });
});

// =============================================================================
// ToolUseHook Type Tests
// =============================================================================

describe('ToolUseHook Type', () => {
  const mockToolCall: ToolCall = {
    id: 'call-123',
    type: 'function',
    index: 0,
    function: {
      name: 'test_tool',
      arguments: '{"arg": "value"}',
    },
  };

  it('should accept sync tool use hook', async () => {
    const hook: ToolUseHook = (toolCall, _ctx) => ({
      ...toolCall,
      function: {
        ...toolCall.function,
        arguments: JSON.stringify({ modified: true }),
      },
    });

    const result = await hook(mockToolCall, {} as HookContext);
    expect(result.function.arguments).toBe(JSON.stringify({ modified: true }));
  });

  it('should accept async tool use hook', async () => {
    const hook: ToolUseHook = async (toolCall, _ctx) => {
      await Promise.resolve();
      return { ...toolCall, id: `${toolCall.id}-modified` };
    };

    const result = await hook(mockToolCall, {} as HookContext);
    expect(result.id).toBe('call-123-modified');
  });
});

// =============================================================================
// ToolResultHook Type Tests
// =============================================================================

describe('ToolResultHook Type', () => {
  const mockToolCall: ToolCall = {
    id: 'call-123',
    type: 'function',
    index: 0,
    function: {
      name: 'test_tool',
      arguments: '{}',
    },
  };

  const mockResult: ToolResult = {
    success: true,
    data: { output: 'test' },
  };

  it('should accept sync tool result hook', async () => {
    const hook: ToolResultHook = (data, _ctx) => ({
      ...data,
      result: { ...data.result, modified: true },
    });

    const result = await hook({ toolCall: mockToolCall, result: mockResult }, {} as HookContext);
    expect((result.result.data as Record<string, unknown>).output).toBe('test');
  });

  it('should accept async tool result hook', async () => {
    const hook: ToolResultHook = async (data, _ctx) => {
      await Promise.resolve();
      return {
        toolCall: { ...data.toolCall, id: 'modified' },
        result: data.result,
      };
    };

    const result = await hook({ toolCall: mockToolCall, result: mockResult }, {} as HookContext);
    expect(result.toolCall.id).toBe('modified');
  });
});

// =============================================================================
// StepHook Type Tests
// =============================================================================

describe('StepHook Type', () => {
  it('should accept sync step hook', () => {
    let called = false;
    const hook: StepHook = (step, _ctx) => {
      called = true;
      expect(step.stepIndex).toBe(1);
    };

    hook({ stepIndex: 1, toolCallsCount: 0 }, {} as HookContext);
    expect(called).toBe(true);
  });

  it('should accept async step hook', async () => {
    let called = false;
    const hook: StepHook = async (_step, _ctx) => {
      await Promise.resolve();
      called = true;
    };

    await hook({ stepIndex: 0, toolCallsCount: 0 }, {} as HookContext);
    expect(called).toBe(true);
  });

  it('should accept step hook with optional finishReason', () => {
    const hook: StepHook = (step, _ctx) => {
      if (step.finishReason) {
        expect(['stop', 'tool_call']).toContain(step.finishReason);
      }
    };

    hook({ stepIndex: 0, toolCallsCount: 0 }, {} as HookContext);
    hook({ stepIndex: 1, finishReason: 'stop', toolCallsCount: 2 }, {} as HookContext);
  });
});

// =============================================================================
// LoopHook Type Tests
// =============================================================================

describe('LoopHook Type', () => {
  it('should accept sync loop hook', () => {
    let called = false;
    const hook: LoopHook = (loop, _ctx) => {
      called = true;
      expect(loop.loopIndex).toBe(2);
      expect(loop.steps).toBe(5);
    };

    hook({ loopIndex: 2, steps: 5 }, {} as HookContext);
    expect(called).toBe(true);
  });

  it('should accept async loop hook', async () => {
    let called = false;
    const hook: LoopHook = async (_loop, _ctx) => {
      await Promise.resolve();
      called = true;
    };

    await hook({ loopIndex: 0, steps: 0 }, {} as HookContext);
    expect(called).toBe(true);
  });
});

// =============================================================================
// StopHook Type Tests
// =============================================================================

describe('StopHook Type', () => {
  it('should accept sync stop hook', () => {
    let receivedReason: string | undefined;
    const hook: StopHook = (reason, _ctx) => {
      receivedReason = reason.reason;
    };

    hook({ reason: 'complete' }, {} as HookContext);
    expect(receivedReason).toBe('complete');
  });

  it('should accept async stop hook', async () => {
    let called = false;
    const hook: StopHook = async (_reason, _ctx) => {
      await Promise.resolve();
      called = true;
    };

    await hook({ reason: 'stop' }, {} as HookContext);
    expect(called).toBe(true);
  });

  it('should accept stop hook with optional message', () => {
    let received: { reason: string; message?: string } | undefined;
    const hook: StopHook = (reason, _ctx) => {
      received = reason;
    };

    hook({ reason: 'error', message: 'Something went wrong' }, {} as HookContext);
    expect(received).toEqual({ reason: 'error', message: 'Something went wrong' });
  });
});

// =============================================================================
// TextDeltaHook Type Tests
// =============================================================================

describe('TextDeltaHook Type', () => {
  it('should accept sync text delta hook', () => {
    let received: { text: string; isReasoning?: boolean } | undefined;
    const hook: TextDeltaHook = (delta, _ctx) => {
      received = delta;
    };

    hook({ text: 'Hello', isReasoning: false }, {} as HookContext);
    expect(received).toEqual({ text: 'Hello', isReasoning: false });
  });

  it('should accept async text delta hook', async () => {
    let called = false;
    const hook: TextDeltaHook = async (_delta, _ctx) => {
      await Promise.resolve();
      called = true;
    };

    await hook({ text: 'test' }, {} as HookContext);
    expect(called).toBe(true);
  });

  it('should accept text delta hook with optional isReasoning', () => {
    let received: { text: string; isReasoning?: boolean } | undefined;
    const hook: TextDeltaHook = (delta, _ctx) => {
      received = delta;
    };

    hook({ text: 'Thinking...' }, {} as HookContext);
    expect(received?.text).toBe('Thinking...');
    expect(received?.isReasoning).toBeUndefined();
  });
});

// =============================================================================
// TextCompleteHook Type Tests
// =============================================================================

describe('TextCompleteHook Type', () => {
  it('should accept sync text complete hook', () => {
    let received: string | undefined;
    const hook: TextCompleteHook = (text, _ctx) => {
      received = text;
    };

    hook('Complete text', {} as HookContext);
    expect(received).toBe('Complete text');
  });

  it('should accept async text complete hook', async () => {
    let called = false;
    const hook: TextCompleteHook = async (_text, _ctx) => {
      await Promise.resolve();
      called = true;
    };

    await hook('test', {} as HookContext);
    expect(called).toBe(true);
  });
});

// =============================================================================
// ToolStreamHook Type Tests
// =============================================================================

describe('ToolStreamHook Type', () => {
  it('should accept sync tool stream hook', () => {
    let eventType: string | undefined;
    const hook: ToolStreamHook = (event, _ctx) => {
      eventType = event.type;
    };

    hook(
      {
        toolCallId: 'call-sync-1',
        toolName: 'bash',
        type: 'stdout',
        sequence: 1,
        timestamp: Date.now(),
        content: 'hello',
      },
      {} as HookContext
    );
    expect(eventType).toBe('stdout');
  });

  it('should accept async tool stream hook', async () => {
    let called = false;
    const hook: ToolStreamHook = async (_event, _ctx) => {
      await Promise.resolve();
      called = true;
    };

    await hook(
      {
        toolCallId: 'call-async-1',
        toolName: 'bash',
        type: 'progress',
        sequence: 2,
        timestamp: Date.now(),
        data: { progress: 80 },
      },
      {} as HookContext
    );
    expect(called).toBe(true);
  });
});

// =============================================================================
// Plugin Interface Tests
// =============================================================================

describe('Plugin Interface', () => {
  it('should accept minimal plugin with only name', () => {
    const plugin: Plugin = {
      name: 'minimal-plugin',
    };

    expect(plugin.name).toBe('minimal-plugin');
    expect(plugin.enforce).toBeUndefined();
  });

  it('should accept plugin with all hooks', () => {
    const plugin: Plugin = {
      name: 'full-plugin',
      enforce: 'pre',
      config: (c) => c,
      systemPrompt: (p) => p,
      userPrompt: (p) => p,
      tools: (t) => t,
      toolUse: (tc) => tc,
      toolResult: (r) => r,
      toolStream: (_e: ToolStreamEvent) => {},
      toolConfirm: () => {},
      step: () => {},
      loop: () => {},
      stop: () => {},
      textDelta: () => {},
      textComplete: () => {},
    };

    expect(plugin.name).toBe('full-plugin');
    expect(plugin.enforce).toBe('pre');
    expect(typeof plugin.config).toBe('function');
    expect(typeof plugin.systemPrompt).toBe('function');
    expect(typeof plugin.userPrompt).toBe('function');
    expect(typeof plugin.tools).toBe('function');
    expect(typeof plugin.toolUse).toBe('function');
    expect(typeof plugin.toolResult).toBe('function');
    expect(typeof plugin.toolStream).toBe('function');
    expect(typeof plugin.toolConfirm).toBe('function');
    expect(typeof plugin.step).toBe('function');
    expect(typeof plugin.loop).toBe('function');
    expect(typeof plugin.stop).toBe('function');
    expect(typeof plugin.textDelta).toBe('function');
    expect(typeof plugin.textComplete).toBe('function');
  });

  it('should accept plugin with enforce values', () => {
    const prePlugin: Plugin = { name: 'pre', enforce: 'pre' };
    const postPlugin: Plugin = { name: 'post', enforce: 'post' };

    expect(prePlugin.enforce).toBe('pre');
    expect(postPlugin.enforce).toBe('post');
  });

  it('should accept partial plugin implementations', () => {
    const configOnlyPlugin: Plugin = {
      name: 'config-only',
      config: (c) => c,
    };

    const stepOnlyPlugin: Plugin = {
      name: 'step-only',
      step: () => {},
    };

    expect(configOnlyPlugin.config).toBeDefined();
    expect(configOnlyPlugin.step).toBeUndefined();
    expect(stepOnlyPlugin.step).toBeDefined();
    expect(stepOnlyPlugin.config).toBeUndefined();
  });
});

// =============================================================================
// HookDefinition Interface Tests
// =============================================================================

describe('HookDefinition Interface', () => {
  it('should accept valid hook definition', () => {
    const definition: HookDefinition = {
      name: 'test-hook',
      strategy: 'series-last',
      handler: (data: unknown) => data,
      plugin: { name: 'test-plugin', enforce: 'pre' },
    };

    expect(definition.name).toBe('test-hook');
    expect(definition.strategy).toBe('series-last');
    expect(typeof definition.handler).toBe('function');
    expect(definition.plugin.name).toBe('test-plugin');
    expect(definition.plugin.enforce).toBe('pre');
  });

  it('should accept all strategy types', () => {
    const strategies: HookStrategy[] = ['series', 'series-last', 'series-merge'];

    strategies.forEach((strategy) => {
      const definition: HookDefinition = {
        name: `hook-${strategy}`,
        strategy,
        handler: () => {},
        plugin: { name: 'test', enforce: 'pre' },
      };

      expect(definition.strategy).toBe(strategy);
    });
  });
});

// =============================================================================
// HookPointConfig Interface Tests
// =============================================================================

describe('HookPointConfig Interface', () => {
  it('should accept valid hook point config', () => {
    const config: HookPointConfig = {
      strategy: 'series-merge',
    };

    expect(config.strategy).toBe('series-merge');
  });

  it('should accept all strategy types', () => {
    const strategies: HookStrategy[] = ['series', 'series-last', 'series-merge'];

    strategies.forEach((strategy) => {
      const config: HookPointConfig = { strategy };
      expect(config.strategy).toBe(strategy);
    });
  });
});

// =============================================================================
// HookContext Interface Tests
// =============================================================================

describe('HookContext Interface', () => {
  it('should accept valid hook context', () => {
    const context: HookContext = {
      loopIndex: 0,
      stepIndex: 1,
      sessionId: 'session-123',
      state: {
        loopIndex: 0,
        stepIndex: 1,
        currentText: 'Hello',
        currentToolCalls: [],
        totalUsage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        stepUsage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        retryCount: 0,
        needsRetry: false,
        aborted: false,
        resultStatus: 'continue',
      } as AgentLoopState,
    };

    expect(context.loopIndex).toBe(0);
    expect(context.stepIndex).toBe(1);
    expect(context.sessionId).toBe('session-123');
    expect(context.state).toBeDefined();
  });
});

// =============================================================================
// Type Export Tests
// =============================================================================

describe('Type Exports', () => {
  it('should export HookStrategy type', () => {
    const strategy: HookStrategy = 'series';
    expect(strategy).toBe('series');
  });

  it('should export PluginEnforce type', () => {
    const enforce: PluginEnforce = 'pre';
    expect(enforce).toBe('pre');
  });

  it('should export all hook function types', () => {
    // This test verifies all hook types are exported
    // TypeScript will error if any type is missing

    assertType<ConfigHook>((c) => c);
    assertType<SystemPromptHook>((p) => p);
    assertType<UserPromptHook>((p) => p);
    assertType<ToolsHook>((t) => t);
    assertType<ToolUseHook>((tc) => tc);
    assertType<ToolResultHook>((r) => r);
    assertType<ToolStreamHook>(() => {});
    assertType<ToolConfirmHook>(() => {});
    assertType<StepHook>(() => {});
    assertType<LoopHook>(() => {});
    assertType<StopHook>(() => {});
    assertType<TextDeltaHook>(() => {});
    assertType<TextCompleteHook>(() => {});

    expect(true).toBe(true);
  });

  it('should export Plugin interface', () => {
    const plugin: Plugin = { name: 'test' };
    expect(plugin.name).toBe('test');
  });

  it('should export HookDefinition interface', () => {
    const def: HookDefinition = {
      name: 'test',
      strategy: 'series',
      handler: () => {},
      plugin: { name: 'test', enforce: 'pre' },
    };
    expect(def.name).toBe('test');
  });

  it('should export HookPointConfig interface', () => {
    const config: HookPointConfig = { strategy: 'series' };
    expect(config.strategy).toBe('series');
  });

  it('should export HookContext interface', () => {
    const ctx: HookContext = {
      loopIndex: 0,
      stepIndex: 0,
      sessionId: 'test',
      state: {} as AgentLoopState,
    };
    expect(ctx.sessionId).toBe('test');
  });

  it('should export ToolCall and ToolResult from core types', () => {
    const toolCall: ToolCall = {
      id: 'call-1',
      type: 'function',
      index: 0,
      function: { name: 'test', arguments: '{}' },
    };

    const toolResult: ToolResult = {
      success: true,
      data: { result: 'ok' },
    };

    expect(toolCall.id).toBe('call-1');
    expect(toolResult.success).toBe(true);
  });
});

// =============================================================================
// Type Compatibility Tests
// =============================================================================

describe('Type Compatibility', () => {
  it('should allow Plugin with optional enforce', () => {
    const pluginWithoutEnforce: Plugin = { name: 'test' };
    const pluginWithEnforce: Plugin = { name: 'test', enforce: 'pre' };

    // Both should be valid Plugin types
    const plugins: Plugin[] = [pluginWithoutEnforce, pluginWithEnforce];
    expect(plugins).toHaveLength(2);
  });

  it('should allow hooks to be optional in Plugin', () => {
    const plugin1: Plugin = { name: 'p1' };
    const plugin2: Plugin = { name: 'p2', config: (c) => c };
    const plugin3: Plugin = { name: 'p3', step: () => {} };

    expect(plugin1.config).toBeUndefined();
    expect(plugin2.config).toBeDefined();
    expect(plugin3.step).toBeDefined();
  });

  it('should allow async hooks where sync hooks are expected', async () => {
    // This verifies that async hooks are compatible with the hook types
    const asyncConfigHook: ConfigHook = async (config) => {
      await Promise.resolve();
      return config;
    };

    const result = await asyncConfigHook({ test: true }, {} as HookContext);
    expect(result).toEqual({ test: true });
  });
});

/**
 * HookManager 完整测试
 *
 * 测试覆盖：
 * - 插件管理（注册、移除、排序）
 * - Hook 执行（各种执行策略）
 * - 执行顺序（pre/normal/post）
 * - 错误隔离
 * - 所有 Hook 点位
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { HookManager, createHookManager } from '../manager';
import type { Plugin, HookContext } from '../types';
import type { Tool } from '../../providers';
import type { ToolCall, ToolResult, AgentLoopState, ToolStreamEvent } from '../../core/types';
import type { ToolConfirmRequest } from '../../tool/types';

// =============================================================================
// Mock Data & Helpers
// =============================================================================

const createMockContext = (overrides?: Partial<HookContext>): HookContext => ({
  loopIndex: 0,
  stepIndex: 0,
  sessionId: 'test-session',
  state: {
    loopIndex: 0,
    stepIndex: 0,
    currentText: '',
    currentToolCalls: [],
    totalUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    stepUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    retryCount: 0,
    needsRetry: false,
    aborted: false,
    resultStatus: 'continue',
  } as AgentLoopState,
  ...overrides,
});

const createMockTool = (name: string): Tool => ({
  type: 'function',
  function: {
    name,
    description: `Mock tool: ${name}`,
    parameters: {},
  },
});

const createMockToolCall = (id: string, toolName: string): ToolCall => ({
  id,
  type: 'function',
  index: 0,
  function: {
    name: toolName,
    arguments: '{}',
  },
});

const createMockToolResult = (success: boolean = true): ToolResult => ({
  success,
  data: { result: 'test' },
});

const createMockToolConfirmRequest = (
  overrides?: Partial<ToolConfirmRequest>
): ToolConfirmRequest => ({
  toolCallId: 'call-confirm-1',
  toolName: 'bash',
  args: { command: 'rm -rf /tmp/x' },
  rawArgs: { command: 'rm -rf /tmp/x' },
  ...overrides,
});

// =============================================================================
// Plugin Management Tests
// =============================================================================

describe('HookManager - Plugin Management', () => {
  let manager: HookManager;

  beforeEach(() => {
    manager = new HookManager();
  });

  describe('use()', () => {
    it('should register a single plugin', () => {
      const plugin: Plugin = { name: 'test-plugin' };
      const result = manager.use(plugin);

      expect(result).toBe(manager); // Should return this for chaining
      expect(manager.getPlugins()).toHaveLength(1);
      expect(manager.getPlugins()[0].name).toBe('test-plugin');
    });

    it('should register multiple plugins sequentially', () => {
      manager.use({ name: 'plugin-1' });
      manager.use({ name: 'plugin-2' });
      manager.use({ name: 'plugin-3' });

      expect(manager.getPlugins()).toHaveLength(3);
    });

    it('should clear sorted cache when adding plugin', () => {
      manager.use({ name: 'plugin-1', enforce: 'post' });
      manager.getPlugins();

      manager.use({ name: 'plugin-2', enforce: 'pre' });
      const secondSort = manager.getPlugins();

      // The second plugin (pre) should come before the first (post)
      expect(secondSort[0].name).toBe('plugin-2');
      expect(secondSort[1].name).toBe('plugin-1');
    });
  });

  describe('useMany()', () => {
    it('should register multiple plugins at once', () => {
      const plugins: Plugin[] = [{ name: 'plugin-1' }, { name: 'plugin-2' }, { name: 'plugin-3' }];

      const result = manager.useMany(plugins);

      expect(result).toBe(manager);
      expect(manager.getPlugins()).toHaveLength(3);
    });

    it('should handle empty array', () => {
      const result = manager.useMany([]);
      expect(result).toBe(manager);
      expect(manager.getPlugins()).toHaveLength(0);
    });

    it('should clear sorted cache when adding plugins', () => {
      manager.use({ name: 'plugin-1', enforce: 'post' });
      manager.getPlugins(); // This caches the sorted list

      manager.useMany([{ name: 'plugin-2', enforce: 'pre' }]);
      const plugins = manager.getPlugins();

      expect(plugins[0].name).toBe('plugin-2');
      expect(plugins[1].name).toBe('plugin-1');
    });
  });

  describe('remove()', () => {
    it('should remove plugin by name', () => {
      manager.use({ name: 'plugin-1' });
      manager.use({ name: 'plugin-2' });

      const result = manager.remove('plugin-1');

      expect(result).toBe(true);
      expect(manager.getPlugins()).toHaveLength(1);
      expect(manager.getPlugins()[0].name).toBe('plugin-2');
    });

    it('should return false if plugin not found', () => {
      manager.use({ name: 'plugin-1' });

      const result = manager.remove('non-existent');

      expect(result).toBe(false);
      expect(manager.getPlugins()).toHaveLength(1);
    });

    it('should clear sorted cache when removing plugin', () => {
      manager.use({ name: 'plugin-1', enforce: 'post' });
      manager.use({ name: 'plugin-2', enforce: 'pre' });
      manager.getPlugins(); // Cache sorted list

      manager.remove('plugin-2');
      const plugins = manager.getPlugins();

      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe('plugin-1');
    });
  });

  describe('getPlugins()', () => {
    it('should return empty array when no plugins registered', () => {
      expect(manager.getPlugins()).toEqual([]);
    });

    it('should return a copy of plugins array', () => {
      manager.use({ name: 'plugin-1' });
      const plugins1 = manager.getPlugins();
      const plugins2 = manager.getPlugins();

      expect(plugins1).not.toBe(plugins2); // Different array references
      expect(plugins1).toEqual(plugins2); // Same content
    });
  });
});

// =============================================================================
// Plugin Sorting Tests
// =============================================================================

describe('HookManager - Plugin Sorting', () => {
  let manager: HookManager;

  beforeEach(() => {
    manager = new HookManager();
  });

  it('should sort plugins in pre -> normal -> post order', () => {
    manager.use({ name: 'normal-1' });
    manager.use({ name: 'post-1', enforce: 'post' });
    manager.use({ name: 'pre-1', enforce: 'pre' });
    manager.use({ name: 'normal-2' });
    manager.use({ name: 'pre-2', enforce: 'pre' });
    manager.use({ name: 'post-2', enforce: 'post' });

    const plugins = manager.getPlugins();

    // Pre plugins
    expect(plugins[0].enforce).toBe('pre');
    expect(plugins[1].enforce).toBe('pre');

    // Normal plugins
    expect(plugins[2].enforce).toBeUndefined();
    expect(plugins[3].enforce).toBeUndefined();

    // Post plugins
    expect(plugins[4].enforce).toBe('post');
    expect(plugins[5].enforce).toBe('post');
  });

  it('should maintain registration order within same enforce level', () => {
    manager.use({ name: 'pre-a', enforce: 'pre' });
    manager.use({ name: 'pre-b', enforce: 'pre' });
    manager.use({ name: 'normal-a' });
    manager.use({ name: 'normal-b' });
    manager.use({ name: 'post-a', enforce: 'post' });
    manager.use({ name: 'post-b', enforce: 'post' });

    const plugins = manager.getPlugins();

    expect(plugins[0].name).toBe('pre-a');
    expect(plugins[1].name).toBe('pre-b');
    expect(plugins[2].name).toBe('normal-a');
    expect(plugins[3].name).toBe('normal-b');
    expect(plugins[4].name).toBe('post-a');
    expect(plugins[5].name).toBe('post-b');
  });

  it('should handle only pre plugins', () => {
    manager.use({ name: 'pre-1', enforce: 'pre' });
    manager.use({ name: 'pre-2', enforce: 'pre' });

    const plugins = manager.getPlugins();
    expect(plugins).toHaveLength(2);
    expect(plugins.every((p) => p.enforce === 'pre')).toBe(true);
  });

  it('should handle only post plugins', () => {
    manager.use({ name: 'post-1', enforce: 'post' });
    manager.use({ name: 'post-2', enforce: 'post' });

    const plugins = manager.getPlugins();
    expect(plugins).toHaveLength(2);
    expect(plugins.every((p) => p.enforce === 'post')).toBe(true);
  });

  it('should handle only normal plugins', () => {
    manager.use({ name: 'normal-1' });
    manager.use({ name: 'normal-2' });

    const plugins = manager.getPlugins();
    expect(plugins).toHaveLength(2);
    expect(plugins.every((p) => p.enforce === undefined)).toBe(true);
  });
});

// =============================================================================
// Config Hook Tests (SeriesLast Strategy)
// =============================================================================

describe('HookManager - Config Hooks', () => {
  let manager: HookManager;
  let ctx: HookContext;

  beforeEach(() => {
    manager = new HookManager();
    ctx = createMockContext();
  });

  it('should return original config when no hooks registered', async () => {
    const config = { model: 'gpt-4', temperature: 0.7 };
    const result = await manager.executeConfigHooks(config, ctx);

    expect(result).toEqual(config);
  });

  it('should execute single config hook', async () => {
    manager.use({
      name: 'config-plugin',
      config: (config) => ({ ...config, modified: true }),
    });

    const config = { model: 'gpt-4' };
    const result = await manager.executeConfigHooks(config, ctx);

    expect(result).toEqual({ model: 'gpt-4', modified: true });
  });

  it('should chain config hooks (last wins)', async () => {
    manager.use({
      name: 'plugin-1',
      config: (config) => ({ ...config, step1: true }),
    });
    manager.use({
      name: 'plugin-2',
      config: (config) => ({ ...config, step2: true }),
    });

    const config = { model: 'gpt-4' };
    const result = await manager.executeConfigHooks(config, ctx);

    expect(result).toEqual({ model: 'gpt-4', step1: true, step2: true });
  });

  it('should respect enforce order', async () => {
    const executionOrder: string[] = [];

    manager.use({
      name: 'post-plugin',
      enforce: 'post',
      config: (config) => {
        executionOrder.push('post');
        return { ...config, post: true };
      },
    });
    manager.use({
      name: 'pre-plugin',
      enforce: 'pre',
      config: (config) => {
        executionOrder.push('pre');
        return { ...config, pre: true };
      },
    });
    manager.use({
      name: 'normal-plugin',
      config: (config) => {
        executionOrder.push('normal');
        return { ...config, normal: true };
      },
    });

    const config = { model: 'gpt-4' };
    const result = await manager.executeConfigHooks(config, ctx);

    expect(executionOrder).toEqual(['pre', 'normal', 'post']);
    expect(result).toEqual({ model: 'gpt-4', pre: true, normal: true, post: true });
  });

  it('should support async config hooks', async () => {
    manager.use({
      name: 'async-plugin',
      config: async (config) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { ...config, async: true };
      },
    });

    const config = { model: 'gpt-4' };
    const result = await manager.executeConfigHooks(config, ctx);

    expect(result).toEqual({ model: 'gpt-4', async: true });
  });

  it('should isolate errors and continue execution', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    manager.use({
      name: 'error-plugin',
      config: () => {
        throw new Error('Config error');
      },
    });
    manager.use({
      name: 'success-plugin',
      config: (config) => ({ ...config, success: true }),
    });

    const config = { model: 'gpt-4' };
    const result = await manager.executeConfigHooks(config, ctx);

    // Error plugin fails silently, success plugin still runs
    expect(result).toEqual({ model: 'gpt-4', success: true });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[HookManager]'),
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });
});

// =============================================================================
// SystemPrompt Hook Tests (SeriesLast Strategy)
// =============================================================================

describe('HookManager - SystemPrompt Hooks', () => {
  let manager: HookManager;
  let ctx: HookContext;

  beforeEach(() => {
    manager = new HookManager();
    ctx = createMockContext();
  });

  it('should return original prompt when no hooks registered', async () => {
    const prompt = 'You are a helpful assistant.';
    const result = await manager.executeSystemPromptHooks(prompt, ctx);

    expect(result).toBe(prompt);
  });

  it('should modify system prompt', async () => {
    manager.use({
      name: 'prompt-plugin',
      systemPrompt: (prompt) => `${prompt}\n\nAdditional instructions.`,
    });

    const result = await manager.executeSystemPromptHooks('Base prompt.', ctx);

    expect(result).toBe('Base prompt.\n\nAdditional instructions.');
  });

  it('should chain multiple prompt modifications', async () => {
    manager.use({
      name: 'plugin-1',
      systemPrompt: (prompt) => `${prompt} [1]`,
    });
    manager.use({
      name: 'plugin-2',
      systemPrompt: (prompt) => `${prompt} [2]`,
    });

    const result = await manager.executeSystemPromptHooks('Start', ctx);

    expect(result).toBe('Start [1] [2]');
  });

  it('should support async prompt hooks', async () => {
    manager.use({
      name: 'async-plugin',
      systemPrompt: async (prompt) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return `${prompt} [async]`;
      },
    });

    const result = await manager.executeSystemPromptHooks('Start', ctx);

    expect(result).toBe('Start [async]');
  });
});

// =============================================================================
// UserPrompt Hook Tests (SeriesLast Strategy)
// =============================================================================

describe('HookManager - UserPrompt Hooks', () => {
  let manager: HookManager;
  let ctx: HookContext;

  beforeEach(() => {
    manager = new HookManager();
    ctx = createMockContext();
  });

  it('should return original prompt when no hooks registered', async () => {
    const prompt = 'Hello, world!';
    const result = await manager.executeUserPromptHooks(prompt, ctx);

    expect(result).toBe(prompt);
  });

  it('should modify user prompt', async () => {
    manager.use({
      name: 'user-prompt-plugin',
      userPrompt: (prompt) => `[Modified] ${prompt}`,
    });

    const result = await manager.executeUserPromptHooks('Hello', ctx);

    expect(result).toBe('[Modified] Hello');
  });

  it('should chain multiple user prompt modifications', async () => {
    manager.use({
      name: 'plugin-1',
      userPrompt: (prompt) => `<p1>${prompt}</p1>`,
    });
    manager.use({
      name: 'plugin-2',
      userPrompt: (prompt) => `<p2>${prompt}</p2>`,
    });

    const result = await manager.executeUserPromptHooks('text', ctx);

    expect(result).toBe('<p2><p1>text</p1></p2>');
  });
});

// =============================================================================
// Tools Hook Tests (SeriesMerge Strategy)
// =============================================================================

describe('HookManager - Tools Hooks', () => {
  let manager: HookManager;
  let ctx: HookContext;

  beforeEach(() => {
    manager = new HookManager();
    ctx = createMockContext();
  });

  it('should return original tools when no hooks registered', async () => {
    const tools = [createMockTool('tool1'), createMockTool('tool2')];
    const result = await manager.executeToolsHooks(tools, ctx);

    expect(result).toEqual(tools);
    expect(result).not.toBe(tools); // Should be a copy
  });

  it('should add tools via hook', async () => {
    manager.use({
      name: 'tools-plugin',
      tools: (tools) => [...tools, createMockTool('new-tool')],
    });

    const tools = [createMockTool('tool1')];
    const result = await manager.executeToolsHooks(tools, ctx);

    expect(result).toHaveLength(2);
    expect(result[1].function.name).toBe('new-tool');
  });

  it('should filter tools via hook', async () => {
    manager.use({
      name: 'filter-plugin',
      tools: (tools) => tools.filter((t) => t.function.name !== 'remove-me'),
    });

    const tools = [createMockTool('keep-me'), createMockTool('remove-me')];
    const result = await manager.executeToolsHooks(tools, ctx);

    expect(result).toHaveLength(1);
    expect(result[0].function.name).toBe('keep-me');
  });

  it('should chain tool modifications', async () => {
    manager.use({
      name: 'add-plugin',
      tools: (tools) => [...tools, createMockTool('added-1')],
    });
    manager.use({
      name: 'add-plugin-2',
      tools: (tools) => [...tools, createMockTool('added-2')],
    });

    const tools = [createMockTool('original')];
    const result = await manager.executeToolsHooks(tools, ctx);

    expect(result).toHaveLength(3);
    expect(result.map((t) => t.function.name)).toEqual(['original', 'added-1', 'added-2']);
  });

  it('should support async tools hooks', async () => {
    manager.use({
      name: 'async-plugin',
      tools: async (tools) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return [...tools, createMockTool('async-tool')];
      },
    });

    const tools: Tool[] = [];
    const result = await manager.executeToolsHooks(tools, ctx);

    expect(result).toHaveLength(1);
    expect(result[0].function.name).toBe('async-tool');
  });

  it('should isolate errors and continue with previous result', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    manager.use({
      name: 'error-plugin',
      tools: () => {
        throw new Error('Tools error');
      },
    });
    manager.use({
      name: 'success-plugin',
      tools: (tools) => [...tools, createMockTool('success-tool')],
    });

    const tools = [createMockTool('original')];
    const result = await manager.executeToolsHooks(tools, ctx);

    // Error plugin fails, but success plugin still runs
    expect(result).toHaveLength(2);
    expect(result[1].function.name).toBe('success-tool');

    consoleErrorSpy.mockRestore();
  });
});

// =============================================================================
// ToolUse Hook Tests (SeriesLast Strategy)
// =============================================================================

describe('HookManager - ToolUse Hooks', () => {
  let manager: HookManager;
  let ctx: HookContext;

  beforeEach(() => {
    manager = new HookManager();
    ctx = createMockContext();
  });

  it('should return original tool call when no hooks registered', async () => {
    const toolCall = createMockToolCall('call-1', 'test-tool');
    const result = await manager.executeToolUseHooks(toolCall, ctx);

    expect(result).toEqual(toolCall);
  });

  it('should modify tool call arguments', async () => {
    manager.use({
      name: 'tool-use-plugin',
      toolUse: (toolCall) => ({
        ...toolCall,
        function: {
          ...toolCall.function,
          arguments: JSON.stringify({ modified: true }),
        },
      }),
    });

    const toolCall = createMockToolCall('call-1', 'test-tool');
    const result = await manager.executeToolUseHooks(toolCall, ctx);

    expect(result.function.arguments).toBe(JSON.stringify({ modified: true }));
  });

  it('should chain tool use modifications', async () => {
    manager.use({
      name: 'plugin-1',
      toolUse: (toolCall) => ({
        ...toolCall,
        function: { ...toolCall.function, name: `${toolCall.function.name}_v1` },
      }),
    });
    manager.use({
      name: 'plugin-2',
      toolUse: (toolCall) => ({
        ...toolCall,
        function: { ...toolCall.function, name: `${toolCall.function.name}_v2` },
      }),
    });

    const toolCall = createMockToolCall('call-1', 'tool');
    const result = await manager.executeToolUseHooks(toolCall, ctx);

    expect(result.function.name).toBe('tool_v1_v2');
  });

  it('should support async tool use hooks', async () => {
    manager.use({
      name: 'async-plugin',
      toolUse: async (toolCall) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { ...toolCall, id: `${toolCall.id}-async` };
      },
    });

    const toolCall = createMockToolCall('call-1', 'tool');
    const result = await manager.executeToolUseHooks(toolCall, ctx);

    expect(result.id).toBe('call-1-async');
  });
});

// =============================================================================
// ToolResult Hook Tests (SeriesLast Strategy)
// =============================================================================

describe('HookManager - ToolResult Hooks', () => {
  let manager: HookManager;
  let ctx: HookContext;

  beforeEach(() => {
    manager = new HookManager();
    ctx = createMockContext();
  });

  it('should return original result when no hooks registered', async () => {
    const toolCall = createMockToolCall('call-1', 'tool');
    const result = createMockToolResult();
    const input = { toolCall, result };

    const output = await manager.executeToolResultHooks(input, ctx);

    expect(output).toEqual(input);
  });

  it('should modify tool result', async () => {
    manager.use({
      name: 'result-plugin',
      toolResult: (data) => ({
        ...data,
        result: { ...data.result, data: { modified: true } },
      }),
    });

    const toolCall = createMockToolCall('call-1', 'tool');
    const result = createMockToolResult();
    const input = { toolCall, result };

    const output = await manager.executeToolResultHooks(input, ctx);

    expect(output.result.data).toEqual({ modified: true });
  });

  it('should chain result modifications', async () => {
    manager.use({
      name: 'plugin-1',
      toolResult: (data) => ({
        ...data,
        result: {
          ...data.result,
          data: { ...(data.result.data as Record<string, unknown>), step1: true },
        },
      }),
    });
    manager.use({
      name: 'plugin-2',
      toolResult: (data) => ({
        ...data,
        result: {
          ...data.result,
          data: { ...(data.result.data as Record<string, unknown>), step2: true },
        },
      }),
    });

    const toolCall = createMockToolCall('call-1', 'tool');
    const result = createMockToolResult();
    const input = { toolCall, result };

    const output = await manager.executeToolResultHooks(input, ctx);

    expect((output.result.data as Record<string, unknown>).step1).toBe(true);
    expect((output.result.data as Record<string, unknown>).step2).toBe(true);
  });

  it('should support async tool result hooks', async () => {
    manager.use({
      name: 'async-plugin',
      toolResult: async (data) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          ...data,
          result: {
            ...data.result,
            data: { ...(data.result.data as Record<string, unknown>), async: true },
          },
        };
      },
    });

    const toolCall = createMockToolCall('call-1', 'tool');
    const result = createMockToolResult();
    const input = { toolCall, result };

    const output = await manager.executeToolResultHooks(input, ctx);

    expect((output.result.data as Record<string, unknown>).async).toBe(true);
  });
});

// =============================================================================
// Step Hook Tests (Series Strategy - Notification)
// =============================================================================

describe('HookManager - Step Hooks', () => {
  let manager: HookManager;
  let ctx: HookContext;

  beforeEach(() => {
    manager = new HookManager();
    ctx = createMockContext();
  });

  it('should complete without error when no hooks registered', async () => {
    const step = { stepIndex: 1, finishReason: 'stop', toolCallsCount: 2 };

    await expect(manager.executeStepHooks(step, ctx)).resolves.toBeUndefined();
  });

  it('should execute step hooks in order', async () => {
    const executionOrder: string[] = [];

    manager.use({
      name: 'plugin-1',
      step: () => {
        executionOrder.push('1');
      },
    });
    manager.use({
      name: 'plugin-2',
      step: () => {
        executionOrder.push('2');
      },
    });

    const step = { stepIndex: 0, toolCallsCount: 0 };
    await manager.executeStepHooks(step, ctx);

    expect(executionOrder).toEqual(['1', '2']);
  });

  it('should respect enforce order', async () => {
    const executionOrder: string[] = [];

    manager.use({
      name: 'post',
      enforce: 'post',
      step: () => {
        executionOrder.push('post');
      },
    });
    manager.use({
      name: 'pre',
      enforce: 'pre',
      step: () => {
        executionOrder.push('pre');
      },
    });
    manager.use({
      name: 'normal',
      step: () => {
        executionOrder.push('normal');
      },
    });

    const step = { stepIndex: 0, toolCallsCount: 0 };
    await manager.executeStepHooks(step, ctx);

    expect(executionOrder).toEqual(['pre', 'normal', 'post']);
  });

  it('should support async step hooks', async () => {
    let called = false;

    manager.use({
      name: 'async-plugin',
      step: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        called = true;
      },
    });

    const step = { stepIndex: 0, toolCallsCount: 0 };
    await manager.executeStepHooks(step, ctx);

    expect(called).toBe(true);
  });

  it('should pass step data to hooks', async () => {
    let receivedStep:
      | { stepIndex: number; finishReason?: string; toolCallsCount: number }
      | undefined;

    manager.use({
      name: 'capture-plugin',
      step: (step) => {
        receivedStep = step;
      },
    });

    const step = { stepIndex: 5, finishReason: 'tool_call', toolCallsCount: 3 };
    await manager.executeStepHooks(step, ctx);

    expect(receivedStep).toEqual(step);
  });

  it('should isolate errors and continue execution', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const executionOrder: string[] = [];

    manager.use({
      name: 'error-plugin',
      step: () => {
        throw new Error('Step error');
      },
    });
    manager.use({
      name: 'success-plugin',
      step: () => {
        executionOrder.push('success');
      },
    });

    const step = { stepIndex: 0, toolCallsCount: 0 };
    await manager.executeStepHooks(step, ctx);

    expect(executionOrder).toContain('success');
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});

// =============================================================================
// Loop Hook Tests (Series Strategy - Notification)
// =============================================================================

describe('HookManager - Loop Hooks', () => {
  let manager: HookManager;
  let ctx: HookContext;

  beforeEach(() => {
    manager = new HookManager();
    ctx = createMockContext();
  });

  it('should complete without error when no hooks registered', async () => {
    const loop = { loopIndex: 1, steps: 5 };

    await expect(manager.executeLoopHooks(loop, ctx)).resolves.toBeUndefined();
  });

  it('should execute loop hooks', async () => {
    let receivedLoop: typeof loop | undefined;

    manager.use({
      name: 'loop-plugin',
      loop: (loopData) => {
        receivedLoop = loopData;
      },
    });

    const loop = { loopIndex: 2, steps: 3 };
    await manager.executeLoopHooks(loop, ctx);

    expect(receivedLoop).toEqual(loop);
  });

  it('should support async loop hooks', async () => {
    let called = false;

    manager.use({
      name: 'async-plugin',
      loop: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        called = true;
      },
    });

    const loop = { loopIndex: 0, steps: 0 };
    await manager.executeLoopHooks(loop, ctx);

    expect(called).toBe(true);
  });
});

// =============================================================================
// Stop Hook Tests (Series Strategy - Notification)
// =============================================================================

describe('HookManager - Stop Hooks', () => {
  let manager: HookManager;
  let ctx: HookContext;

  beforeEach(() => {
    manager = new HookManager();
    ctx = createMockContext();
  });

  it('should complete without error when no hooks registered', async () => {
    const reason = { reason: 'complete', message: 'Task finished' };

    await expect(manager.executeStopHooks(reason, ctx)).resolves.toBeUndefined();
  });

  it('should execute stop hooks', async () => {
    let receivedReason: { reason: string; message?: string } | undefined;

    manager.use({
      name: 'stop-plugin',
      stop: (stopReason) => {
        receivedReason = stopReason;
      },
    });

    const reason = { reason: 'max_steps', message: 'Max steps reached' };
    await manager.executeStopHooks(reason, ctx);

    expect(receivedReason).toEqual(reason);
  });

  it('should support async stop hooks', async () => {
    let called = false;

    manager.use({
      name: 'async-plugin',
      stop: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        called = true;
      },
    });

    const reason = { reason: 'stop' };
    await manager.executeStopHooks(reason, ctx);

    expect(called).toBe(true);
  });
});

// =============================================================================
// TextDelta Hook Tests (Series Strategy - Notification)
// =============================================================================

describe('HookManager - TextDelta Hooks', () => {
  let manager: HookManager;
  let ctx: HookContext;

  beforeEach(() => {
    manager = new HookManager();
    ctx = createMockContext();
  });

  it('should complete without error when no hooks registered', async () => {
    const delta = { text: 'Hello', isReasoning: false };

    await expect(manager.executeTextDeltaHooks(delta, ctx)).resolves.toBeUndefined();
  });

  it('should execute text delta hooks', async () => {
    let receivedDelta: { text: string; isReasoning?: boolean } | undefined;

    manager.use({
      name: 'delta-plugin',
      textDelta: (deltaData) => {
        receivedDelta = deltaData;
      },
    });

    const delta = { text: 'World', isReasoning: true };
    await manager.executeTextDeltaHooks(delta, ctx);

    expect(receivedDelta).toEqual(delta);
  });

  it('should support async text delta hooks', async () => {
    let called = false;

    manager.use({
      name: 'async-plugin',
      textDelta: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        called = true;
      },
    });

    const delta = { text: 'test' };
    await manager.executeTextDeltaHooks(delta, ctx);

    expect(called).toBe(true);
  });
});

// =============================================================================
// TextComplete Hook Tests (Series Strategy - Notification)
// =============================================================================

describe('HookManager - TextComplete Hooks', () => {
  let manager: HookManager;
  let ctx: HookContext;

  beforeEach(() => {
    manager = new HookManager();
    ctx = createMockContext();
  });

  it('should complete without error when no hooks registered', async () => {
    const text = 'Complete response text';

    await expect(manager.executeTextCompleteHooks(text, ctx)).resolves.toBeUndefined();
  });

  it('should execute text complete hooks', async () => {
    let receivedText: string | undefined;

    manager.use({
      name: 'complete-plugin',
      textComplete: (text) => {
        receivedText = text;
      },
    });

    const text = 'Hello, world!';
    await manager.executeTextCompleteHooks(text, ctx);

    expect(receivedText).toBe(text);
  });

  it('should support async text complete hooks', async () => {
    let called = false;

    manager.use({
      name: 'async-plugin',
      textComplete: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        called = true;
      },
    });

    await manager.executeTextCompleteHooks('test', ctx);

    expect(called).toBe(true);
  });
});

// =============================================================================
// ToolStream Hook Tests (Series Strategy - Notification)
// =============================================================================

describe('HookManager - ToolStream Hooks', () => {
  let manager: HookManager;
  let ctx: HookContext;

  beforeEach(() => {
    manager = new HookManager();
    ctx = createMockContext();
  });

  it('should complete without error when no hooks registered', async () => {
    const event: ToolStreamEvent = {
      toolCallId: 'call-1',
      toolName: 'bash',
      type: 'stdout',
      sequence: 1,
      timestamp: Date.now(),
      content: 'hello',
    };

    await expect(manager.executeToolStreamHooks(event, ctx)).resolves.toBeUndefined();
  });

  it('should execute tool stream hooks', async () => {
    let receivedEvent: ToolStreamEvent | undefined;

    manager.use({
      name: 'stream-plugin',
      toolStream: (event) => {
        receivedEvent = event;
      },
    });

    const event: ToolStreamEvent = {
      toolCallId: 'call-2',
      toolName: 'bash',
      type: 'progress',
      sequence: 2,
      timestamp: Date.now(),
      data: { progress: 50 },
    };
    await manager.executeToolStreamHooks(event, ctx);

    expect(receivedEvent).toEqual(event);
  });
});

// =============================================================================
// ToolConfirm Hook Tests (Series Strategy - Notification)
// =============================================================================

describe('HookManager - ToolConfirm Hooks', () => {
  let manager: HookManager;
  let ctx: HookContext;

  beforeEach(() => {
    manager = new HookManager();
    ctx = createMockContext();
  });

  it('should complete without error when no hooks registered', async () => {
    await expect(
      manager.executeToolConfirmHooks(createMockToolConfirmRequest(), ctx)
    ).resolves.toBeUndefined();
  });

  it('should execute tool confirm hooks', async () => {
    let received: ToolConfirmRequest | undefined;

    manager.use({
      name: 'confirm-plugin',
      toolConfirm: (request) => {
        received = request;
      },
    });

    const request = createMockToolConfirmRequest({ toolName: 'file' });
    await manager.executeToolConfirmHooks(request, ctx);

    expect(received).toEqual(request);
  });
});

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('HookManager - Error Handling', () => {
  let manager: HookManager;
  let ctx: HookContext;
  let consoleErrorSpy: { mockRestore: () => void };

  beforeEach(() => {
    manager = new HookManager();
    ctx = createMockContext();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('should log error with plugin name and hook name', async () => {
    manager.use({
      name: 'failing-plugin',
      config: () => {
        throw new Error('Test error');
      },
    });

    await manager.executeConfigHooks({}, ctx);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[HookManager] Error in plugin "failing-plugin" hook "config":'),
      expect.any(Error)
    );
  });

  it('should not interrupt execution on sync error', async () => {
    const executionOrder: string[] = [];

    manager.use({
      name: 'error-plugin',
      step: () => {
        executionOrder.push('error');
        throw new Error('Step error');
      },
    });
    manager.use({
      name: 'success-plugin',
      step: () => {
        executionOrder.push('success');
      },
    });

    await manager.executeStepHooks({ stepIndex: 0, toolCallsCount: 0 }, ctx);

    expect(executionOrder).toEqual(['error', 'success']);
  });

  it('should not interrupt execution on async error', async () => {
    const executionOrder: string[] = [];

    manager.use({
      name: 'error-plugin',
      step: async () => {
        executionOrder.push('error');
        throw new Error('Async step error');
      },
    });
    manager.use({
      name: 'success-plugin',
      step: () => {
        executionOrder.push('success');
      },
    });

    await manager.executeStepHooks({ stepIndex: 0, toolCallsCount: 0 }, ctx);

    expect(executionOrder).toEqual(['error', 'success']);
  });

  it('should handle rejected promises', async () => {
    manager.use({
      name: 'reject-plugin',
      config: async (_config) => {
        await Promise.resolve();
        throw new Error('Rejected');
      },
    });
    manager.use({
      name: 'after-plugin',
      config: (config) => ({ ...config, after: true }),
    });

    const result = await manager.executeConfigHooks({} as { count?: number }, ctx);

    expect(result).toEqual({ after: true });
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});

// =============================================================================
// Edge Cases Tests
// =============================================================================

describe('HookManager - Edge Cases', () => {
  let manager: HookManager;
  let ctx: HookContext;

  beforeEach(() => {
    manager = new HookManager();
    ctx = createMockContext();
  });

  it('should handle plugin with no hooks', async () => {
    manager.use({ name: 'empty-plugin' });

    const config = { test: true };
    const result = await manager.executeConfigHooks(config, ctx);

    expect(result).toEqual(config);
  });

  it('should handle plugin with only some hooks', async () => {
    manager.use({
      name: 'partial-plugin',
      config: (c) => ({ ...c, configHook: true }),
      // No other hooks defined
    });

    const config = await manager.executeConfigHooks({}, ctx);
    expect(config).toEqual({ configHook: true });

    const prompt = await manager.executeSystemPromptHooks('test', ctx);
    expect(prompt).toBe('test');
  });

  it('should handle duplicate plugin names', async () => {
    manager.use({ name: 'duplicate', config: (c) => ({ ...c, count: 1 }) });
    manager.use({ name: 'duplicate', config: (c) => ({ ...c, count: (c.count as number) + 1 }) });

    const result = await manager.executeConfigHooks<{ count?: number }>({}, ctx);

    expect(result.count).toBe(2);
  });

  it('should handle hooks that return undefined', async () => {
    manager.use({
      name: 'undefined-plugin',
      config: () => undefined as unknown as Record<string, unknown>,
    });

    const result = await manager.executeConfigHooks({ original: true }, ctx);

    // The undefined return should not break the chain
    expect(result).toBeUndefined();
  });

  it('should handle empty tools array', async () => {
    manager.use({
      name: 'tools-plugin',
      tools: (tools) => tools,
    });

    const result = await manager.executeToolsHooks([], ctx);

    expect(result).toEqual([]);
  });

  it('should handle concurrent hook executions', async () => {
    manager.use({
      name: 'slow-plugin',
      config: async (c) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { ...c, slow: true };
      },
    });

    const [result1, result2] = await Promise.all([
      manager.executeConfigHooks({}, ctx),
      manager.executeConfigHooks({}, ctx),
    ]);

    expect(result1).toEqual({ slow: true });
    expect(result2).toEqual({ slow: true });
  });
});

// =============================================================================
// createHookManager Helper Tests
// =============================================================================

describe('createHookManager', () => {
  it('should create a new HookManager instance', () => {
    const manager = createHookManager();

    expect(manager).toBeInstanceOf(HookManager);
  });

  it('should create independent instances', () => {
    const manager1 = createHookManager();
    const manager2 = createHookManager();

    manager1.use({ name: 'plugin-1' });

    expect(manager1.getPlugins()).toHaveLength(1);
    expect(manager2.getPlugins()).toHaveLength(0);
  });
});

// =============================================================================
// Method Chaining Tests
// =============================================================================

describe('HookManager - Method Chaining', () => {
  it('should support fluent API for use()', () => {
    const manager = new HookManager();

    manager.use({ name: 'plugin-1' }).use({ name: 'plugin-2' }).use({ name: 'plugin-3' });

    expect(manager.getPlugins()).toHaveLength(3);
  });

  it('should support fluent API for useMany()', () => {
    const manager = new HookManager();

    manager.useMany([{ name: 'plugin-1' }]).use({ name: 'plugin-2' });

    expect(manager.getPlugins()).toHaveLength(2);
  });
});

// =============================================================================
// Context Passing Tests
// =============================================================================

describe('HookManager - Context Passing', () => {
  let manager: HookManager;
  let ctx: HookContext;

  beforeEach(() => {
    manager = new HookManager();
    ctx = createMockContext({
      loopIndex: 5,
      stepIndex: 10,
      sessionId: 'test-session-123',
    });
  });

  it('should pass context to config hooks', async () => {
    let receivedCtx: HookContext | undefined;

    manager.use({
      name: 'ctx-plugin',
      config: (config, context) => {
        receivedCtx = context;
        return config;
      },
    });

    await manager.executeConfigHooks({}, ctx);

    expect(receivedCtx).toEqual(ctx);
  });

  it('should pass context to step hooks', async () => {
    let receivedCtx: HookContext | undefined;

    manager.use({
      name: 'ctx-plugin',
      step: (_step, context) => {
        receivedCtx = context;
      },
    });

    await manager.executeStepHooks({ stepIndex: 0, toolCallsCount: 0 }, ctx);

    expect(receivedCtx).toEqual(ctx);
  });

  it('should pass context to all hook types', async () => {
    const receivedContexts: HookContext[] = [];

    manager.use({
      name: 'all-hooks-plugin',
      config: (c, context) => {
        receivedContexts.push(context);
        return c;
      },
      systemPrompt: (p, context) => {
        receivedContexts.push(context);
        return p;
      },
      userPrompt: (p, context) => {
        receivedContexts.push(context);
        return p;
      },
      tools: (t, context) => {
        receivedContexts.push(context);
        return t;
      },
      toolUse: (tc, context) => {
        receivedContexts.push(context);
        return tc;
      },
      toolResult: (r, context) => {
        receivedContexts.push(context);
        return r;
      },
      step: (_s, context) => {
        receivedContexts.push(context);
      },
      loop: (_l, context) => {
        receivedContexts.push(context);
      },
      stop: (_r, context) => {
        receivedContexts.push(context);
      },
      textDelta: (_d, context) => {
        receivedContexts.push(context);
      },
      toolStream: (_e, context) => {
        receivedContexts.push(context);
      },
      textComplete: (_t, context) => {
        receivedContexts.push(context);
      },
    });

    await manager.executeConfigHooks({}, ctx);
    await manager.executeSystemPromptHooks('', ctx);
    await manager.executeUserPromptHooks('', ctx);
    await manager.executeToolsHooks([], ctx);
    await manager.executeToolUseHooks(createMockToolCall('1', 't'), ctx);
    await manager.executeToolResultHooks(
      { toolCall: createMockToolCall('1', 't'), result: createMockToolResult() },
      ctx
    );
    await manager.executeStepHooks({ stepIndex: 0, toolCallsCount: 0 }, ctx);
    await manager.executeLoopHooks({ loopIndex: 0, steps: 0 }, ctx);
    await manager.executeStopHooks({ reason: 'test' }, ctx);
    await manager.executeTextDeltaHooks({ text: '' }, ctx);
    await manager.executeToolStreamHooks(
      {
        toolCallId: 'call-ctx-1',
        toolName: 'bash',
        type: 'info',
        sequence: 1,
        timestamp: Date.now(),
      },
      ctx
    );
    await manager.executeTextCompleteHooks('', ctx);

    expect(receivedContexts).toHaveLength(12);
    receivedContexts.forEach((received) => {
      expect(received).toEqual(ctx);
    });
  });
});

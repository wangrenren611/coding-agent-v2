/**
 * Hook 管理器
 *
 * 管理插件注册、Hook 执行、优先级排序
 */

import type { Tool } from '../providers';
import type { ToolCall, ToolResult, HookContext, ToolStreamEvent } from '../core/types';
import type { Plugin, HookStrategy, ConfigHook } from './types';
import type { ToolConfirmRequest } from '../tool/types';

// =============================================================================
// Hook 点位配置
// =============================================================================

const HOOK_POINTS = {
  config: { strategy: 'series-last' as HookStrategy },
  systemPrompt: { strategy: 'series-last' as HookStrategy },
  userPrompt: { strategy: 'series-last' as HookStrategy },
  tools: { strategy: 'series-merge' as HookStrategy },
  toolUse: { strategy: 'series-last' as HookStrategy },
  toolResult: { strategy: 'series-last' as HookStrategy },
  toolStream: { strategy: 'series' as HookStrategy },
  toolConfirm: { strategy: 'series' as HookStrategy },
  step: { strategy: 'series' as HookStrategy },
  loop: { strategy: 'series' as HookStrategy },
  stop: { strategy: 'series' as HookStrategy },
  textDelta: { strategy: 'series' as HookStrategy },
  textComplete: { strategy: 'series' as HookStrategy },
} as const;

type HookPointName = keyof typeof HOOK_POINTS;

// =============================================================================
// HookManager 类
// =============================================================================

/**
 * Hook 管理器
 *
 * @example
 * ```typescript
 * const hookManager = new HookManager();
 *
 * // 注册插件
 * hookManager.use({
 *   name: 'logger',
 *   step: (step, ctx) => console.log(`Step ${step.stepIndex}`),
 *   stop: (reason, ctx) => console.log('Agent stopped:', reason.reason),
 * });
 *
 * // 执行 hooks
 * await hookManager.executeStepHooks({ stepIndex: 1, finishReason: 'stop', toolCallsCount: 0 }, ctx);
 * ```
 */
export class HookManager {
  private plugins: Plugin[] = [];
  private sortedPlugins: Plugin[] | null = null;

  /**
   * 注册插件
   */
  use(plugin: Plugin): this {
    this.plugins.push(plugin);
    this.sortedPlugins = null; // 清除缓存，下次使用时重新排序
    return this;
  }

  /**
   * 批量注册插件
   */
  useMany(plugins: Plugin[]): this {
    for (const plugin of plugins) {
      this.plugins.push(plugin);
    }
    this.sortedPlugins = null;
    return this;
  }

  /**
   * 移除插件
   */
  remove(name: string): boolean {
    const index = this.plugins.findIndex((p) => p.name === name);
    if (index > -1) {
      this.plugins.splice(index, 1);
      this.sortedPlugins = null;
      return true;
    }
    return false;
  }

  /**
   * 获取所有插件（已排序）
   */
  getPlugins(): Plugin[] {
    if (!this.sortedPlugins) {
      this.sortedPlugins = this.sortPlugins(this.plugins);
    }
    return [...this.sortedPlugins];
  }

  /**
   * 排序插件
   *
   * 顺序：pre -> 普通 -> post
   */
  private sortPlugins(plugins: Plugin[]): Plugin[] {
    const pre: Plugin[] = [];
    const normal: Plugin[] = [];
    const post: Plugin[] = [];

    for (const plugin of plugins) {
      const enforce = plugin.enforce;
      if (enforce === 'pre') {
        pre.push(plugin);
      } else if (enforce === 'post') {
        post.push(plugin);
      } else {
        normal.push(plugin);
      }
    }

    return [...pre, ...normal, ...post];
  }

  // ===========================================================================
  // Hook 执行方法
  // ===========================================================================

  /**
   * 执行 config hooks
   */
  async executeConfigHooks<T = Record<string, unknown>>(config: T, ctx: HookContext): Promise<T> {
    return this.executeSeriesLast(
      'config',
      (plugin) => plugin.config as ConfigHook<T> | undefined,
      config,
      ctx
    );
  }

  /**
   * 执行 systemPrompt hooks
   */
  async executeSystemPromptHooks(prompt: string, ctx: HookContext): Promise<string> {
    return this.executeSeriesLast('systemPrompt', (plugin) => plugin.systemPrompt, prompt, ctx);
  }

  /**
   * 执行 userPrompt hooks
   */
  async executeUserPromptHooks(prompt: string, ctx: HookContext): Promise<string> {
    return this.executeSeriesLast('userPrompt', (plugin) => plugin.userPrompt, prompt, ctx);
  }

  /**
   * 执行 tools hooks
   */
  async executeToolsHooks(tools: Tool[], ctx: HookContext): Promise<Tool[]> {
    return this.executeSeriesMerge('tools', (plugin) => plugin.tools, tools, ctx);
  }

  /**
   * 执行 toolUse hooks
   */
  async executeToolUseHooks(toolCall: ToolCall, ctx: HookContext): Promise<ToolCall> {
    return this.executeSeriesLast('toolUse', (plugin) => plugin.toolUse, toolCall, ctx);
  }

  /**
   * 执行 toolResult hooks
   */
  async executeToolResultHooks(
    result: { toolCall: ToolCall; result: ToolResult },
    ctx: HookContext
  ): Promise<{ toolCall: ToolCall; result: ToolResult }> {
    return this.executeSeriesLast('toolResult', (plugin) => plugin.toolResult, result, ctx);
  }

  /**
   * 执行 toolStream hooks（通知类型）
   */
  async executeToolStreamHooks(event: ToolStreamEvent, ctx: HookContext): Promise<void> {
    await this.executeSeries('toolStream', (plugin) => plugin.toolStream, event, ctx);
  }

  /**
   * 执行 toolConfirm hooks（通知类型）
   */
  async executeToolConfirmHooks(request: ToolConfirmRequest, ctx: HookContext): Promise<void> {
    await this.executeSeries('toolConfirm', (plugin) => plugin.toolConfirm, request, ctx);
  }

  /**
   * 执行 step hooks（通知类型）
   */
  async executeStepHooks(
    step: {
      stepIndex: number;
      finishReason?: string;
      toolCallsCount: number;
      assistantMessageId?: string;
      assistantContent?: string;
      assistantReasoningContent?: string;
    },
    ctx: HookContext
  ): Promise<void> {
    await this.executeSeries('step', (plugin) => plugin.step, step, ctx);
  }

  /**
   * 执行 loop hooks（通知类型）
   */
  async executeLoopHooks(
    loop: { loopIndex: number; steps: number },
    ctx: HookContext
  ): Promise<void> {
    await this.executeSeries('loop', (plugin) => plugin.loop, loop, ctx);
  }

  /**
   * 执行 stop hooks（通知类型）
   */
  async executeStopHooks(
    reason: { reason: string; message?: string },
    ctx: HookContext
  ): Promise<void> {
    await this.executeSeries('stop', (plugin) => plugin.stop, reason, ctx);
  }

  /**
   * 执行 textDelta hooks（通知类型）
   */
  async executeTextDeltaHooks(
    delta: { text: string; isReasoning?: boolean; messageId?: string },
    ctx: HookContext
  ): Promise<void> {
    await this.executeSeries('textDelta', (plugin) => plugin.textDelta, delta, ctx);
  }

  /**
   * 执行 textComplete hooks（通知类型）
   */
  async executeTextCompleteHooks(text: string, ctx: HookContext): Promise<void> {
    await this.executeSeries('textComplete', (plugin) => plugin.textComplete, text, ctx);
  }

  // ===========================================================================
  // 内部执行方法
  // ===========================================================================

  /**
   * Series 执行策略 - 通知类型，无返回值
   */
  private async executeSeries<T>(
    pointName: HookPointName,
    getHook: (plugin: Plugin) => ((data: T, ctx: HookContext) => void | Promise<void>) | undefined,
    data: T,
    ctx: HookContext
  ): Promise<void> {
    const plugins = this.getPlugins();

    for (const plugin of plugins) {
      const hook = getHook(plugin);
      if (hook) {
        try {
          await hook(data, ctx);
        } catch (error) {
          console.error(
            `[HookManager] Error in plugin "${plugin.name}" hook "${pointName}":`,
            error
          );
        }
      }
    }
  }

  /**
   * SeriesLast 执行策略 - 最后一个返回值生效
   */
  private async executeSeriesLast<T>(
    pointName: HookPointName,
    getHook: (plugin: Plugin) => ((data: T, ctx: HookContext) => T | Promise<T>) | undefined,
    data: T,
    ctx: HookContext
  ): Promise<T> {
    const plugins = this.getPlugins();
    let result = data;

    for (const plugin of plugins) {
      const hook = getHook(plugin);
      if (hook) {
        try {
          result = await hook(result, ctx);
        } catch (error) {
          console.error(
            `[HookManager] Error in plugin "${plugin.name}" hook "${pointName}":`,
            error
          );
        }
      }
    }

    return result;
  }

  /**
   * SeriesMerge 执行策略 - 合并数组结果
   */
  private async executeSeriesMerge<T>(
    pointName: HookPointName,
    getHook: (plugin: Plugin) => ((data: T[], ctx: HookContext) => T[] | Promise<T[]>) | undefined,
    data: T[],
    ctx: HookContext
  ): Promise<T[]> {
    const plugins = this.getPlugins();
    let result = [...data];

    for (const plugin of plugins) {
      const hook = getHook(plugin);
      if (hook) {
        try {
          const hookResult = await hook(result, ctx);
          result = hookResult;
        } catch (error) {
          console.error(
            `[HookManager] Error in plugin "${plugin.name}" hook "${pointName}":`,
            error
          );
        }
      }
    }

    return result;
  }
}

// =============================================================================
// 便捷函数
// =============================================================================

/**
 * 创建 HookManager 实例
 */
export function createHookManager(): HookManager {
  return new HookManager();
}

/**
 * Hook 管理器
 *
 * 精简版：只管理核心扩展点
 */

import { LLMGenerateOptions, ToolCall } from '../../providers';
import { ToolResult } from '../../tool';
import { MessageList } from '../message-list';
import type { Plugin, HookContext } from './types';

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

  use(plugin: Plugin): this {
    this.plugins.push(plugin);
    return this;
  }

  useMany(plugins: Plugin[]): this {
    this.plugins.push(...plugins);
    return this;
  }

  remove(name: string): boolean {
    const index = this.plugins.findIndex((p) => p.name === name);
    if (index > -1) {
      this.plugins.splice(index, 1);
      return true;
    }
    return false;
  }

  getPlugins(): Plugin[] {
    return [...this.plugins];
  }

  /**
   * 执行 LLM 配置 Hook
   */
  async executeLLMConfigHooks(
    config: LLMGenerateOptions,
    ctx: HookContext
  ): Promise<LLMGenerateOptions> {
    let result = config;
    for (const plugin of this.plugins) {
      if (plugin.llmConfig) {
        try {
          result = await plugin.llmConfig(result, ctx);
        } catch (error) {
          console.error(`[HookManager] Error in plugin "${plugin.name}" llmConfig:`, error);
        }
      }
    }
    return result;
  }

  /**
   * 执行消息列表 Hook
   */
  async executeMessageListHooks(messages: MessageList, ctx: HookContext): Promise<MessageList> {
    let result = messages;
    for (const plugin of this.plugins) {
      if (plugin.messageList) {
        try {
          result = await plugin.messageList(result, ctx);
        } catch (error) {
          console.error(`[HookManager] Error in plugin "${plugin.name}" messageList:`, error);
        }
      }
    }
    return result;
  }

  /**
   * 执行工具调用 Hook
   */
  async executeToolUseHooks(toolCall: ToolCall, ctx: HookContext): Promise<ToolCall> {
    let result = toolCall;
    for (const plugin of this.plugins) {
      if (plugin.toolUse) {
        try {
          result = await plugin.toolUse(result, ctx);
        } catch (error) {
          console.error(`[HookManager] Error in plugin "${plugin.name}" toolUse:`, error);
        }
      }
    }
    return result;
  }

  /**
   * 执行工具结果 Hook
   */
  async executeToolResultHooks(
    result: { toolCall: ToolCall; result: ToolResult },
    ctx: HookContext
  ): Promise<{ toolCall: ToolCall; result: ToolResult }> {
    let finalResult = result;
    for (const plugin of this.plugins) {
      if (plugin.toolResult) {
        try {
          finalResult = await plugin.toolResult(finalResult, ctx);
        } catch (error) {
          console.error(`[HookManager] Error in plugin "${plugin.name}" toolResult:`, error);
        }
      }
    }
    return finalResult;
  }

  /**
   * 执行步骤 Hook（通知类型）
   */
  async executeStepHooks(
    step: {
      stepIndex: number;
      finishReason?: string;
      toolCallsCount: number;
    },
    ctx: HookContext
  ): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.step) {
        try {
          await plugin.step(step, ctx);
        } catch (error) {
          console.error(`[HookManager] Error in plugin "${plugin.name}" step:`, error);
        }
      }
    }
  }

  /**
   * 执行停止 Hook（通知类型）
   */
  async executeStopHooks(
    reason: { reason: string; message?: string },
    ctx: HookContext
  ): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.stop) {
        try {
          await plugin.stop(reason, ctx);
        } catch (error) {
          console.error(`[HookManager] Error in plugin "${plugin.name}" stop:`, error);
        }
      }
    }
  }
}

export function createHookManager(): HookManager {
  return new HookManager();
}

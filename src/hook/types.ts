/**
 * Hook 系统类型定义
 *
 * 提供类似 neovate-code 的 Hook/Plugin 系统
 */

import type { Tool } from '../providers';
import type { ToolCall, ToolResult, HookContext, ToolStreamEvent } from '../core/types';
import type { ToolConfirmRequest } from '../tool/types';

// 重新导出共享类型
export type { ToolCall, ToolResult, HookContext, ToolStreamEvent } from '../core/types';

// =============================================================================
// Hook 执行策略
// =============================================================================

/**
 * Hook 执行策略
 *
 * - Series: 顺序执行所有 hook，用于通知类事件，无返回值
 * - SeriesLast: 顺序执行，最后一个 hook 的返回值作为最终结果
 * - SeriesMerge: 顺序执行，合并所有 hook 的返回值（用于数组类型）
 */
export type HookStrategy = 'series' | 'series-last' | 'series-merge';

// =============================================================================
// Hook 函数类型
// =============================================================================

/**
 * Config Hook - Agent 创建时修改配置
 */
export type ConfigHook<T = Record<string, unknown>> = (
  config: T,
  ctx: HookContext
) => T | Promise<T>;

/**
 * System Prompt Hook - 修改系统提示
 */
export type SystemPromptHook = (prompt: string, ctx: HookContext) => string | Promise<string>;

/**
 * User Prompt Hook - 修改用户输入
 */
export type UserPromptHook = (prompt: string, ctx: HookContext) => string | Promise<string>;

/**
 * Tools Hook - 修改工具列表
 */
export type ToolsHook = (tools: Tool[], ctx: HookContext) => Tool[] | Promise<Tool[]>;

/**
 * Tool Use Hook - 工具调用前修改参数
 */
export type ToolUseHook = (toolCall: ToolCall, ctx: HookContext) => ToolCall | Promise<ToolCall>;

/**
 * Tool Result Hook - 工具返回后修改结果
 */
export type ToolResultHook = (
  result: { toolCall: ToolCall; result: ToolResult },
  ctx: HookContext
) =>
  | { toolCall: ToolCall; result: ToolResult }
  | Promise<{ toolCall: ToolCall; result: ToolResult }>;

/**
 * Step Hook - 步骤完成通知
 */
export type StepHook = (
  step: { stepIndex: number; finishReason?: string; toolCallsCount: number },
  ctx: HookContext
) => void | Promise<void>;

/**
 * Loop Hook - 循环完成通知
 */
export type LoopHook = (
  loop: { loopIndex: number; steps: number },
  ctx: HookContext
) => void | Promise<void>;

/**
 * Stop Hook - Agent 停止通知
 */
export type StopHook = (
  reason: { reason: string; message?: string },
  ctx: HookContext
) => void | Promise<void>;

/**
 * Text Delta Hook - 文本增量输出
 */
export type TextDeltaHook = (
  delta: { text: string; isReasoning?: boolean; messageId?: string },
  ctx: HookContext
) => void | Promise<void>;

/**
 * Text Complete Hook - 文本完成输出
 */
export type TextCompleteHook = (text: string, ctx: HookContext) => void | Promise<void>;

/**
 * Tool Stream Hook - 工具流式输出通知
 */
export type ToolStreamHook = (event: ToolStreamEvent, ctx: HookContext) => void | Promise<void>;

/**
 * Tool Confirm Hook - 工具确认事件通知
 */
export type ToolConfirmHook = (
  request: ToolConfirmRequest,
  ctx: HookContext
) => void | Promise<void>;

// =============================================================================
// Plugin 接口
// =============================================================================

/**
 * Plugin 执行顺序
 *
 * - pre: 优先执行（在普通 plugin 之前）
 * - post: 延后执行（在普通 plugin 之后）
 */
export type PluginEnforce = 'pre' | 'post';

/**
 * Plugin 接口
 *
 * 一个 Plugin 可以实现一个或多个 Hook
 */
export interface Plugin {
  /** Plugin 名称（用于调试） */
  name: string;
  /** 执行顺序 */
  enforce?: PluginEnforce;
  /** Agent 创建时修改配置 */
  config?: ConfigHook;
  /** 修改系统提示 */
  systemPrompt?: SystemPromptHook;
  /** 修改用户输入 */
  userPrompt?: UserPromptHook;
  /** 修改工具列表 */
  tools?: ToolsHook;
  /** 工具调用前修改参数 */
  toolUse?: ToolUseHook;
  /** 工具返回后修改结果 */
  toolResult?: ToolResultHook;
  /** 工具流式输出 */
  toolStream?: ToolStreamHook;
  /** 工具确认事件 */
  toolConfirm?: ToolConfirmHook;
  /** 步骤完成通知 */
  step?: StepHook;
  /** 循环完成通知 */
  loop?: LoopHook;
  /** Agent 停止通知 */
  stop?: StopHook;
  /** 文本增量输出 */
  textDelta?: TextDeltaHook;
  /** 文本完成输出 */
  textComplete?: TextCompleteHook;
}

// =============================================================================
// Hook 元数据
// =============================================================================

/**
 * Hook 定义
 */
export interface HookDefinition<
  T extends (...args: unknown[]) => unknown = (...args: unknown[]) => unknown,
> {
  /** Hook 名称 */
  name: string;
  /** 执行策略 */
  strategy: HookStrategy;
  /** Hook 函数 */
  handler: T;
  /** Plugin 信息 */
  plugin: { name: string; enforce: PluginEnforce };
}

/**
 * Hook 点位配置
 */
export interface HookPointConfig {
  /** 执行策略 */
  strategy: HookStrategy;
}

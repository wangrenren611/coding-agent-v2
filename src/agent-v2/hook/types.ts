/**
 * Hook 系统类型定义
 *
 * 精简版：只保留核心的扩展点
 */

import type { LLMGenerateOptions, Tool, ToolCall } from '../../providers';
import type { ToolResult } from '../../tool/types';
import type { AgentLoopState } from '../types';
import { MessageList } from '../message-list';

/**
 * Hook 执行上下文
 */
export interface HookContext {
  stepIndex: number;
  sessionId: string;
  messageId?: string;
  state: AgentLoopState;
}

/**
 * Hook 执行策略
 *
 * - series: 顺序执行，用于通知类
 * - seriesLast: 顺序执行，返回最后一个结果
 */
export type HookStrategy = 'series' | 'series-last';

/**
 * LLM 配置 Hook - 修改 LLM 调用参数
 */
export type LLMConfigHook = (
  config: LLMGenerateOptions,
  ctx: HookContext
) => LLMGenerateOptions | Promise<LLMGenerateOptions>;

/**
 * 消息列表 Hook - 修改消息列表
 */
export type MessageListHook = (
  messages: MessageList,
  ctx: HookContext
) => MessageList | Promise<MessageList>;

/**
 * 工具调用 Hook - 工具调用前修改参数
 */
export type ToolUseHook = (
  toolCall: ToolCall,
  ctx: HookContext
) => ToolCall | Promise<ToolCall>;

/**
 * 工具结果 Hook - 工具返回后修改结果
 */
export type ToolResultHook = (
  result: { toolCall: ToolCall; result: ToolResult },
  ctx: HookContext
) => { toolCall: ToolCall; result: ToolResult } | Promise<{ toolCall: ToolCall; result: ToolResult }>;

/**
 * 步骤 Hook - 步骤完成时通知
 */
export type StepHook = (
  step: {
    stepIndex: number;
    finishReason?: string;
    toolCallsCount: number;
  },
  ctx: HookContext
) => void | Promise<void>;

/**
 * 停止 Hook - Agent 停止时通知
 */
export type StopHook = (
  reason: { reason: string; message?: string },
  ctx: HookContext
) => void | Promise<void>;

/**
 * Plugin 接口
 *
 * 精简版：只包含核心扩展点
 */
export interface Plugin {
  name: string;
  llmConfig?: LLMConfigHook;
  messageList?: MessageListHook;
  toolUse?: ToolUseHook;
  toolResult?: ToolResultHook;
  step?: StepHook;
  stop?: StopHook;
}

/**
 * Hook 点位配置
 */
export interface HookPointConfig {
  strategy: HookStrategy;
}

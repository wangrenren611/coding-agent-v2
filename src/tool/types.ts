/**
 * Tool 模块类型定义
 */

import type { z } from 'zod';
import type { ToolResult, ToolExecutionContext, ToolStreamEvent } from '../core/types';

// 重新导出共享类型
export type { ToolResult, ToolExecutionContext } from '../core/types';
export type { ToolStreamEvent, ToolStreamEventInput } from '../core/types';
export type { Tool } from '../providers';

// =============================================================================
// 参数 Schema 类型
// =============================================================================

/**
 * 工具参数 Schema 类型
 *
 * 使用 Zod schema 来定义和校验参数
 * 使用 unknown 作为统一输入/输出类型，兼容任意具体 Zod schema。
 */
export type ToolParameterSchema = z.ZodType;

// =============================================================================
// 工具元数据
// =============================================================================

/**
 * 工具元数据
 */
export interface ToolMeta<T extends ToolParameterSchema = ToolParameterSchema> {
  /** 工具名称（唯一标识） */
  name: string;
  /** 工具描述 */
  description: string;
  /** 参数 Zod Schema */
  parameters: T;
  /** 工具分类 */
  category?: string;
  /** 工具标签 */
  tags?: string[];
  /** 是否危险操作（如删除、修改） */
  dangerous?: boolean;
  /** 是否需要确认 */
  requireConfirm?: boolean;
  /** 是否启用 */
  enabled?: boolean;
  /** 优先级（数字越小优先级越高） */
  priority?: number;
  /** 自定义元数据 */
  custom?: Record<string, unknown>;
}

// =============================================================================
// 工具管理器配置
// =============================================================================

/**
 * 工具管理器配置
 */
export interface ToolManagerConfig {
  /** 最大并发数，默认 5 */
  maxConcurrency?: number;
  /** 单个工具超时时间（毫秒），默认 60000 */
  timeout?: number;
}

export type ToolConfirmDecision = 'approve' | 'deny';

export interface ToolConfirmRequest {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  rawArgs: Record<string, unknown>;
  reason?: string;
}

/**
 * 工具执行回调
 */
export interface ToolExecutionCallbacks {
  /** 工具流式事件回调 */
  onToolEvent?: (event: ToolStreamEvent) => void | Promise<void>;
  /** 工具执行确认回调 */
  onToolConfirm?: (
    request: ToolConfirmRequest
  ) => ToolConfirmDecision | Promise<ToolConfirmDecision>;
}

// =============================================================================
// 简单工具类型
// =============================================================================

/**
 * 简单工具的执行函数类型
 */
export type SimpleToolExecutor<T extends ToolParameterSchema = ToolParameterSchema> = (
  args: z.infer<T>,
  context: ToolExecutionContext
) => Promise<ToolResult> | ToolResult;

/**
 * 简单工具配置
 */
export interface SimpleToolConfig<T extends ToolParameterSchema = ToolParameterSchema> {
  name: string;
  description: string;
  parameters: T;
  category?: string;
  tags?: string[];
  dangerous?: boolean;
  requireConfirm?: boolean;
}

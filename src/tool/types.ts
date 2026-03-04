/**
 * Tool 模块类型定义
 */

import type { z } from 'zod';
import type { Tool } from '../providers';
import type { ToolResult, ToolExecutionContext } from '../agent/types';

// =============================================================================
// 参数 Schema 类型
// =============================================================================

/**
 * 工具参数 Schema 类型
 *
 * 使用 Zod schema 来定义和校验参数
 */
export type ToolParameterSchema = z.ZodType<any, any, any>;

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
// 中间件类型
// =============================================================================

/**
 * 工具执行上下文（包含更多信息）
 */
export interface ToolExecutionInfo<T extends ToolParameterSchema = ToolParameterSchema> {
  /** 工具名称 */
  toolName: string;
  /** 工具参数（已校验） */
  args: z.infer<T>;
  /** 原始参数（未校验） */
  rawArgs: Record<string, unknown>;
  /** 执行上下文 */
  context: ToolExecutionContext;
  /** 工具元数据 */
  meta: ToolMeta<T>;
  /** 开始时间 */
  startTime: number;
}

/**
 * 中间件下一个函数
 */
export type MiddlewareNext = () => Promise<ToolResult>;

/**
 * 中间件函数
 */
export type ToolMiddleware = (info: ToolExecutionInfo, next: MiddlewareNext) => Promise<ToolResult>;

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
  /** 是否启用内置日志中间件 */
  enableLogging?: boolean;
  /** 是否启用执行计时 */
  enableTiming?: boolean;
  /** 自定义中间件列表 */
  middlewares?: ToolMiddleware[];
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

// =============================================================================
// 导出类型
// =============================================================================

export type { ToolResult, ToolExecutionContext, Tool };

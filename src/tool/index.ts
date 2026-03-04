/**
 * Tool 模块导出
 */

// 核心类
export { BaseTool, SimpleTool, createTool } from './base';
export { ToolManager, createToolManager } from './manager';

// 类型导出
export type {
  ToolParameterSchema,
  ToolMeta,
  ToolMiddleware,
  ToolExecutionInfo,
  ToolManagerConfig,
  SimpleToolConfig,
  SimpleToolExecutor,
} from './types';

// 重导出相关类型
export type { ToolResult, ToolExecutionContext } from './types';
export type { Tool } from '../providers';

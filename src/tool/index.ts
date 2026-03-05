/**
 * Tool 模块导出
 */

// 核心类
export { BaseTool, SimpleTool, createTool } from './base';
export { ToolManager, createToolManager } from './manager';

// 内置工具
export { BashTool } from './bash';
export {
  evaluateBashPolicy,
  getBashAllowedCommands,
  getBashDangerousCommands,
  getBashDangerousPatterns,
  extractSegmentCommands,
  type BashPolicyMode,
  type BashPolicyEffect,
  type BashDangerousPattern,
  type EvaluateBashPolicyOptions,
  type EvaluateBashPolicyResult,
} from './bash-policy';

// 类型导出
export type {
  ToolParameterSchema,
  ToolMeta,
  ToolMiddleware,
  ToolExecutionInfo,
  ToolManagerConfig,
  ToolExecutionCallbacks,
  SimpleToolConfig,
  SimpleToolExecutor,
} from './types';

// 重导出相关类型
export type { ToolResult, ToolExecutionContext } from './types';
export type { ToolStreamEvent, ToolStreamEventInput } from './types';
export type { Tool } from '../providers';

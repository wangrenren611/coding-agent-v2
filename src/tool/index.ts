/**
 * Tool 模块导出
 */

// 核心类
export { BaseTool } from './base';
export { SimpleTool, createTool } from './simple-tool';
export { ToolManager, createToolManager } from './manager';

// 内置工具
export { BashTool } from './bash';
export { FileTool } from './file-tool';
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
  ToolManagerConfig,
  ToolExecutionCallbacks,
  ToolConfirmDecision,
  ToolConfirmRequest,
  SimpleToolConfig,
  SimpleToolExecutor,
} from './types';

// 重导出相关类型
export type { ToolResult, ToolExecutionContext } from './types';
export type { ToolStreamEvent, ToolStreamEventInput } from './types';
export type { Tool } from '../providers';

// Runtime capabilities
export * from './runtime';

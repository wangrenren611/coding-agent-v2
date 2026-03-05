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
export { GlobTool } from './glob';
export { GrepTool } from './grep';
export { SkillTool, createSkillTool, defaultSkillTool, simpleSkillTool } from './skill-tool';
export {
  TaskTool,
  TaskCreateTool,
  TaskGetTool,
  TaskListTool,
  TaskUpdateTool,
  TaskStopTool,
  TaskOutputTool,
  clearTaskState,
  getDefaultTaskRuntime,
  TaskRuntime,
  type TaskRuntimeOptions,
  type SubagentType,
  type ModelHint,
} from './task-tools';
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

// Skill capability exports
export type {
  Skill,
  SkillMetadata,
  SkillLoaderOptions,
  SkillToolResult,
  SkillFrontmatter,
} from './skill';
export { SkillLoader, getSkillLoader, initializeSkillLoader, resetSkillLoader } from './skill';

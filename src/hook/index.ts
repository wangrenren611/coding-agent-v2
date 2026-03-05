/**
 * Hook 模块导出
 */

// Hook 管理器
export { HookManager, createHookManager } from './manager.js';

// 类型导出
export type {
  HookStrategy,
  HookContext,
  ConfigHook,
  SystemPromptHook,
  UserPromptHook,
  ToolsHook,
  ToolUseHook,
  ToolResultHook,
  ToolStreamHook,
  ToolConfirmHook,
  StepHook,
  LoopHook,
  StopHook,
  TextDeltaHook,
  TextCompleteHook,
  Plugin,
  PluginEnforce,
  HookDefinition,
  HookPointConfig,
  ToolStreamEvent,
} from './types';

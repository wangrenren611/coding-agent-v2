import { buildSystemPrompt } from '../prompts/system';
import type { ModelId } from '../providers';

export const CLI_CONFIG_DIR = '.agent-cli';
export const CLI_CONFIG_FILE = 'config.json';
export const CLI_WORKSPACE_FILE = 'workspaces.json';

export const DEFAULT_MODEL: ModelId = 'glm-5';
export const DEFAULT_OUTPUT_FORMAT = 'text';
export const DEFAULT_APPROVAL_MODE = 'default';

export const DEFAULT_SYSTEM_PROMPT = buildSystemPrompt({ directory: process.cwd() });

export const BUILTIN_TOOL_NAMES = [
  'bash',
  'file_read',
  'file_write',
  'file_edit',
  'file_stat',
  'glob',
  'grep',
  'skill',
  'task',
  'tasks',
  'task_get',
  'task_list',
  'task_update',
  'task_run_get',
  'task_run_wait',
  'task_run_cancel',
  'task_run_events',
  'task_clear_session',
  'task_gc_runs',
] as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];

export const SUPPORTED_COMMANDS = [
  'help',
  'run',
  'config',
  'log',
  'model',
  'tool',
  'task',
  'session',
  'workspace',
  'skill',
] as const;

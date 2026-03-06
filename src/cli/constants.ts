import { buildSystemPrompt } from '../prompts/system';
import type { ModelId } from '../providers';

export const CLI_CONFIG_DIR = '.agent-cli';
export const CLI_CONFIG_FILE = 'config.json';
export const CLI_WORKSPACE_FILE = 'workspaces.json';

export const DEFAULT_MODEL: ModelId = 'minimax-2.5';
export const DEFAULT_OUTPUT_FORMAT = 'text';
export const DEFAULT_APPROVAL_MODE = 'default';

export const DEFAULT_SYSTEM_PROMPT = buildSystemPrompt({ directory: process.cwd() });

export const BUILTIN_TOOL_NAMES = [
  'bash',
  'file',
  'glob',
  'grep',
  'skill',
  'task',
  'task_create',
  'task_get',
  'task_list',
  'task_update',
  'task_stop',
  'task_output',
] as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];

export const SUPPORTED_COMMANDS = [
  'help',
  'run',
  'config',
  'log',
  'model',
  'tool',
  'session',
  'workspace',
  'skill',
] as const;

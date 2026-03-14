import { resolve } from 'node:path';

import * as appMod from '../../../../src/agent/app/index.ts';
import * as agentV4Mod from '../../../../src/agent/agent/index.ts';
import * as agentLoggerMod from '../../../../src/agent/agent/logger.ts';
import * as bashToolMod from '../../../../src/agent/tool/bash.ts';
import * as fileEditToolMod from '../../../../src/agent/tool/file-edit-tool.ts';
import * as fileHistoryListToolMod from '../../../../src/agent/tool/file-history-list.ts';
import * as fileHistoryRestoreToolMod from '../../../../src/agent/tool/file-history-restore.ts';
import * as fileReadToolMod from '../../../../src/agent/tool/file-read-tool.ts';
import * as globToolMod from '../../../../src/agent/tool/glob.ts';
import * as grepToolMod from '../../../../src/agent/tool/grep.ts';
import * as skillToolMod from '../../../../src/agent/tool/skill-tool.ts';
import * as taskCreateToolMod from '../../../../src/agent/tool/task-create.ts';
import * as taskGetToolMod from '../../../../src/agent/tool/task-get.ts';
import * as taskListToolMod from '../../../../src/agent/tool/task-list.ts';
import * as taskOutputToolMod from '../../../../src/agent/tool/task-output.ts';
import * as taskRunnerAdapterMod from '../../../../src/agent/tool/task-runner-adapter.ts';
import * as taskStopToolMod from '../../../../src/agent/tool/task-stop.ts';
import * as taskStoreMod from '../../../../src/agent/tool/task-store.ts';
import * as taskToolMod from '../../../../src/agent/tool/task.ts';
import * as taskUpdateToolMod from '../../../../src/agent/tool/task-update.ts';
import * as toolManagerMod from '../../../../src/agent/tool/tool-manager.ts';
import * as writeToolMod from '../../../../src/agent/tool/write-file.ts';
import * as configMod from '../../../../src/config/index.ts';
import * as providerMod from '../../../../src/providers/index.ts';

import type { MessageContent } from '../../types/message-content';

type ProviderModelConfig = {
  name: string;
  envApiKey: string;
  provider?: string;
  model?: string;
  LLMMAX_TOKENS?: number;
  modalities?: {
    image?: boolean;
    audio?: boolean;
    video?: boolean;
  };
};

export type ProviderRegistryLike = {
  getModelIds: () => string[];
  getModelConfig: (modelId: string) => ProviderModelConfig;
  createFromEnv: (modelId: string, options?: Record<string, unknown>) => unknown;
};

export type ToolDecisionLike = {
  approved: boolean;
  message?: string;
};

export type ToolConfirmEventLike = {
  toolCallId: string;
  toolName: string;
  arguments: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  resolve: (decision: ToolDecisionLike) => void;
};

export type AgentV4MessageLike = {
  messageId: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  type: string;
  content: unknown;
  tool_call_id?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

export type CliEventEnvelopeLike = {
  conversationId: string;
  executionId: string;
  seq: number;
  eventType: string;
  data: unknown;
  createdAt: number;
};

export type AgentAppRunResultLike = {
  executionId: string;
  conversationId: string;
  messages: AgentV4MessageLike[];
  finishReason: 'stop' | 'max_steps' | 'error';
  steps: number;
  run: {
    errorMessage?: string;
  };
};

type AgentAppRunRequestLike = {
  conversationId: string;
  userInput: MessageContent;
  historyMessages?: AgentV4MessageLike[];
  systemPrompt?: string;
  tools?: Array<{ type: string; function: Record<string, unknown> }>;
  config?: Record<string, unknown>;
  maxSteps?: number;
  contextLimitTokens?: number;
  abortSignal?: AbortSignal;
  modelLabel?: string;
};

export type AgentAppUsageLike = {
  sequence: number;
  stepIndex: number;
  messageId: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  cumulativeUsage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  contextTokens?: number;
  contextLimitTokens?: number;
  contextUsagePercent?: number;
};

export type AgentAppContextUsageLike = {
  stepIndex: number;
  messageCount: number;
  contextTokens: number;
  contextLimitTokens: number;
  contextUsagePercent: number;
};

type AgentAppRunCallbacksLike = {
  onEvent?: (event: CliEventEnvelopeLike) => void | Promise<void>;
  onContextUsage?: (usage: AgentAppContextUsageLike) => void | Promise<void>;
  onUsage?: (usage: AgentAppUsageLike) => void | Promise<void>;
  onError?: (error: unknown) => void | Promise<void>;
};

export type AgentAppServiceLike = {
  runForeground: (
    request: AgentAppRunRequestLike,
    callbacks?: AgentAppRunCallbacksLike
  ) => Promise<AgentAppRunResultLike>;
  listContextMessages: (conversationId: string) => Promise<AgentV4MessageLike[]>;
};

type AgentLoggerLike = {
  debug?: (message: string, context?: Record<string, unknown>, data?: unknown) => void;
  info?: (message: string, context?: Record<string, unknown>, data?: unknown) => void;
  warn?: (message: string, context?: Record<string, unknown>, data?: unknown) => void;
  error?: (message: string, error?: unknown, context?: Record<string, unknown>) => void;
};

export type StatelessAgentLike = {
  on: (eventName: 'tool_confirm', listener: (event: ToolConfirmEventLike) => void) => void;
  off: (eventName: 'tool_confirm', listener: (event: ToolConfirmEventLike) => void) => void;
};

export type ToolManagerLike = {
  registerTool: (tool: unknown) => void;
  getTools: () => Array<{ name?: string; toToolSchema?: () => unknown }>;
};

export type AgentAppStoreLike = {
  close: () => Promise<void>;
};

type StatelessAgentCtor = new (
  provider: unknown,
  toolExecutor: ToolManagerLike,
  config: Record<string, unknown>
) => StatelessAgentLike;
type AgentAppServiceCtor = new (deps: {
  agent: StatelessAgentLike;
  executionStore: AgentAppStoreLike;
  eventStore: AgentAppStoreLike;
  messageStore: AgentAppStoreLike;
}) => AgentAppServiceLike;
type ToolManagerCtor = new (config?: Record<string, unknown>) => ToolManagerLike;
type ToolCtor = new (options?: Record<string, unknown>) => unknown;
type TaskStoreCtor = new (options?: Record<string, unknown>) => unknown;
type TaskRunnerCtor = new (options: Record<string, unknown>) => unknown;

export type SourceModules = {
  repoRoot: string;
  ProviderRegistry: ProviderRegistryLike;
  loadEnvFiles: (cwd?: string) => Promise<string[]>;
  loadConfigToEnv: (options?: Record<string, unknown>) => string[];
  createLoggerFromEnv: (env?: NodeJS.ProcessEnv, cwd?: string) => unknown;
  createAgentLoggerAdapter: (
    logger: Record<string, unknown>,
    baseContext?: Record<string, unknown>
  ) => AgentLoggerLike;
  StatelessAgent: StatelessAgentCtor;
  AgentAppService: AgentAppServiceCtor;
  createSqliteAgentAppStore: (dbPath: string) => AgentAppStoreLike;
  DefaultToolManager: ToolManagerCtor;
  BashTool: ToolCtor;
  WriteFileTool: ToolCtor;
  FileReadTool: ToolCtor;
  FileEditTool: ToolCtor;
  FileHistoryListTool: ToolCtor;
  FileHistoryRestoreTool: ToolCtor;
  GlobTool: ToolCtor;
  GrepTool: ToolCtor;
  SkillTool: ToolCtor;
  TaskTool: ToolCtor;
  TaskCreateTool: ToolCtor;
  TaskGetTool: ToolCtor;
  TaskListTool: ToolCtor;
  TaskUpdateTool: ToolCtor;
  TaskStopTool: ToolCtor;
  TaskOutputTool: ToolCtor;
  TaskStore: TaskStoreCtor;
  RealSubagentRunnerAdapter: TaskRunnerCtor;
};

let modulesPromise: Promise<SourceModules> | null = null;

export const resolveRepoRoot = () => {
  const explicit = process.env.AGENT_REPO_ROOT?.trim();
  if (explicit) {
    return resolve(explicit);
  }
  return resolve(process.cwd());
};

export const resolveWorkspaceRoot = () => {
  const explicit = process.env.AGENT_WORKDIR?.trim();
  if (explicit) {
    return resolve(explicit);
  }
  return resolve(process.cwd());
};

const getRequiredExport = <T>(moduleObj: Record<string, unknown>, name: string): T => {
  const value = moduleObj[name];
  if (!value) {
    throw new Error(`Missing export ${name}.`);
  }
  return value as T;
};

const loadSourceModules = async (): Promise<SourceModules> => {
  const repoRoot = resolveRepoRoot();

  return {
    repoRoot,
    ProviderRegistry: getRequiredExport<ProviderRegistryLike>(providerMod, 'ProviderRegistry'),
    loadEnvFiles: getRequiredExport(configMod, 'loadEnvFiles'),
    loadConfigToEnv: getRequiredExport(configMod, 'loadConfigToEnv'),
    createLoggerFromEnv: getRequiredExport(configMod, 'createLoggerFromEnv'),
    createAgentLoggerAdapter: getRequiredExport(agentLoggerMod, 'createAgentLoggerAdapter'),
    StatelessAgent: getRequiredExport<StatelessAgentCtor>(agentV4Mod, 'StatelessAgent'),
    AgentAppService: getRequiredExport<AgentAppServiceCtor>(appMod, 'AgentAppService'),
    createSqliteAgentAppStore: getRequiredExport<(dbPath: string) => AgentAppStoreLike>(
      appMod,
      'createSqliteAgentAppStore'
    ),
    DefaultToolManager: getRequiredExport<ToolManagerCtor>(toolManagerMod, 'DefaultToolManager'),
    BashTool: getRequiredExport<ToolCtor>(bashToolMod, 'BashTool'),
    WriteFileTool: getRequiredExport<ToolCtor>(writeToolMod, 'WriteFileTool'),
    FileReadTool: getRequiredExport<ToolCtor>(fileReadToolMod, 'FileReadTool'),
    FileEditTool: getRequiredExport<ToolCtor>(fileEditToolMod, 'FileEditTool'),
    FileHistoryListTool: getRequiredExport<ToolCtor>(fileHistoryListToolMod, 'FileHistoryListTool'),
    FileHistoryRestoreTool: getRequiredExport<ToolCtor>(
      fileHistoryRestoreToolMod,
      'FileHistoryRestoreTool'
    ),
    GlobTool: getRequiredExport<ToolCtor>(globToolMod, 'GlobTool'),
    GrepTool: getRequiredExport<ToolCtor>(grepToolMod, 'GrepTool'),
    SkillTool: getRequiredExport<ToolCtor>(skillToolMod, 'SkillTool'),
    TaskTool: getRequiredExport<ToolCtor>(taskToolMod, 'TaskTool'),
    TaskCreateTool: getRequiredExport<ToolCtor>(taskCreateToolMod, 'TaskCreateTool'),
    TaskGetTool: getRequiredExport<ToolCtor>(taskGetToolMod, 'TaskGetTool'),
    TaskListTool: getRequiredExport<ToolCtor>(taskListToolMod, 'TaskListTool'),
    TaskUpdateTool: getRequiredExport<ToolCtor>(taskUpdateToolMod, 'TaskUpdateTool'),
    TaskStopTool: getRequiredExport<ToolCtor>(taskStopToolMod, 'TaskStopTool'),
    TaskOutputTool: getRequiredExport<ToolCtor>(taskOutputToolMod, 'TaskOutputTool'),
    TaskStore: getRequiredExport<TaskStoreCtor>(taskStoreMod, 'TaskStore'),
    RealSubagentRunnerAdapter: getRequiredExport<TaskRunnerCtor>(
      taskRunnerAdapterMod,
      'RealSubagentRunnerAdapter'
    ),
  };
};

export const getSourceModules = async () => {
  modulesPromise ??= loadSourceModules().catch(error => {
    modulesPromise = null;
    throw error;
  });
  return modulesPromise;
};

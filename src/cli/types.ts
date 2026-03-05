import type { Interface as ReadlineInterface } from 'node:readline/promises';
import type { AgentResult, Plugin } from '../agent';
import type { RuntimeConfig } from '../config';
import type { Logger, ChildLogger } from '../logger';
import type { ModelId } from '../providers';
import type { MemoryManager } from '../storage';
import type { ToolConfirmDecision, ToolConfirmRequest } from '../tool';

export type OutputFormat = 'text' | 'json' | 'stream-json';
export type ApprovalMode = 'default' | 'autoEdit' | 'yolo';

export interface CliArgs {
  positional: string[];
  help: boolean;
  version: boolean;
  quiet: boolean;
  resume?: string;
  continueSession: boolean;
  cwd?: string;
  model?: string;
  outputFormat?: OutputFormat;
  approvalMode?: ApprovalMode;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  tools?: string;
}

export interface PersistedCliConfig {
  defaultModel?: ModelId;
  defaultApprovalMode?: ApprovalMode;
  defaultSystemPrompt?: string;
  defaultCwd?: string;
  disabledTools: string[];
}

export interface WorkspaceProfile {
  name: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
}

export interface CliSessionInfo {
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  status: string;
  totalMessages: number;
}

export interface CliRuntimeState {
  cwd: string;
  modelId: ModelId;
  sessionId: string;
  outputFormat: OutputFormat;
  approvalMode: ApprovalMode;
  systemPrompt: string;
  disabledTools: Set<string>;
  quiet: boolean;
}

export interface CliRuntimeDeps {
  logger: Logger | ChildLogger;
  memoryManager: MemoryManager;
  runtimeConfig: RuntimeConfig;
}

export interface RunRenderer {
  plugin: Plugin;
  flush(result: AgentResult): void;
}

export interface ToolConfirmIO {
  rl?: ReadlineInterface;
}

export type ToolConfirmHandler = (
  request: ToolConfirmRequest
) => Promise<ToolConfirmDecision> | ToolConfirmDecision;

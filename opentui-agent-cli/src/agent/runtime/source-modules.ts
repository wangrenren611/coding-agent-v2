import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type ProviderModelConfig = {
  name: string;
  envApiKey: string;
  provider?: string;
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
  resolve: (decision: ToolDecisionLike) => void;
};

export type AgentV4MessageLike = {
  messageId: string;
  role: "system" | "user" | "assistant" | "tool";
  type: string;
  content: unknown;
  tool_call_id?: string;
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
  finishReason: "stop" | "max_steps" | "error";
  steps: number;
  run: {
    errorMessage?: string;
  };
};

type AgentAppRunRequestLike = {
  conversationId: string;
  userInput: string;
  historyMessages?: AgentV4MessageLike[];
  systemPrompt?: string;
  maxSteps?: number;
};

type AgentAppRunCallbacksLike = {
  onEvent?: (event: CliEventEnvelopeLike) => void | Promise<void>;
};

export type AgentAppServiceLike = {
  runForeground: (
    request: AgentAppRunRequestLike,
    callbacks?: AgentAppRunCallbacksLike
  ) => Promise<AgentAppRunResultLike>;
  listContextMessages: (conversationId: string) => Promise<AgentV4MessageLike[]>;
};

export type StatelessAgentLike = {
  on: (eventName: "tool_confirm", listener: (event: ToolConfirmEventLike) => void) => void;
  off: (eventName: "tool_confirm", listener: (event: ToolConfirmEventLike) => void) => void;
};

export type ToolManagerLike = {
  registerTool: (tool: unknown) => void;
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

export type SourceModules = {
  repoRoot: string;
  ProviderRegistry: ProviderRegistryLike;
  loadEnvFiles: (cwd?: string) => Promise<string[]>;
  StatelessAgent: StatelessAgentCtor;
  AgentAppService: AgentAppServiceCtor;
  createSqliteAgentAppStore: (dbPath: string) => AgentAppStoreLike;
  DefaultToolManager: ToolManagerCtor;
  BashTool: ToolCtor;
  WriteFileTool: ToolCtor;
};

let modulesPromise: Promise<SourceModules> | null = null;

export const resolveRepoRoot = () => {
  const cwd = process.cwd();
  if (basename(cwd) === "opentui-agent-cli") {
    return resolve(cwd, "..");
  }
  return cwd;
};

export const resolveWorkspaceRoot = () => {
  const explicit = process.env.AGENT_WORKDIR?.trim();
  if (explicit) {
    return resolve(explicit);
  }
  return resolveRepoRoot();
};

const toModuleUrl = (path: string) => pathToFileURL(path).href;

const getRequiredExport = <T>(moduleObj: Record<string, unknown>, name: string): T => {
  const value = moduleObj[name];
  if (!value) {
    throw new Error(`Missing export ${name}.`);
  }
  return value as T;
};

const loadSourceModules = async (): Promise<SourceModules> => {
  const repoRoot = resolveRepoRoot();

  const [providerMod, configMod, appMod, agentV4Mod, toolManagerMod, bashToolMod, writeToolMod] =
    await Promise.all([
      import(toModuleUrl(resolve(repoRoot, "src/providers/index.ts"))),
      import(toModuleUrl(resolve(repoRoot, "src/config/index.ts"))),
      import(toModuleUrl(resolve(repoRoot, "src/agent-v4/app/index.ts"))),
      import(toModuleUrl(resolve(repoRoot, "src/agent-v4/agent/index.ts"))),
      import(toModuleUrl(resolve(repoRoot, "src/agent-v4/tool/tool-manager.ts"))),
      import(toModuleUrl(resolve(repoRoot, "src/agent-v4/tool/bash.ts"))),
      import(toModuleUrl(resolve(repoRoot, "src/agent-v4/tool/write-file.ts"))),
    ]);

  return {
    repoRoot,
    ProviderRegistry: getRequiredExport<ProviderRegistryLike>(providerMod, "ProviderRegistry"),
    loadEnvFiles: getRequiredExport(configMod, "loadEnvFiles"),
    StatelessAgent: getRequiredExport<StatelessAgentCtor>(agentV4Mod, "StatelessAgent"),
    AgentAppService: getRequiredExport<AgentAppServiceCtor>(appMod, "AgentAppService"),
    createSqliteAgentAppStore: getRequiredExport<
      (dbPath: string) => AgentAppStoreLike
    >(appMod, "createSqliteAgentAppStore"),
    DefaultToolManager: getRequiredExport<ToolManagerCtor>(toolManagerMod, "DefaultToolManager"),
    BashTool: getRequiredExport<ToolCtor>(bashToolMod, "BashTool"),
    WriteFileTool: getRequiredExport<ToolCtor>(writeToolMod, "WriteFileTool"),
  };
};

export const getSourceModules = async () => {
  modulesPromise ??= loadSourceModules().catch((error) => {
    modulesPromise = null;
    throw error;
  });
  return modulesPromise;
};

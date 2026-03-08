import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type AgentRunOutput = {
  text: string;
  completionReason: string;
  completionMessage?: string;
};

type AgentLike = {
  run: (prompt: string) => Promise<AgentRunOutput>;
};

export type AgentCtor = new (config: Record<string, unknown>) => AgentLike;

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

export type LoggerLike = {
  child: (name: string) => unknown;
  close: () => void;
};

export type MemoryManagerLike = {
  close: () => Promise<void>;
};

export type ToolManagerLike = {
  register: (tools: unknown[]) => unknown;
};

type ToolManagerCtor = new () => ToolManagerLike;
type ToolCtor = new (options?: Record<string, unknown>) => unknown;

export type SourceModules = {
  repoRoot: string;
  Agent: AgentCtor;
  ProviderRegistry: ProviderRegistryLike;
  createLoggerFromEnv: (env?: NodeJS.ProcessEnv, cwd?: string) => LoggerLike;
  createMemoryManagerFromEnv: (env?: NodeJS.ProcessEnv, cwd?: string) => MemoryManagerLike;
  loadEnvFiles: (cwd?: string) => Promise<string[]>;
  ToolManager: ToolManagerCtor;
  BashTool: ToolCtor;
  FileReadTool: ToolCtor;
  FileWriteTool: ToolCtor;
  FileEditTool: ToolCtor;
  FileStatTool: ToolCtor;
  GlobTool: ToolCtor;
  GrepTool: ToolCtor;
  SkillTool: ToolCtor;
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

  const [agentMod, providerMod, configMod, toolMod] = await Promise.all([
    import(toModuleUrl(resolve(repoRoot, "src/agent/index.ts"))),
    import(toModuleUrl(resolve(repoRoot, "src/providers/index.ts"))),
    import(toModuleUrl(resolve(repoRoot, "src/config/index.ts"))),
    import(toModuleUrl(resolve(repoRoot, "src/tool/index.ts"))),
  ]);

  return {
    repoRoot,
    Agent: getRequiredExport<AgentCtor>(agentMod, "Agent"),
    ProviderRegistry: getRequiredExport<ProviderRegistryLike>(providerMod, "ProviderRegistry"),
    createLoggerFromEnv: getRequiredExport(configMod, "createLoggerFromEnv"),
    createMemoryManagerFromEnv: getRequiredExport(configMod, "createMemoryManagerFromEnv"),
    loadEnvFiles: getRequiredExport(configMod, "loadEnvFiles"),
    ToolManager: getRequiredExport<ToolManagerCtor>(toolMod, "ToolManager"),
    BashTool: getRequiredExport<ToolCtor>(toolMod, "BashTool"),
    FileReadTool: getRequiredExport<ToolCtor>(toolMod, "FileReadTool"),
    FileWriteTool: getRequiredExport<ToolCtor>(toolMod, "FileWriteTool"),
    FileEditTool: getRequiredExport<ToolCtor>(toolMod, "FileEditTool"),
    FileStatTool: getRequiredExport<ToolCtor>(toolMod, "FileStatTool"),
    GlobTool: getRequiredExport<ToolCtor>(toolMod, "GlobTool"),
    GrepTool: getRequiredExport<ToolCtor>(toolMod, "GrepTool"),
    SkillTool: getRequiredExport<ToolCtor>(toolMod, "SkillTool"),
  };
};

export const getSourceModules = async () => {
  modulesPromise ??= loadSourceModules().catch((error) => {
    modulesPromise = null;
    throw error;
  });
  return modulesPromise;
};

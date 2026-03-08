import type {
  AgentEventHandlers,
  AgentLoopEvent,
  AgentRunResult,
  AgentStepEvent,
  AgentStopEvent,
  AgentTextDeltaEvent,
  AgentToolConfirmEvent,
  AgentToolResultEvent,
  AgentToolStreamEvent,
  AgentToolUseEvent,
} from "./types";
import type { AgentModelOption, AgentModelSwitchResult } from "./model-types";
import {
  getSourceModules,
  resolveWorkspaceRoot,
  type LoggerLike,
  type MemoryManagerLike,
  type SourceModules,
  type ToolManagerLike,
} from "./source-modules";

type RuntimeCore = {
  modelId: string;
  modelLabel: string;
  maxSteps: number;
  sessionId: string;
  workspaceRoot: string;
  provider: unknown;
  toolManager: ToolManagerLike;
  memoryManager: MemoryManagerLike;
  logger: LoggerLike;
  modules: SourceModules;
};

let runtimePromise: Promise<RuntimeCore> | null = null;
let preferredModelId = process.env.AGENT_MODEL?.trim() || undefined;

const DEFAULT_MODEL = "glm-5";
const DEFAULT_MAX_STEPS = 200;

const toBoolean = (raw?: string): boolean | undefined => {
  if (!raw) {
    return undefined;
  }
  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(value)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(value)) {
    return false;
  }
  return undefined;
};

const parsePositiveInt = (raw: string | undefined, fallback: number): number => {
  if (!raw || raw.trim().length === 0) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
};

const resolveModelId = (modules: SourceModules, requested?: string): string => {
  const ids = modules.ProviderRegistry.getModelIds();
  const normalized = requested?.trim();
  if (normalized && ids.includes(normalized)) {
    return normalized;
  }
  return DEFAULT_MODEL;
};

const requireModelApiKey = (modules: SourceModules, modelId: string) => {
  const modelConfig = modules.ProviderRegistry.getModelConfig(modelId);
  if (!process.env[modelConfig.envApiKey]) {
    throw new Error(`Missing env ${modelConfig.envApiKey} for model ${modelId}.`);
  }
  return modelConfig;
};

const createSystemPrompt = (workspaceRoot: string) => {
  return [
    "You are OpenTUI Agent CLI.",
    "Use concise, practical responses.",
    "When the user writes Chinese, respond in Chinese.",
    `Current workspace root: ${workspaceRoot}`,
  ].join("\n");
};

const resolveToolDecision = () => {
  const parsed = toBoolean(process.env.AGENT_AUTO_CONFIRM_TOOLS);
  if (parsed === false) {
    return "deny";
  }
  return "approve";
};

const safeInvoke = (fn: (() => void) | undefined) => {
  if (!fn) {
    return;
  }
  try {
    fn();
  } catch {}
};

const createStreamPlugin = (handlers: AgentEventHandlers) => {
  return {
    name: "opentui-stream-bridge",
    textDelta: (event: unknown) => {
      safeInvoke(() => handlers.onTextDelta?.(event as AgentTextDeltaEvent));
    },
    textComplete: (text: unknown) => {
      safeInvoke(() => handlers.onTextComplete?.(String(text ?? "")));
    },
    toolStream: (event: unknown) => {
      safeInvoke(() => handlers.onToolStream?.(event as AgentToolStreamEvent));
    },
    toolConfirm: (event: unknown) => {
      safeInvoke(() => handlers.onToolConfirm?.(event as AgentToolConfirmEvent));
    },
    toolUse: (event: unknown) => {
      safeInvoke(() => handlers.onToolUse?.(event as AgentToolUseEvent));
      return event as never;
    },
    toolResult: (event: unknown) => {
      safeInvoke(() => handlers.onToolResult?.(event as AgentToolResultEvent));
      return event as never;
    },
    step: (event: unknown) => {
      safeInvoke(() => handlers.onStep?.(event as AgentStepEvent));
    },
    loop: (event: unknown) => {
      safeInvoke(() => handlers.onLoop?.(event as AgentLoopEvent));
    },
    stop: (event: unknown) => {
      safeInvoke(() => handlers.onStop?.(event as AgentStopEvent));
    },
  };
};

const createRuntime = async (): Promise<RuntimeCore> => {
  const modules = await getSourceModules();
  const workspaceRoot = resolveWorkspaceRoot();
  await modules.loadEnvFiles(workspaceRoot);

  const modelId = resolveModelId(modules, preferredModelId);
  const modelConfig = requireModelApiKey(modules, modelId);
  const maxSteps = parsePositiveInt(process.env.AGENT_MAX_STEPS, DEFAULT_MAX_STEPS);
  const logger = modules.createLoggerFromEnv(process.env, workspaceRoot);
  const memoryManager = modules.createMemoryManagerFromEnv(process.env, workspaceRoot);

  const provider = modules.ProviderRegistry.createFromEnv(modelId, {
    logger: logger.child("Provider"),
  });

  const toolManager = new modules.ToolManager();
  const fileOptions = { allowedDirectories: [workspaceRoot] };
  toolManager.register([
    new modules.BashTool(),
    new modules.FileReadTool(fileOptions),
    new modules.FileWriteTool(fileOptions),
    new modules.FileEditTool(fileOptions),
    new modules.FileStatTool(fileOptions),
    new modules.GlobTool(),
    new modules.GrepTool(),
    new modules.SkillTool(),
  ]);

  const sessionId = process.env.AGENT_SESSION_ID ?? `opentui-${Date.now()}`;

  return {
    modules,
    modelId,
    modelLabel: modelConfig.name,
    maxSteps,
    sessionId,
    workspaceRoot,
    provider,
    toolManager,
    memoryManager,
    logger,
  };
};

const getRuntime = async () => {
  runtimePromise ??= createRuntime().catch((error) => {
    runtimePromise = null;
    throw error;
  });
  return runtimePromise;
};

const disposeRuntimeInstance = async () => {
  const runtime = await runtimePromise;
  runtimePromise = null;
  if (!runtime) {
    return;
  }

  await runtime.memoryManager.close();
  runtime.logger.close();
};

export const runAgentPrompt = async (prompt: string, handlers: AgentEventHandlers): Promise<AgentRunResult> => {
  const runtime = await getRuntime();
  const startedAt = Date.now();
  const plugin = createStreamPlugin(handlers);

  const agent = new runtime.modules.Agent({
    provider: runtime.provider,
    toolManager: runtime.toolManager,
    memoryManager: runtime.memoryManager,
    logger: runtime.logger,
    sessionId: runtime.sessionId,
    maxSteps: runtime.maxSteps,
    systemPrompt: createSystemPrompt(runtime.workspaceRoot),
    plugins: [plugin],
    onToolConfirm: async () => resolveToolDecision(),
  });

  const result = await agent.run(prompt);
  return {
    text: result.text,
    completionReason: result.completionReason,
    completionMessage: result.completionMessage,
    durationSeconds: (Date.now() - startedAt) / 1000,
    modelLabel: runtime.modelLabel,
  };
};

export const getAgentModelLabel = async (): Promise<string> => {
  const runtime = await getRuntime();
  return runtime.modelLabel;
};

export const getAgentModelId = async (): Promise<string> => {
  if (runtimePromise) {
    const runtime = await runtimePromise;
    if (runtime) {
      return runtime.modelId;
    }
  }
  const modules = await getSourceModules();
  return resolveModelId(modules, preferredModelId);
};

export const listAgentModels = async (): Promise<AgentModelOption[]> => {
  const modules = await getSourceModules();
  const currentModelId = await getAgentModelId();

  return modules.ProviderRegistry.getModelIds()
    .map((id) => {
      const config = modules.ProviderRegistry.getModelConfig(id);
      return {
        id,
        name: config.name,
        provider: config.provider ?? "other",
        apiKeyEnv: config.envApiKey,
        configured: Boolean(process.env[config.envApiKey]),
        current: id === currentModelId,
      };
    })
    .sort((a, b) => {
      if (a.provider !== b.provider) {
        return a.provider.localeCompare(b.provider);
      }
      if (a.current !== b.current) {
        return a.current ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
};

export const switchAgentModel = async (modelId: string): Promise<AgentModelSwitchResult> => {
  const modules = await getSourceModules();
  const available = modules.ProviderRegistry.getModelIds();
  if (!available.includes(modelId)) {
    throw new Error(`Unknown model: ${modelId}`);
  }

  const config = modules.ProviderRegistry.getModelConfig(modelId);
  if (!process.env[config.envApiKey]) {
    throw new Error(`Missing env ${config.envApiKey} for model ${modelId}.`);
  }

  preferredModelId = modelId;
  await disposeRuntimeInstance();
  return {
    modelId,
    modelLabel: config.name,
  };
};

export const disposeAgentRuntime = async (): Promise<void> => {
  await disposeRuntimeInstance();
};

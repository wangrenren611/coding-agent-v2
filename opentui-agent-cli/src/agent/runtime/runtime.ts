import { isAbsolute, resolve as resolvePath } from "node:path";
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
  type AgentAppRunResultLike,
  type AgentAppServiceLike,
  type AgentAppStoreLike,
  type AgentV4MessageLike,
  type CliEventEnvelopeLike,
  getSourceModules,
  resolveWorkspaceRoot,
  type SourceModules,
  type StatelessAgentLike,
  type ToolConfirmEventLike,
} from "./source-modules";

type RuntimeCore = {
  modelId: string;
  modelLabel: string;
  maxSteps: number;
  conversationId: string;
  workspaceRoot: string;
  agent: StatelessAgentLike;
  appService: AgentAppServiceLike;
  appStore: AgentAppStoreLike;
  modules: SourceModules;
};

let runtimePromise: Promise<RuntimeCore> | null = null;
let preferredModelId = process.env.AGENT_MODEL?.trim() || undefined;

const DEFAULT_MODEL = "glm-5";
const DEFAULT_MAX_STEPS = 200;
const DEFAULT_MAX_RETRY_COUNT = 2;
const DEFAULT_DB_PATH = ".agent-v4/agent.db";

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
  if (ids.includes(DEFAULT_MODEL)) {
    return DEFAULT_MODEL;
  }
  const fallback = ids[0];
  if (!fallback) {
    throw new Error("No models are registered in ProviderRegistry.");
  }
  return fallback;
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

const resolveConversationId = () => {
  const fromEnv = process.env.AGENT_CONVERSATION_ID?.trim() || process.env.AGENT_SESSION_ID?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return `opentui-${Date.now()}`;
};

const resolveDbPath = (workspaceRoot: string): string => {
  const raw = (
    process.env.AGENT_V4_DB_PATH?.trim() ||
    process.env.AGENT_DB_PATH?.trim() ||
    DEFAULT_DB_PATH
  ).trim();
  if (isAbsolute(raw)) {
    return raw;
  }
  return resolvePath(workspaceRoot, raw);
};

const safeInvoke = (fn: (() => void) | undefined): void => {
  if (!fn) {
    return;
  }
  try {
    fn();
  } catch {}
};

const asRecord = (value: unknown): Record<string, unknown> => {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
};

const readString = (value: unknown): string | undefined => {
  return typeof value === "string" ? value : undefined;
};

const readNumber = (value: unknown): number | undefined => {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};

const toJsonString = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const parseJsonObject = (raw: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { raw };
  }
};

const toTextDeltaEvent = (payload: Record<string, unknown>, isReasoning: boolean): AgentTextDeltaEvent => {
  return {
    text: readString(payload.content) ?? readString(payload.reasoningContent) ?? "",
    isReasoning,
  };
};

const toStepEvent = (
  payload: Record<string, unknown>,
  finishReason: string,
  toolCallsCount = 0
): AgentStepEvent => {
  return {
    stepIndex: readNumber(payload.stepIndex) ?? 0,
    finishReason,
    toolCallsCount,
  };
};

const toLoopEvent = (stepIndex: number): AgentLoopEvent => {
  return {
    loopIndex: stepIndex,
    steps: stepIndex,
  };
};

const toToolStreamEvent = (
  envelope: CliEventEnvelopeLike,
  sequenceByToolCallId: Map<string, number>
): AgentToolStreamEvent => {
  const payload = asRecord(envelope.data);
  const toolCallId = readString(payload.toolCallId) ?? "unknown";
  const previousSequence = sequenceByToolCallId.get(toolCallId) ?? 0;
  const sequence = previousSequence + 1;
  sequenceByToolCallId.set(toolCallId, sequence);

  return {
    toolCallId,
    toolName: readString(payload.toolName) ?? "tool",
    type: readString(payload.chunkType) ?? readString(payload.type) ?? "stdout",
    sequence,
    timestamp: envelope.createdAt,
    content: readString(payload.chunk) ?? readString(payload.content),
    data: payload,
  };
};

const toToolResultEvent = (
  payload: Record<string, unknown>,
  toolCallsById: Map<string, AgentToolUseEvent>
): AgentToolResultEvent => {
  const toolCallId = readString(payload.tool_call_id) ?? readString(payload.toolCallId) ?? "unknown";
  const toolCall =
    toolCallsById.get(toolCallId) ??
    ({
      id: toolCallId,
      function: { name: "tool", arguments: "{}" },
    } as AgentToolUseEvent);

  return {
    toolCall,
    result: {
      success: true,
      data: {
        output: toJsonString(payload.content ?? payload),
      },
      raw: payload,
    },
  };
};

const extractAssistantText = (result: AgentAppRunResultLike): string => {
  for (let i = result.messages.length - 1; i >= 0; i -= 1) {
    const message = result.messages[i];
    if (!message) {
      continue;
    }
    if (message.role !== "assistant") {
      continue;
    }
    if (typeof message.content === "string") {
      return message.content;
    }
    return toJsonString(message.content);
  }
  return "";
};

const createRuntime = async (): Promise<RuntimeCore> => {
  const modules = await getSourceModules();
  const workspaceRoot = resolveWorkspaceRoot();
  await modules.loadEnvFiles(workspaceRoot);

  const modelId = resolveModelId(modules, preferredModelId);
  const modelConfig = requireModelApiKey(modules, modelId);
  const maxSteps = parsePositiveInt(process.env.AGENT_MAX_STEPS, DEFAULT_MAX_STEPS);

  const provider = modules.ProviderRegistry.createFromEnv(modelId);
  const toolManager = new modules.DefaultToolManager();
  toolManager.registerTool(new modules.BashTool());
  toolManager.registerTool(
    new modules.WriteFileTool({
      allowedDirectories: [workspaceRoot],
    })
  );

  const agent = new modules.StatelessAgent(provider, toolManager, {
    maxRetryCount: parsePositiveInt(process.env.AGENT_MAX_RETRY_COUNT, DEFAULT_MAX_RETRY_COUNT),
    enableCompaction: true,
  });

  const appStore = modules.createSqliteAgentAppStore(resolveDbPath(workspaceRoot));
  const preparableStore = appStore as AgentAppStoreLike & {
    prepare?: () => Promise<void>;
  };
  if (typeof preparableStore.prepare === "function") {
    await preparableStore.prepare();
  }

  const appService = new modules.AgentAppService({
    agent,
    executionStore: appStore,
    eventStore: appStore,
    messageStore: appStore,
  });

  return {
    modules,
    modelId,
    modelLabel: modelConfig.name,
    maxSteps,
    conversationId: resolveConversationId(),
    workspaceRoot,
    agent,
    appService,
    appStore,
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
  await runtime.appStore.close();
};

export const runAgentPrompt = async (prompt: string, handlers: AgentEventHandlers): Promise<AgentRunResult> => {
  const runtime = await getRuntime();
  const startedAt = Date.now();
  const streamedState = {
    text: "",
    latestErrorMessage: undefined as string | undefined,
    stopEmitted: false,
    lastLoopStep: 0,
  };
  const toolStreamSequenceById = new Map<string, number>();
  const toolCallsById = new Map<string, AgentToolUseEvent>();

  const onToolConfirm = (event: ToolConfirmEventLike): void => {
    const rawArgs = parseJsonObject(event.arguments);
    const toolConfirmEvent: AgentToolConfirmEvent = {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      args: rawArgs,
      rawArgs,
    };
    safeInvoke(() => handlers.onToolConfirm?.(toolConfirmEvent));

    const decision = resolveToolDecision();
    event.resolve(
      decision === "approve"
        ? { approved: true }
        : { approved: false, message: "Tool call denied by AGENT_AUTO_CONFIRM_TOOLS." }
    );
  };

  runtime.agent.on("tool_confirm", onToolConfirm);

  let result: AgentAppRunResultLike;
  try {
    const historyMessages = await runtime.appService.listContextMessages(runtime.conversationId);
    result = await runtime.appService.runForeground(
      {
        conversationId: runtime.conversationId,
        userInput: prompt,
        historyMessages: historyMessages as AgentV4MessageLike[],
        systemPrompt: createSystemPrompt(runtime.workspaceRoot),
        maxSteps: runtime.maxSteps,
      },
      {
        onEvent: async (envelope) => {
          const payload = asRecord(envelope.data);
          switch (envelope.eventType) {
            case "chunk": {
              const event = toTextDeltaEvent(payload, false);
              if (event.text.length > 0) {
                streamedState.text += event.text;
                safeInvoke(() => handlers.onTextDelta?.(event));
              }
              break;
            }
            case "reasoning_chunk": {
              const event = toTextDeltaEvent(payload, true);
              if (event.text.length > 0) {
                safeInvoke(() => handlers.onTextDelta?.(event));
              }
              break;
            }
            case "tool_stream": {
              const toolStreamEvent = toToolStreamEvent(envelope, toolStreamSequenceById);
              safeInvoke(() => handlers.onToolStream?.(toolStreamEvent));
              break;
            }
            case "tool_call": {
              const rawToolCalls = payload.toolCalls;
              if (Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
                for (const item of rawToolCalls) {
                  const toolCall = asRecord(item) as AgentToolUseEvent;
                  const toolCallId = readString(asRecord(toolCall).id);
                  if (toolCallId) {
                    toolCallsById.set(toolCallId, toolCall);
                  }
                  safeInvoke(() => handlers.onToolUse?.(toolCall));
                }
              } else {
                safeInvoke(() => handlers.onToolUse?.(payload as AgentToolUseEvent));
              }
              break;
            }
            case "tool_result": {
              const toolResultEvent = toToolResultEvent(payload, toolCallsById);
              safeInvoke(() => handlers.onToolResult?.(toolResultEvent));
              break;
            }
            case "progress": {
              const currentAction = readString(payload.currentAction) ?? "progress";
              const stepEvent = toStepEvent(payload, currentAction, 0);
              safeInvoke(() => handlers.onStep?.(stepEvent));

              if (currentAction === "llm" && stepEvent.stepIndex > streamedState.lastLoopStep) {
                streamedState.lastLoopStep = stepEvent.stepIndex;
                const loopEvent = toLoopEvent(stepEvent.stepIndex);
                safeInvoke(() => handlers.onLoop?.(loopEvent));
              }
              break;
            }
            case "checkpoint": {
              const stepEvent = toStepEvent(payload, "checkpoint", 0);
              safeInvoke(() => handlers.onStep?.(stepEvent));
              break;
            }
            case "done": {
              safeInvoke(() => handlers.onTextComplete?.(streamedState.text));
              const stopEvent: AgentStopEvent = {
                reason: readString(payload.finishReason) ?? "stop",
              };
              safeInvoke(() => handlers.onStop?.(stopEvent));
              streamedState.stopEmitted = true;
              break;
            }
            case "error": {
              const message = readString(payload.message);
              streamedState.latestErrorMessage = message;
              const stopEvent: AgentStopEvent = {
                reason: "error",
                message,
              };
              safeInvoke(() => handlers.onStop?.(stopEvent));
              streamedState.stopEmitted = true;
              break;
            }
            default:
              break;
          }
        },
      }
    );
  } finally {
    runtime.agent.off("tool_confirm", onToolConfirm);
  }

  if (!streamedState.stopEmitted) {
    safeInvoke(() => handlers.onTextComplete?.(streamedState.text));
    safeInvoke(() =>
      handlers.onStop?.({
        reason: result.finishReason,
        message: result.finishReason === "error" ? result.run.errorMessage : undefined,
      })
    );
  }

  const finalText = streamedState.text || extractAssistantText(result);
  const completionMessage =
    result.finishReason === "error"
      ? streamedState.latestErrorMessage ?? result.run.errorMessage
      : undefined;

  return {
    text: finalText,
    completionReason: result.finishReason,
    completionMessage,
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

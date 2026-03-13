import { isAbsolute, resolve as resolvePath, win32 } from 'node:path';
import { homedir } from 'node:os';
import type {
  AgentContextUsageEvent,
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
  AgentUsageEvent,
} from './types';
import type { AgentModelOption, AgentModelSwitchResult } from './model-types';
import { resolveToolConfirmDecision } from './tool-confirmation';
import {
  type AgentAppContextUsageLike,
  type AgentAppUsageLike,
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
} from './source-modules';
import { ToolCallBuffer } from './tool-call-buffer';
import { buildSystemPrompt } from '../../../../src/agent/prompts/system';
import type { AttachmentModelCapabilities } from '../../files/attachment-capabilities';
import { resolveAttachmentModelCapabilities } from '../../files/attachment-capabilities';
import type { MessageContent } from '../../types/message-content';

type RuntimeCore = {
  modelId: string;
  modelLabel: string;
  maxSteps: number;
  conversationId: string;
  workspaceRoot: string;
  parentTools: Array<{ type: string; function: { name?: string } }>;
  agent: StatelessAgentLike;
  appService: AgentAppServiceLike;
  appStore: AgentAppStoreLike;
  logger?: {
    close?: () => void | Promise<void>;
  };
  modules: SourceModules;
};

type RunAgentPromptOptions = {
  abortSignal?: AbortSignal;
};

let runtimePromise: Promise<RuntimeCore> | null = null;
let initializing = false;
const readPreferredModelIdFromEnv = (): string | undefined => {
  return process.env.AGENT_MODEL?.trim() || undefined;
};

let preferredModelId = readPreferredModelIdFromEnv();

const DEFAULT_MODEL = 'qwen3.5-plus';
const DEFAULT_MAX_STEPS = 10000;
const DEFAULT_MAX_RETRY_COUNT = 10;
const PARENT_HIDDEN_TOOL_NAMES = new Set(['file_history_list', 'file_history_restore']);

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
    throw new Error('No models are registered in ProviderRegistry.');
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
const resolveConversationId = () => {
  const fromEnv = process.env.AGENT_CONVERSATION_ID?.trim() || process.env.AGENT_SESSION_ID?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return `opentui-${Date.now()}`;
};

const resolveDbPath = (workspaceRoot: string): string => {
  const raw = process.env.AGENT_DB_PATH?.trim();
  if (!raw) {
    throw new Error('Missing AGENT_DB_PATH for SQLite storage.');
  }
  if (isAbsolute(raw)) {
    return raw;
  }
  if (win32.isAbsolute(raw)) {
    throw new Error(
      `Invalid database path "${raw}" for platform ${process.platform}. ` +
        'Use AGENT_DB_PATH with a native absolute path.'
    );
  }
  return resolvePath(workspaceRoot, raw);
};

const buildCliLoggerEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
  ...env,
  AGENT_LOG_CONSOLE: 'false',
});

const safeInvoke = (fn: (() => void) | undefined): void => {
  if (!fn) {
    return;
  }
  try {
    fn();
  } catch {
    // Intentionally empty
  }
};

const asRecord = (value: unknown): Record<string, unknown> => {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
};

const readString = (value: unknown): string | undefined => {
  return typeof value === 'string' ? value : undefined;
};

const readNumber = (value: unknown): number | undefined => {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const readBoolean = (value: unknown): boolean | undefined => {
  return typeof value === 'boolean' ? value : undefined;
};

const toUsageEventFromApp = (usage: AgentAppUsageLike): AgentUsageEvent => {
  return {
    promptTokens: usage.usage.prompt_tokens,
    completionTokens: usage.usage.completion_tokens,
    totalTokens: usage.usage.total_tokens,
    cumulativePromptTokens: usage.cumulativeUsage.prompt_tokens,
    cumulativeCompletionTokens: usage.cumulativeUsage.completion_tokens,
    cumulativeTotalTokens: usage.cumulativeUsage.total_tokens,
    contextTokens:
      typeof usage.contextTokens === 'number' && Number.isFinite(usage.contextTokens)
        ? Math.max(0, usage.contextTokens)
        : undefined,
    contextLimit: usage.contextLimitTokens,
    contextUsagePercent:
      typeof usage.contextUsagePercent === 'number' && Number.isFinite(usage.contextUsagePercent)
        ? Math.max(0, usage.contextUsagePercent)
        : undefined,
  };
};

const toContextUsageEventFromApp = (
  usage: AgentAppContextUsageLike
): AgentContextUsageEvent | null => {
  if (
    typeof usage.stepIndex !== 'number' ||
    !Number.isFinite(usage.stepIndex) ||
    typeof usage.messageCount !== 'number' ||
    !Number.isFinite(usage.messageCount) ||
    typeof usage.contextTokens !== 'number' ||
    !Number.isFinite(usage.contextTokens) ||
    typeof usage.contextLimitTokens !== 'number' ||
    !Number.isFinite(usage.contextLimitTokens) ||
    typeof usage.contextUsagePercent !== 'number' ||
    !Number.isFinite(usage.contextUsagePercent)
  ) {
    return null;
  }

  return {
    stepIndex: Math.max(0, usage.stepIndex),
    messageCount: Math.max(0, usage.messageCount),
    contextTokens: Math.max(0, usage.contextTokens),
    contextLimit: Math.max(0, usage.contextLimitTokens),
    contextUsagePercent: Math.max(0, usage.contextUsagePercent),
  };
};

const toJsonString = (value: unknown): string => {
  if (typeof value === 'string') {
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
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { raw };
  }
};

const toTextDeltaEvent = (
  payload: Record<string, unknown>,
  isReasoning: boolean
): AgentTextDeltaEvent => {
  return {
    text: readString(payload.content) ?? readString(payload.reasoningContent) ?? '',
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
  const toolCallId = readString(payload.toolCallId) ?? 'unknown';
  const previousSequence = sequenceByToolCallId.get(toolCallId) ?? 0;
  const sequence = previousSequence + 1;
  sequenceByToolCallId.set(toolCallId, sequence);

  return {
    toolCallId,
    toolName: readString(payload.toolName) ?? 'tool',
    type: readString(payload.chunkType) ?? readString(payload.type) ?? 'stdout',
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
  const toolCallId =
    readString(payload.tool_call_id) ?? readString(payload.toolCallId) ?? 'unknown';
  const metadata = asRecord(payload.metadata);
  const toolResult = asRecord(metadata.toolResult);
  const error = asRecord(toolResult.error);
  const summary = readString(toolResult.summary);
  const explicitOutput = readString(toolResult.output);
  const content = readString(payload.content);
  const output =
    explicitOutput !== undefined ? explicitOutput : content !== summary ? content : undefined;
  const toolCall =
    toolCallsById.get(toolCallId) ??
    ({
      id: toolCallId,
      function: { name: 'tool', arguments: '{}' },
    } as AgentToolUseEvent);

  return {
    toolCall,
    result: {
      success: readBoolean(toolResult.success) ?? true,
      error: readString(error.message),
      data: {
        ...(summary !== undefined ? { summary } : {}),
        ...(output !== undefined ? { output } : {}),
        ...(toolResult.payload !== undefined ? { payload: toolResult.payload } : {}),
        ...(toolResult.metadata !== undefined ? { metadata: toolResult.metadata } : {}),
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
    if (message.role !== 'assistant') {
      continue;
    }
    if (typeof message.content === 'string') {
      return message.content;
    }
    return toJsonString(message.content);
  }
  return '';
};

const createRuntime = async (): Promise<RuntimeCore> => {
  const modules = await getSourceModules();
  const workspaceRoot = resolveWorkspaceRoot();
  await modules.loadEnvFiles(workspaceRoot);
  modules.loadConfigToEnv({ projectRoot: workspaceRoot });
  const conversationId = resolveConversationId();

  const modelId = resolveModelId(modules, preferredModelId);
  const modelConfig = requireModelApiKey(modules, modelId);
  const maxSteps = parsePositiveInt(process.env.AGENT_MAX_STEPS, DEFAULT_MAX_STEPS);
  const coreLogger = modules.createLoggerFromEnv(buildCliLoggerEnv(process.env), workspaceRoot);
  const agentLogger = modules.createAgentLoggerAdapter(asRecord(coreLogger), {
    runtime: 'opentui-agent-cli',
  });

  const provider = modules.ProviderRegistry.createFromEnv(modelId, {
    logger: asRecord(coreLogger),
  });
  const toolManager = new modules.DefaultToolManager();
  const taskStore = new modules.TaskStore({
    baseDir: resolvePath(homedir(), '.renx', 'task'),
  });
  toolManager.registerTool(new modules.BashTool());
  toolManager.registerTool(
    new modules.WriteFileTool({
      allowedDirectories: [workspaceRoot],
    })
  );
  toolManager.registerTool(
    new modules.FileReadTool({
      allowedDirectories: [workspaceRoot],
    })
  );
  toolManager.registerTool(
    new modules.FileEditTool({
      allowedDirectories: [workspaceRoot],
    })
  );
  toolManager.registerTool(
    new modules.FileHistoryListTool({
      allowedDirectories: [workspaceRoot],
    })
  );
  toolManager.registerTool(
    new modules.FileHistoryRestoreTool({
      allowedDirectories: [workspaceRoot],
    })
  );
  toolManager.registerTool(
    new modules.GlobTool({
      allowedDirectories: [workspaceRoot],
    })
  );
  toolManager.registerTool(
    new modules.GrepTool({
      allowedDirectories: [workspaceRoot],
    })
  );
  toolManager.registerTool(
    new modules.SkillTool({
      loaderOptions: {
        workingDir: workspaceRoot,
      },
    })
  );

  const agent = new modules.StatelessAgent(provider, toolManager, {
    maxRetryCount: parsePositiveInt(process.env.AGENT_MAX_RETRY_COUNT, DEFAULT_MAX_RETRY_COUNT),
    enableCompaction: true,
    logger: agentLogger,
  });

  const appStore = modules.createSqliteAgentAppStore(resolveDbPath(workspaceRoot));
  const preparableStore = appStore as AgentAppStoreLike & {
    prepare?: () => Promise<void>;
  };
  if (typeof preparableStore.prepare === 'function') {
    await preparableStore.prepare();
  }

  const appService = new modules.AgentAppService({
    agent,
    executionStore: appStore,
    eventStore: appStore,
    messageStore: appStore,
  });

  const collectToolSchemas = () =>
    toolManager
      .getTools()
      .map(tool => {
        const schema = tool?.toToolSchema?.();
        if (!schema || typeof schema !== 'object') {
          return null;
        }
        return schema;
      })
      .filter((schema): schema is { type: string; function: { name?: string } } => Boolean(schema));

  const resolveToolSchemas = (allowedTools?: string[], hiddenToolNames?: Set<string>) => {
    const allSchemas = toolManager
      ? collectToolSchemas().filter(schema => {
          const name = schema.function?.name;
          if (typeof name !== 'string') {
            return false;
          }
          return !hiddenToolNames?.has(name);
        })
      : [];

    if (!allowedTools || allowedTools.length === 0) {
      return allSchemas;
    }

    const allowed = new Set(allowedTools);
    return allSchemas.filter(schema => {
      const name = schema.function?.name;
      return typeof name === 'string' && allowed.has(name);
    });
  };

  const resolveSubagentToolSchemas = (allowedTools?: string[]) =>
    resolveToolSchemas(allowedTools, undefined);

  const taskRunner = new modules.RealSubagentRunnerAdapter({
    store: taskStore,
    appService,
    resolveTools: resolveSubagentToolSchemas,
    // Use provider-level model name (e.g. MiniMax-M2.5), not registry id (e.g. minimax-2.5),
    // so subagent requests match the same backend model as parent agent.
    resolveModelId: () => modelConfig.model || modelId,
  });

  toolManager.registerTool(
    new modules.TaskCreateTool({
      store: taskStore,
      defaultNamespace: conversationId,
    })
  );
  toolManager.registerTool(
    new modules.TaskGetTool({
      store: taskStore,
      defaultNamespace: conversationId,
    })
  );
  toolManager.registerTool(
    new modules.TaskListTool({
      store: taskStore,
      defaultNamespace: conversationId,
    })
  );
  toolManager.registerTool(
    new modules.TaskUpdateTool({
      store: taskStore,
      defaultNamespace: conversationId,
    })
  );
  toolManager.registerTool(
    new modules.TaskTool({
      store: taskStore,
      runner: taskRunner,
      defaultNamespace: conversationId,
    })
  );
  toolManager.registerTool(
    new modules.TaskStopTool({
      store: taskStore,
      runner: taskRunner,
      defaultNamespace: conversationId,
    })
  );
  toolManager.registerTool(
    new modules.TaskOutputTool({
      store: taskStore,
      runner: taskRunner,
      defaultNamespace: conversationId,
    })
  );

  const parentTools = resolveToolSchemas(undefined, PARENT_HIDDEN_TOOL_NAMES);

  return {
    modules,
    modelId,
    modelLabel: modelConfig.name,
    maxSteps,
    conversationId,
    workspaceRoot,
    parentTools,
    agent,
    appService,
    appStore,
    logger:
      coreLogger && typeof coreLogger === 'object'
        ? (coreLogger as { close?: () => void | Promise<void> })
        : undefined,
  };
};

const getRuntime = async (): Promise<RuntimeCore> => {
  // 双重检查锁定模式
  if (runtimePromise) {
    return runtimePromise;
  }

  if (initializing) {
    // 等待初始化完成
    while (initializing) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    // 初始化完成后，runtimePromise应该已经设置
    if (runtimePromise) {
      return runtimePromise;
    }
  }

  // 开始初始化
  initializing = true;
  try {
    const promise = createRuntime();
    runtimePromise = promise;

    // 如果初始化失败，允许重新尝试
    promise.catch(() => {
      runtimePromise = null;
    });

    return promise;
  } finally {
    initializing = false;
  }
};

const disposeRuntimeInstance = async () => {
  const runtime = await runtimePromise;
  runtimePromise = null;
  if (!runtime) {
    return;
  }
  await runtime.logger?.close?.();
  await runtime.appStore.close();
};

export const runAgentPrompt = async (
  prompt: MessageContent,
  handlers: AgentEventHandlers,
  options: RunAgentPromptOptions = {}
): Promise<AgentRunResult> => {
  const runtime = await getRuntime();
  const startedAt = Date.now();
  const streamedState = {
    text: '',
    latestErrorMessage: undefined as string | undefined,
    stopEmitted: false,
    lastLoopStep: 0,
  };
  const toolStreamSequenceById = new Map<string, number>();
  const toolCallsById = new Map<string, AgentToolUseEvent>();
  const toolCallBuffer = new ToolCallBuffer();
  let latestUsageEvent: AgentUsageEvent | undefined;
  let currentAction = 'llm';

  const onToolConfirm = (event: ToolConfirmEventLike): void => {
    const rawArgs = parseJsonObject(event.arguments);
    const toolConfirmEvent: AgentToolConfirmEvent = {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      args: rawArgs,
      rawArgs,
      reason: readString(event.reason),
      metadata: event.metadata,
    };
    safeInvoke(() => handlers.onToolConfirm?.(toolConfirmEvent));

    void resolveToolConfirmDecision(toolConfirmEvent, handlers)
      .then(decision => {
        event.resolve(decision);
      })
      .catch(error => {
        const message = error instanceof Error ? error.message : String(error);
        event.resolve({
          approved: false,
          message: message || 'Tool confirmation failed.',
        });
      });
  };

  runtime.agent.on('tool_confirm', onToolConfirm);

  let result: AgentAppRunResultLike;
  try {
    const historyMessages = await runtime.appService.listContextMessages(runtime.conversationId);
    result = await runtime.appService.runForeground(
      {
        conversationId: runtime.conversationId,
        userInput: prompt,
        historyMessages: historyMessages as AgentV4MessageLike[],
        systemPrompt: buildSystemPrompt({ directory: runtime.workspaceRoot }),
        tools: runtime.parentTools,
        maxSteps: runtime.maxSteps,
        abortSignal: options.abortSignal,
        modelLabel: runtime.modelLabel,
      },
      {
        onError: (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          if (message) {
            streamedState.latestErrorMessage = message;
          }
        },
        onContextUsage: usage => {
          const contextUsageEvent = toContextUsageEventFromApp(usage);
          if (!contextUsageEvent) {
            return;
          }
          safeInvoke(() => handlers.onContextUsage?.(contextUsageEvent));
        },
        onUsage: usage => {
          const usageEvent = toUsageEventFromApp(usage);
          latestUsageEvent = usageEvent;
          safeInvoke(() => handlers.onUsage?.(usageEvent));
        },
        onEvent: async envelope => {
          const payload = asRecord(envelope.data);
          switch (envelope.eventType) {
            case 'chunk': {
              const event = toTextDeltaEvent(payload, false);
              if (event.text.length > 0) {
                streamedState.text += event.text;
                safeInvoke(() => handlers.onTextDelta?.(event));
              }
              break;
            }
            case 'reasoning_chunk': {
              const event = toTextDeltaEvent(payload, true);
              if (event.text.length > 0) {
                safeInvoke(() => handlers.onTextDelta?.(event));
              }
              break;
            }
            case 'tool_stream': {
              const toolStreamEvent = toToolStreamEvent(envelope, toolStreamSequenceById);
              toolCallBuffer.ensureEmitted(toolStreamEvent.toolCallId, toolCall => {
                safeInvoke(() => handlers.onToolUse?.(toolCall));
              });
              safeInvoke(() => handlers.onToolStream?.(toolStreamEvent));
              break;
            }
            case 'tool_call': {
              const rawToolCalls = payload.toolCalls;
              if (Array.isArray(rawToolCalls) && rawToolCalls.length > 0) {
                for (const item of rawToolCalls) {
                  const toolCall = asRecord(item) as AgentToolUseEvent;
                  const toolCallId = readString(asRecord(toolCall).id);
                  if (toolCallId) {
                    toolCallsById.set(toolCallId, toolCall);
                  }
                  toolCallBuffer.register(
                    toolCall,
                    event => {
                      safeInvoke(() => handlers.onToolUse?.(event));
                    },
                    currentAction === 'tool'
                  );
                }
              } else {
                const toolCall = payload as AgentToolUseEvent;
                const toolCallId = readString(asRecord(toolCall).id);
                if (toolCallId) {
                  toolCallsById.set(toolCallId, toolCall);
                }
                toolCallBuffer.register(
                  toolCall,
                  event => {
                    safeInvoke(() => handlers.onToolUse?.(event));
                  },
                  currentAction === 'tool'
                );
              }
              break;
            }
            case 'tool_result': {
              const toolCallId = readString(payload.tool_call_id) ?? readString(payload.toolCallId);
              toolCallBuffer.ensureEmitted(toolCallId, toolCall => {
                safeInvoke(() => handlers.onToolUse?.(toolCall));
              });
              const toolResultEvent = toToolResultEvent(payload, toolCallsById);
              safeInvoke(() => handlers.onToolResult?.(toolResultEvent));
              break;
            }
            case 'progress': {
              const nextAction = readString(payload.currentAction) ?? 'progress';
              currentAction = nextAction;
              const stepEvent = toStepEvent(payload, nextAction, 0);
              safeInvoke(() => handlers.onStep?.(stepEvent));

              if (nextAction === 'tool') {
                toolCallBuffer.flush(toolCall => {
                  safeInvoke(() => handlers.onToolUse?.(toolCall));
                });
              }

              if (nextAction === 'llm' && stepEvent.stepIndex > streamedState.lastLoopStep) {
                streamedState.lastLoopStep = stepEvent.stepIndex;
                const loopEvent = toLoopEvent(stepEvent.stepIndex);
                safeInvoke(() => handlers.onLoop?.(loopEvent));
              }
              break;
            }
            case 'checkpoint': {
              const stepEvent = toStepEvent(payload, 'checkpoint', 0);
              safeInvoke(() => handlers.onStep?.(stepEvent));
              break;
            }
            case 'done': {
              safeInvoke(() => handlers.onTextComplete?.(streamedState.text));
              const stopEvent: AgentStopEvent = {
                reason: readString(payload.finishReason) ?? 'stop',
              };
              safeInvoke(() => handlers.onStop?.(stopEvent));
              streamedState.stopEmitted = true;
              break;
            }
            case 'error': {
              const message = readString(payload.message);
              streamedState.latestErrorMessage = message;
              break;
            }
            default:
              break;
          }
        },
      }
    );
  } finally {
    runtime.agent.off('tool_confirm', onToolConfirm);
  }

  if (!streamedState.stopEmitted) {
    safeInvoke(() => handlers.onTextComplete?.(streamedState.text));
    safeInvoke(() =>
      handlers.onStop?.({
        reason: result.finishReason,
        message: result.finishReason === 'error' ? result.run.errorMessage : undefined,
      })
    );
  }

  const finalText = streamedState.text || extractAssistantText(result);
  const completionMessage =
    result.finishReason === 'error'
      ? (streamedState.latestErrorMessage ?? result.run.errorMessage)
      : undefined;

  return {
    text: finalText,
    completionReason: result.finishReason,
    completionMessage,
    durationSeconds: (Date.now() - startedAt) / 1000,
    modelLabel: runtime.modelLabel,
    usage: latestUsageEvent,
  };
};

export const getAgentModelLabel = async (): Promise<string> => {
  const runtime = await getRuntime();
  return runtime.modelLabel;
};

export const getAgentModelAttachmentCapabilities =
  async (): Promise<AttachmentModelCapabilities> => {
    const modules = await getSourceModules();
    const modelId = await getAgentModelId();
    const config = modules.ProviderRegistry.getModelConfig(modelId);
    return resolveAttachmentModelCapabilities(config);
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
    .map(id => {
      const config = modules.ProviderRegistry.getModelConfig(id);
      return {
        id,
        name: config.name,
        provider: config.provider ?? 'other',
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
  preferredModelId = readPreferredModelIdFromEnv();
};

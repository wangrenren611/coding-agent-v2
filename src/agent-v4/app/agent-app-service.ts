import { AsyncLocalStorage } from 'node:async_hooks';
import type { LLMGenerateOptions, MessageContent, Tool, Usage } from '../../providers';
import { StatelessAgent } from '../agent';
import type { AgentLogContext, AgentLogger } from '../agent/logger';
import type { AgentCallbacks, Message } from '../types';
import type {
  CliEventEnvelope,
  CompactionDroppedMessageRecord,
  ListRunsOptions,
  ListRunsResult,
  RunRecord,
  RunLogLevel,
  RunLogRecord,
  TerminalReason,
} from './contracts';
import type {
  ContextProjectionStorePort,
  EventStorePort,
  ExecutionStorePort,
  MessageProjectionStorePort,
  RunLogStorePort,
} from './ports';

type RunFinishReason = 'stop' | 'max_steps' | 'error';

interface ErrorEventPayload {
  errorCode?: string;
  category?: string;
  message?: string;
  code?: string;
  retryable?: boolean;
  httpStatus?: number;
  name?: string;
}

export interface RunForegroundRequest {
  conversationId: string;
  userInput: MessageContent;
  executionId?: string;
  historyMessages?: Message[];
  systemPrompt?: string;
  tools?: Tool[];
  config?: LLMGenerateOptions;
  maxSteps?: number;
  abortSignal?: AbortSignal;
  timeoutBudgetMs?: number;
  llmTimeoutRatio?: number;
  contextLimitTokens?: number;
}

export interface RunForegroundUsage {
  sequence: number;
  stepIndex: number;
  messageId: string;
  usage: Usage;
  cumulativeUsage: Usage;
  contextTokens?: number;
  contextLimitTokens?: number;
  contextUsagePercent?: number;
}

export interface RunForegroundCallbacks extends Partial<AgentCallbacks> {
  onToolStream?: (event: CliEventEnvelope) => void | Promise<void>;
  onEvent?: (event: CliEventEnvelope) => void | Promise<void>;
  onUsage?: (usage: RunForegroundUsage) => void | Promise<void>;
}

export interface RunForegroundResult {
  executionId: string;
  conversationId: string;
  messages: Message[];
  events: CliEventEnvelope[];
  finishReason: RunFinishReason;
  steps: number;
  run: RunRecord;
}

export interface AgentAppServiceDeps {
  agent: StatelessAgent;
  executionStore: ExecutionStorePort;
  eventStore: EventStorePort;
  messageStore?: MessageProjectionStorePort;
  runLogStore?: RunLogStorePort;
}

interface RunObservabilityContext {
  executionId: string;
  conversationId: string;
  getStepIndex: () => number;
  enqueue: (task: () => Promise<void>) => void;
  appendEvent: (eventType: CliEventEnvelope['eventType'], data: unknown) => Promise<void>;
}

export class AgentAppService {
  private readonly observabilityScope = new AsyncLocalStorage<RunObservabilityContext>();

  constructor(private readonly deps: AgentAppServiceDeps) {
    this.deps.agent.attachLogger(this.createScopedLogger());
  }

  async runForeground(
    request: RunForegroundRequest,
    callbacks?: RunForegroundCallbacks
  ): Promise<RunForegroundResult> {
    const executionId = request.executionId ?? createId('exec_');
    const now = Date.now();
    const baseMessages = request.historyMessages ? [...request.historyMessages] : [];
    const userMessage = createUserMessage(request.userInput);
    const inputMessages = [...baseMessages, userMessage];
    const emittedMessages: Message[] = [];
    const events: CliEventEnvelope[] = [];
    let finishReason: RunFinishReason = 'error';
    let currentStepIndex = 0;
    let steps = 0;
    let terminalEventSeen = false;
    let latestErrorPayload: ErrorEventPayload | undefined;
    let streamFailure: unknown;
    let toolStreamFailure: unknown;
    const cumulativeUsage: Usage = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    };
    let usageSequence = 0;
    let latestContextUsage:
      | {
          stepIndex: number;
          contextTokens: number;
          contextLimitTokens: number;
          contextUsagePercent: number;
        }
      | undefined;

    await this.deps.executionStore.create({
      executionId,
      runId: executionId,
      conversationId: request.conversationId,
      status: 'CREATED',
      createdAt: now,
      updatedAt: now,
      stepIndex: 0,
    });

    const appendAndProject = async (
      eventType: CliEventEnvelope['eventType'],
      data: unknown
    ): Promise<CliEventEnvelope> => {
      const envelope = await this.deps.eventStore.appendAutoSeq({
        executionId,
        conversationId: request.conversationId,
        eventType,
        data,
        createdAt: Date.now(),
      });
      events.push(envelope);
      if (this.deps.messageStore) {
        await this.deps.messageStore.upsertFromEvent(envelope);
      }
      if (eventType === 'tool_stream') {
        await callbacks?.onToolStream?.(envelope);
      }
      await callbacks?.onEvent?.(envelope);
      return envelope;
    };

    await appendAndProject('user_message', { message: userMessage, stepIndex: 0 });
    await this.deps.executionStore.patch(executionId, {
      status: 'RUNNING',
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });

    let toolEventQueue: Promise<void> = Promise.resolve();
    let observabilityQueue: Promise<void> = Promise.resolve();
    const toolChunkListener = (payload: unknown): void => {
      toolEventQueue = toolEventQueue
        .then(async () => {
          await appendAndProject('tool_stream', payload);
        })
        .catch((error: unknown) => {
          toolStreamFailure = error;
        });
    };

    const enqueueObservabilityTask = (task: () => Promise<void>) => {
      observabilityQueue = observabilityQueue.then(task).catch((error: unknown) => {
        if (!streamFailure) {
          streamFailure = error;
        }
      });
    };

    this.deps.agent.on('tool_chunk', toolChunkListener);

    const agentCallbacks: AgentCallbacks = {
      onContextUsage: async (contextUsage) => {
        latestContextUsage = {
          stepIndex: contextUsage.stepIndex,
          contextTokens: contextUsage.contextTokens,
          contextLimitTokens: contextUsage.contextLimitTokens,
          contextUsagePercent: contextUsage.contextUsagePercent,
        };
        await callbacks?.onContextUsage?.(contextUsage);
      },
      onMessage: async (message) => {
        emittedMessages.push(message);
        await appendAndProject('assistant_message', {
          message,
          stepIndex: currentStepIndex,
        });
        const usage = readUsage(message.usage);
        if (message.role === 'assistant' && usage) {
          usageSequence += 1;
          cumulativeUsage.prompt_tokens += usage.prompt_tokens;
          cumulativeUsage.completion_tokens += usage.completion_tokens;
          cumulativeUsage.total_tokens += usage.total_tokens;
          const usageStepIndex = latestContextUsage?.stepIndex ?? currentStepIndex;

          const usagePayload: RunForegroundUsage = {
            sequence: usageSequence,
            stepIndex: usageStepIndex,
            messageId: message.messageId,
            usage,
            cumulativeUsage: { ...cumulativeUsage },
            contextTokens: latestContextUsage?.contextTokens,
            contextLimitTokens: latestContextUsage?.contextLimitTokens,
            contextUsagePercent: latestContextUsage?.contextUsagePercent,
          };
          await callbacks?.onUsage?.(usagePayload);
        }
        await callbacks?.onMessage?.(message);
      },
      onCheckpoint: async (checkpoint) => {
        await callbacks?.onCheckpoint?.(checkpoint);
      },
      onProgress: callbacks?.onProgress,
      onCompaction: callbacks?.onCompaction,
      onMetric: async (metric) => {
        enqueueObservabilityTask(async () => {
          await appendAndProject('metric', metric);
        });
        await callbacks?.onMetric?.(metric);
      },
      onTrace: async (event) => {
        enqueueObservabilityTask(async () => {
          await appendAndProject('trace', event);
        });
        await callbacks?.onTrace?.(event);
      },
      onToolPolicy: callbacks?.onToolPolicy,
      onError: callbacks?.onError,
    };

    await this.observabilityScope.run(
      {
        executionId,
        conversationId: request.conversationId,
        getStepIndex: () => currentStepIndex,
        enqueue: enqueueObservabilityTask,
        appendEvent: async (eventType, data) => {
          await appendAndProject(eventType, data);
        },
      },
      async () => {
        try {
          for await (const event of this.deps.agent.runStream(
            {
              executionId,
              conversationId: request.conversationId,
              messages: inputMessages,
              systemPrompt: request.systemPrompt,
              tools: request.tools,
              config: request.config,
              maxSteps: request.maxSteps,
              abortSignal: request.abortSignal,
              timeoutBudgetMs: request.timeoutBudgetMs,
              llmTimeoutRatio: request.llmTimeoutRatio,
              contextLimitTokens: request.contextLimitTokens,
            },
            agentCallbacks
          )) {
            const envelope = await appendAndProject(event.type, event.data);

            if (event.type === 'progress' || event.type === 'checkpoint') {
              const stepIndex = readStepIndex(event.data);
              if (stepIndex > currentStepIndex) {
                currentStepIndex = stepIndex;
              }
              await this.deps.executionStore.patch(executionId, {
                stepIndex: currentStepIndex,
                updatedAt: Date.now(),
                ...(event.type === 'checkpoint' ? { lastCheckpointSeq: envelope.seq } : {}),
              });
            }

            if (event.type === 'compaction') {
              const contextStore = resolveContextStore(this.deps.messageStore);
              if (contextStore) {
                const compaction = extractCompactionInfo(event.data, currentStepIndex);
                if (compaction.removedMessageIds.length > 0) {
                  await contextStore.applyCompaction({
                    conversationId: request.conversationId,
                    executionId,
                    stepIndex: compaction.stepIndex,
                    removedMessageIds: compaction.removedMessageIds,
                    createdAt: envelope.createdAt,
                  });
                }
              }
            }

            if (event.type === 'done') {
              terminalEventSeen = true;
              const doneData = event.data as {
                finishReason?: 'stop' | 'max_steps';
                steps?: number;
              };
              finishReason = doneData.finishReason ?? 'stop';
              if (typeof doneData.steps === 'number' && doneData.steps > 0) {
                steps = doneData.steps;
                currentStepIndex = Math.max(currentStepIndex, doneData.steps);
              }
            }

            if (event.type === 'error') {
              terminalEventSeen = true;
              finishReason = 'error';
              latestErrorPayload = extractErrorPayload(event.data);
            }
          }
        } catch (error) {
          streamFailure = error;
        } finally {
          this.deps.agent.off('tool_chunk', toolChunkListener);
          await toolEventQueue;
          await observabilityQueue;
        }
      }
    );

    if (toolStreamFailure && !streamFailure) {
      streamFailure = toolStreamFailure;
    }

    if (streamFailure) {
      finishReason = 'error';
      const normalized = normalizeUnknownError(streamFailure);
      if (!terminalEventSeen) {
        await appendAndProject('error', normalized);
      }
      if (!latestErrorPayload) {
        latestErrorPayload = normalized;
      }
    }

    if (steps === 0) {
      steps = inferSteps(events);
    }
    currentStepIndex = Math.max(currentStepIndex, steps);

    await this.deps.executionStore.patch(
      executionId,
      buildTerminalPatch(finishReason, {
        stepIndex: currentStepIndex,
        error: latestErrorPayload,
      })
    );

    const run = await this.deps.executionStore.get(executionId);
    if (!run) {
      throw new Error(`Run not found after completion: ${executionId}`);
    }

    return {
      executionId,
      conversationId: request.conversationId,
      messages: [...inputMessages, ...emittedMessages],
      events,
      finishReason,
      steps: currentStepIndex,
      run,
    };
  }

  async getRun(executionId: string): Promise<RunRecord | null> {
    return this.deps.executionStore.get(executionId);
  }

  async listRuns(conversationId: string, opts?: ListRunsOptions): Promise<ListRunsResult> {
    return this.deps.executionStore.listByConversation(conversationId, opts);
  }

  async listRunEvents(executionId: string): Promise<CliEventEnvelope[]> {
    return this.deps.eventStore.listByRun(executionId);
  }

  async listContextMessages(conversationId: string): Promise<Message[]> {
    const contextStore = resolveContextStore(this.deps.messageStore);
    if (contextStore) {
      return contextStore.listContext(conversationId);
    }
    if (this.deps.messageStore) {
      return this.deps.messageStore.list(conversationId);
    }
    return [];
  }

  async listDroppedMessages(
    executionId: string,
    opts?: { stepIndex?: number; limit?: number }
  ): Promise<CompactionDroppedMessageRecord[]> {
    const contextStore = resolveContextStore(this.deps.messageStore);
    if (!contextStore) {
      return [];
    }
    return contextStore.listDroppedMessages(executionId, opts);
  }

  async listRunLogs(executionId: string, opts?: { level?: RunLogLevel; limit?: number }) {
    const runLogStore = resolveRunLogStore(this.deps);
    if (!runLogStore) {
      return [];
    }
    return runLogStore.listRunLogs(executionId, opts);
  }

  private createScopedLogger(): AgentLogger {
    return {
      debug: (message, context, data) => {
        this.enqueueRunLog('debug', message, undefined, context, data);
      },
      info: (message, context, data) => {
        this.enqueueRunLog('info', message, undefined, context, data);
      },
      warn: (message, context, data) => {
        this.enqueueRunLog('warn', message, undefined, context, data);
      },
      error: (message, error, context) => {
        this.enqueueRunLog('error', message, error, context);
      },
    };
  }

  private enqueueRunLog(
    level: RunLogLevel,
    message: string,
    error?: unknown,
    context?: AgentLogContext,
    data?: unknown
  ): void {
    const scope = this.observabilityScope.getStore();
    const runLogStore = resolveRunLogStore(this.deps);
    if (!scope || !runLogStore) {
      return;
    }

    const payload = buildRunLogPayload({
      level,
      message,
      error,
      context,
      data,
      executionId: scope.executionId,
      conversationId: scope.conversationId,
      stepIndex: scope.getStepIndex(),
    });

    scope.enqueue(async () => {
      await runLogStore.appendRunLog(payload);
      await scope.appendEvent('run_log', payload);
    });
  }
}

function buildTerminalPatch(
  finishReason: RunFinishReason,
  context: { stepIndex: number; error?: ErrorEventPayload }
): Partial<RunRecord> {
  const now = Date.now();
  const terminalCommon = {
    updatedAt: now,
    completedAt: now,
    stepIndex: context.stepIndex,
  };

  if (finishReason === 'stop' || finishReason === 'max_steps') {
    return {
      ...terminalCommon,
      status: 'COMPLETED',
      terminalReason: finishReason,
    };
  }

  const mapped = mapErrorPayloadToTerminal(context.error);
  return {
    ...terminalCommon,
    status: mapped.status,
    terminalReason: mapped.terminalReason,
    errorCode: context.error?.errorCode,
    errorCategory: context.error?.category,
    errorMessage: context.error?.message,
  };
}

function mapErrorPayloadToTerminal(error?: ErrorEventPayload): {
  status: RunRecord['status'];
  terminalReason: TerminalReason;
} {
  switch (error?.errorCode) {
    case 'AGENT_ABORTED':
      return { status: 'CANCELLED', terminalReason: 'aborted' };
    case 'AGENT_TIMEOUT_BUDGET_EXCEEDED':
    case 'AGENT_UPSTREAM_TIMEOUT':
      return { status: 'FAILED', terminalReason: 'timeout' };
    case 'AGENT_UPSTREAM_RATE_LIMIT':
      return { status: 'FAILED', terminalReason: 'rate_limit' };
    case 'AGENT_MAX_RETRIES_REACHED':
      return { status: 'FAILED', terminalReason: 'max_retries' };
    default:
      return { status: 'FAILED', terminalReason: 'error' };
  }
}

function inferSteps(events: CliEventEnvelope[]): number {
  let maxStep = 0;
  for (const event of events) {
    if (event.eventType !== 'progress' && event.eventType !== 'checkpoint') {
      continue;
    }
    const stepIndex = readStepIndex(event.data);
    if (stepIndex > maxStep) {
      maxStep = stepIndex;
    }
  }
  return maxStep;
}

function readStepIndex(payload: unknown): number {
  if (!isRecord(payload)) {
    return 0;
  }
  const stepIndex = payload.stepIndex;
  return typeof stepIndex === 'number' && Number.isFinite(stepIndex) && stepIndex > 0
    ? stepIndex
    : 0;
}

function extractErrorPayload(payload: unknown): ErrorEventPayload | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  return {
    errorCode: readString(payload.errorCode) ?? readString(payload.code),
    code: readString(payload.code),
    category: readString(payload.category),
    message: readString(payload.message),
    retryable: readBoolean(payload.retryable),
    httpStatus: readNumber(payload.httpStatus),
    name: readString(payload.name),
  };
}

function buildRunLogPayload(input: {
  level: RunLogLevel;
  message: string;
  error?: unknown;
  context?: AgentLogContext;
  data?: unknown;
  executionId: string;
  conversationId: string;
  stepIndex: number;
}): RunLogRecord {
  const errorRecord = toErrorRecord(input.error);
  const code =
    readString(input.context?.errorCode) ??
    readString(errorRecord?.errorCode) ??
    readString(errorRecord?.code);

  return {
    executionId: input.executionId,
    conversationId: input.conversationId,
    stepIndex: input.stepIndex > 0 ? input.stepIndex : undefined,
    level: input.level,
    code: code ?? undefined,
    source: typeof input.context?.toolName === 'string' ? 'tool' : 'agent',
    message: input.message,
    error: errorRecord ?? undefined,
    context: input.context ? { ...input.context } : undefined,
    data: input.data,
    createdAt: Date.now(),
  };
}

function toErrorRecord(error: unknown): Record<string, unknown> | undefined {
  if (!error) {
    return undefined;
  }
  if (error instanceof Error) {
    const maybeError = error as Error & Record<string, unknown>;
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...(typeof error.cause !== 'undefined' ? { cause: error.cause } : {}),
      ...(readString(maybeError.errorCode) ? { errorCode: readString(maybeError.errorCode) } : {}),
      ...(readString(maybeError.code) ? { code: readString(maybeError.code) } : {}),
    };
  }
  if (isRecord(error)) {
    return { ...error };
  }
  return { message: String(error) };
}

function resolveRunLogStore(deps: AgentAppServiceDeps): RunLogStorePort | undefined {
  if (deps.runLogStore) {
    return deps.runLogStore;
  }
  if (isRunLogStorePort(deps.executionStore)) {
    return deps.executionStore;
  }
  return undefined;
}

function isRunLogStorePort(value: unknown): value is RunLogStorePort {
  return (
    isRecord(value) &&
    typeof value.appendRunLog === 'function' &&
    typeof value.listRunLogs === 'function'
  );
}

function normalizeUnknownError(error: unknown): ErrorEventPayload {
  if (isRecord(error)) {
    const message = readString(error.message) ?? 'Unknown error';
    return {
      name: readString(error.name) ?? 'Error',
      message,
      errorCode: readString(error.errorCode) ?? readString(error.code) ?? 'UNKNOWN_ERROR',
      code: readString(error.code),
      category: readString(error.category),
      retryable: readBoolean(error.retryable),
      httpStatus: readNumber(error.httpStatus),
    };
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      errorCode: 'UNKNOWN_ERROR',
    };
  }
  return {
    name: 'Error',
    message: String(error),
    errorCode: 'UNKNOWN_ERROR',
  };
}

function createUserMessage(content: MessageContent): Message {
  return {
    messageId: createId('msg_usr_'),
    type: 'user',
    role: 'user',
    content,
    timestamp: Date.now(),
  };
}

function createId(prefix: string): string {
  return `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readUsage(value: unknown): Usage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const promptTokens = readNumber(value.prompt_tokens);
  const completionTokens = readNumber(value.completion_tokens);
  const totalTokens = readNumber(value.total_tokens);
  if (promptTokens === undefined || completionTokens === undefined || totalTokens === undefined) {
    return undefined;
  }
  return {
    prompt_tokens: Math.max(0, promptTokens),
    completion_tokens: Math.max(0, completionTokens),
    total_tokens: Math.max(0, totalTokens),
  };
}

function resolveContextStore(
  store?: MessageProjectionStorePort
): ContextProjectionStorePort | undefined {
  if (
    store &&
    typeof (store as ContextProjectionStorePort).listContext === 'function' &&
    typeof (store as ContextProjectionStorePort).applyCompaction === 'function' &&
    typeof (store as ContextProjectionStorePort).listDroppedMessages === 'function'
  ) {
    return store as ContextProjectionStorePort;
  }
  return undefined;
}

function extractCompactionInfo(
  payload: unknown,
  fallbackStepIndex: number
): { stepIndex: number; removedMessageIds: string[] } {
  if (!isRecord(payload)) {
    return { stepIndex: fallbackStepIndex, removedMessageIds: [] };
  }
  const rawRemoved = payload.removedMessageIds;
  const removedMessageIds = Array.isArray(rawRemoved)
    ? rawRemoved.filter((item): item is string => typeof item === 'string')
    : [];
  const stepIndex = readStepIndex(payload);
  return {
    stepIndex: stepIndex > 0 ? stepIndex : fallbackStepIndex,
    removedMessageIds,
  };
}

export const AGENT_V4_APP_SERVICE_MODULE = 'agent-v4-app-service';

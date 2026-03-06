import { z } from 'zod';
import { Agent, AgentAbortedError } from '../agent';
import type { LLMGenerateOptions, LLMProvider } from '../providers';
import { ToolManager } from './manager';
import { BaseTool } from './base';
import type { ToolExecutionContext, ToolResult } from './types';
import { BashTool } from './bash';
import { FileReadTool } from './file-read-tool';
import { FileWriteTool } from './file-write-tool';
import { FileEditTool } from './file-edit-tool';
import { FileStatTool } from './file-stat-tool';
import type { MemoryManager } from '../storage';
import { contentToText } from '../utils';
import type { ToolCall, ToolStreamEvent } from '../core/types';
import type { Plugin } from '../hook';
import {
  TASK_CREATE_DESCRIPTION,
  TASK_GET_DESCRIPTION,
  TASK_LIST_DESCRIPTION,
  TASK_OUTPUT_DESCRIPTION,
  TASK_STOP_DESCRIPTION,
  TASK_TOOL_DESCRIPTION,
  TASK_UPDATE_DESCRIPTION,
} from './task/description';
import {
  JsonObjectSchema,
  JsonPatchSchema,
  ModelHintSchema,
  SubagentTypeSchema,
  type ActiveExecution,
  type BackgroundTaskStatus,
  type ManagedTask,
  type ModelHint,
  type SubTaskRunRecord,
  type SubagentType,
} from './task/types';
import { TaskRuntime, getDefaultTaskRuntime, type TaskRuntimeOptions } from './task/runtime';
import {
  applyMetadataPatch,
  buildSubTaskSessionId,
  compareTaskIds,
  createBackgroundTaskId,
  extractOpenDependencies,
  extractToolsUsed,
  isStatusTransitionAllowed,
  isTerminalBackgroundStatus,
  nextManagedTaskId,
  nowIso,
  pickLastToolName,
  uniqueStrings,
} from './task/utils';

const MANAGED_TASK_ID_PATTERN = /^\d+$/;
const BACKGROUND_TASK_SUGGESTION_LIMIT = 5;

const taskRunSchema = z
  .object({
    description: z.string().min(1).max(200).describe('Short summary of the delegated task'),
    prompt: z.string().min(1).describe('Task prompt executed by the sub-agent'),
    subagent_type: SubagentTypeSchema.describe('Sub-agent type to execute this task'),
    model: ModelHintSchema.optional().describe('Optional model hint'),
    resume: z.string().min(1).optional().describe('Optional resume token, informational only'),
    run_in_background: z
      .boolean()
      .default(false)
      .describe('Whether to run asynchronously and return task_id immediately'),
  })
  .strict();

const taskCreateSchema = z
  .object({
    subject: z.string().min(1).max(200),
    description: z.string().min(1),
    activeForm: z.string().min(1).max(200),
    metadata: JsonObjectSchema.optional(),
  })
  .strict();

const taskGetSchema = z
  .object({
    taskId: z.string().min(1),
  })
  .strict();

const taskListSchema = z.object({}).strict();

const taskUpdateSchema = z
  .object({
    taskId: z.string().min(1),
    status: z.enum(['pending', 'in_progress', 'completed', 'deleted']).optional(),
    subject: z.string().min(1).max(200).optional(),
    description: z.string().min(1).optional(),
    activeForm: z.string().min(1).max(200).optional(),
    owner: z.string().optional(),
    metadata: JsonPatchSchema.optional(),
    addBlocks: z.array(z.string().min(1)).optional(),
    addBlockedBy: z.array(z.string().min(1)).optional(),
  })
  .strict();

const taskStopSchema = z
  .object({
    task_id: z.string().min(1),
  })
  .strict();

const taskOutputSchema = z
  .object({
    task_id: z.string().min(1).describe('Background task identifier returned by task tool'),
    block: z.boolean().default(true).describe('Whether to wait for completion'),
    timeout: z.number().int().min(1000).max(600000).default(30000).describe('Wait timeout in ms'),
  })
  .strict();

interface SubagentConfig {
  systemPrompt: string;
  maxSteps: number;
  maxRetries: number;
}

const SUBAGENT_CONFIGS: Record<SubagentType, SubagentConfig> = {
  bash: {
    systemPrompt:
      'You are a shell-focused engineering assistant. Execute commands safely and summarize results clearly.',
    maxSteps: 20,
    maxRetries: 3,
  },
  'general-purpose': {
    systemPrompt:
      'You are a pragmatic software engineering assistant. Solve the delegated task and verify key outcomes.',
    maxSteps: 40,
    maxRetries: 5,
  },
  explore: {
    systemPrompt:
      'You are a code exploration assistant. Gather accurate context, cite relevant files, and avoid assumptions.',
    maxSteps: 40,
    maxRetries: 5,
  },
  plan: {
    systemPrompt:
      'You are an architecture planner. Produce actionable implementation plans with risks and acceptance criteria.',
    maxSteps: 30,
    maxRetries: 4,
  },
  'ui-sketcher': {
    systemPrompt:
      'You are a UI blueprint assistant. Translate requirements into concrete interaction and layout guidance.',
    maxSteps: 30,
    maxRetries: 4,
  },
  'bug-analyzer': {
    systemPrompt:
      'You are a debugging specialist. Trace execution paths and identify root cause with minimal-risk fixes.',
    maxSteps: 35,
    maxRetries: 5,
  },
  'code-reviewer': {
    systemPrompt:
      'You are a code reviewer focused on correctness, security, reliability, and performance.',
    maxSteps: 35,
    maxRetries: 5,
  },
};

interface TaskSharedOptions extends TaskRuntimeOptions {
  runtime?: TaskRuntime;
}

export interface TaskToolOptions extends TaskSharedOptions {
  provider?: LLMProvider;
  workingDirectory?: string;
  createSubagentToolManager?: (params: {
    subagentType: SubagentType;
    parentContext: ToolExecutionContext;
  }) => ToolManager;
}

interface ParentAgentConfigCarrier {
  config?: {
    provider?: LLMProvider;
    memoryManager?: MemoryManager;
  };
}

interface SubagentRunResult {
  status: 'completed' | 'failed' | 'cancelled';
  output: string;
  error?: string;
  turns: number;
  toolsUsed: string[];
  messageCount: number;
  lastToolName?: string;
}

interface SubagentEventContext {
  taskId: string;
  subagentType: SubagentType;
  childSessionId: string;
}

type EmitToolEvent = NonNullable<ToolExecutionContext['emitToolEvent']>;

function resolveRuntime(options: TaskSharedOptions = {}): TaskRuntime {
  if (options.runtime) {
    return options.runtime;
  }
  return getDefaultTaskRuntime(options);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function resolveProvider(
  options: TaskToolOptions,
  context: ToolExecutionContext
): LLMProvider | undefined {
  if (options.provider) {
    return options.provider;
  }
  const carrier = context.agent as unknown as ParentAgentConfigCarrier;
  return carrier.config?.provider;
}

function resolveMemoryManager(context: ToolExecutionContext): MemoryManager | undefined {
  const carrier = context.agent as unknown as ParentAgentConfigCarrier;
  return carrier.config?.memoryManager;
}

function emitTaskToolEvent(
  context: ToolExecutionContext,
  event: Parameters<EmitToolEvent>[0]
): void {
  const emit = context.agentContext?.emitToolEvent ?? context.emitToolEvent;
  if (!emit) {
    return;
  }
  void Promise.resolve(emit(event)).catch(() => {
    // 流式事件不影响主流程
  });
}

function createSubagentBubblePlugin(
  context: ToolExecutionContext,
  eventCtx: SubagentEventContext
): Plugin {
  const withBaseData = (data?: Record<string, unknown>): Record<string, unknown> => ({
    source: 'subagent',
    task_id: eventCtx.taskId,
    subagent_type: eventCtx.subagentType,
    child_session_id: eventCtx.childSessionId,
    ...(data ?? {}),
  });

  return {
    name: `task-subagent-bubble-${eventCtx.taskId}`,
    textDelta: async (delta) => {
      emitTaskToolEvent(context, {
        type: 'stdout',
        content: delta.text,
        data: withBaseData({
          event: 'text_delta',
          is_reasoning: delta.isReasoning === true,
        }),
      });
    },
    toolUse: async (toolCall: ToolCall) => {
      emitTaskToolEvent(context, {
        type: 'info',
        content: `SUBAGENT_TOOL_USE: ${toolCall.function.name}`,
        data: withBaseData({
          event: 'tool_use',
          child_tool_name: toolCall.function.name,
          child_tool_call_id: toolCall.id,
        }),
      });
      return toolCall;
    },
    toolResult: async (payload: { toolCall: ToolCall; result: ToolResult }) => {
      emitTaskToolEvent(context, {
        type: payload.result.success ? 'info' : 'stderr',
        content: payload.result.success
          ? `SUBAGENT_TOOL_RESULT_OK: ${payload.toolCall.function.name}`
          : `SUBAGENT_TOOL_RESULT_ERROR: ${payload.toolCall.function.name}`,
        data: withBaseData({
          event: 'tool_result',
          child_tool_name: payload.toolCall.function.name,
          child_tool_call_id: payload.toolCall.id,
          child_result_success: payload.result.success,
          child_result_error: payload.result.error,
        }),
      });
      return payload;
    },
    toolStream: async (event: ToolStreamEvent) => {
      emitTaskToolEvent(context, {
        type: event.type,
        content: event.content,
        data: withBaseData({
          event: 'tool_stream',
          child_tool_name: event.toolName,
          child_tool_call_id: event.toolCallId,
          child_sequence: event.sequence,
          child_timestamp: event.timestamp,
          child_data: event.data,
        }),
      });
    },
    stop: async (reason) => {
      emitTaskToolEvent(context, {
        type: reason.reason === 'user_abort' ? 'error' : 'info',
        content: `SUBAGENT_STOP: ${reason.reason}`,
        data: withBaseData({
          event: 'stop',
          reason: reason.reason,
          message: reason.message,
        }),
      });
    },
  };
}

function createDefaultSubagentToolManager(workingDirectory: string): ToolManager {
  const manager = new ToolManager();
  manager.register([
    new BashTool(),
    new FileReadTool({
      allowedDirectories: [workingDirectory],
    }),
    new FileWriteTool({
      allowedDirectories: [workingDirectory],
    }),
    new FileEditTool({
      allowedDirectories: [workingDirectory],
    }),
    new FileStatTool({
      allowedDirectories: [workingDirectory],
    }),
  ]);
  return manager;
}

function buildRunRecord(params: {
  runId: string;
  parentSessionId: string;
  childSessionId: string;
  mode: SubTaskRunRecord['mode'];
  status: BackgroundTaskStatus;
  description: string;
  prompt: string;
  subagentType: SubagentType;
  model?: ModelHint;
  resume?: string;
  output?: string;
  error?: string;
  turns?: number;
  toolsUsed?: string[];
  messageCount?: number;
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
  lastActivityAt?: string;
  lastToolName?: string;
}): SubTaskRunRecord {
  const now = nowIso();
  const createdAt = params.createdAt ?? now;
  const startedAt = params.startedAt ?? now;
  const lastActivityAt = params.lastActivityAt ?? now;
  return {
    runId: params.runId,
    parentSessionId: params.parentSessionId,
    childSessionId: params.childSessionId,
    mode: params.mode,
    status: params.status,
    description: params.description,
    prompt: params.prompt,
    subagentType: params.subagentType,
    model: params.model,
    resume: params.resume,
    output: params.output,
    error: params.error,
    turns: params.turns,
    toolsUsed: params.toolsUsed ?? [],
    messageCount: params.messageCount ?? 0,
    createdAt,
    startedAt,
    finishedAt: params.finishedAt,
    lastActivityAt,
    lastToolName: params.lastToolName,
    updatedAt: now,
  };
}

async function waitWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<{ timedOut: boolean; value?: T }> {
  let timeoutId: NodeJS.Timeout | undefined;
  try {
    const timeoutPromise = new Promise<{ timedOut: true }>((resolve) => {
      timeoutId = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
    });
    const runPromise = promise.then((value) => ({ timedOut: false as const, value }));
    return await Promise.race([runPromise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function resolveModelOverride(provider: LLMProvider, modelHint?: ModelHint): string | undefined {
  if (!modelHint) {
    return undefined;
  }

  const envKey = `TASK_SUBAGENT_MODEL_${modelHint.toUpperCase()}`;
  const mapped = process.env[envKey]?.trim();
  if (mapped) {
    return mapped;
  }

  const providerModel = provider.config?.model;
  if (typeof providerModel !== 'string') {
    return undefined;
  }
  if (!providerModel.toLowerCase().includes('claude')) {
    return undefined;
  }

  if (modelHint === 'opus') return 'claude-opus-4-6';
  if (modelHint === 'sonnet') return 'claude-sonnet-4-5';
  if (modelHint === 'haiku') return 'claude-3-5-haiku';
  return undefined;
}

function buildSubagentOptions(
  provider: LLMProvider,
  modelHint?: ModelHint
): LLMGenerateOptions | undefined {
  const model = resolveModelOverride(provider, modelHint);
  if (!model) {
    return undefined;
  }
  return { model };
}

function runMetadata(run: SubTaskRunRecord): Record<string, unknown> {
  return {
    task_id: run.runId,
    status: run.status,
    parent_session_id: run.parentSessionId,
    child_session_id: run.childSessionId,
    mode: run.mode,
    turns: run.turns,
    tools_used: run.toolsUsed,
    error: run.error,
    message_count: run.messageCount,
    created_at: run.createdAt,
    started_at: run.startedAt,
    finished_at: run.finishedAt,
    last_activity_at: run.lastActivityAt,
    last_tool_name: run.lastToolName,
  };
}

export class TaskTool extends BaseTool<typeof taskRunSchema> {
  protected timeout = 1000 * 60 * 60;
  private readonly options: TaskToolOptions;
  private readonly runtime: TaskRuntime;
  private readonly workingDirectory: string;

  constructor(options: TaskToolOptions = {}) {
    super();
    this.options = options;
    this.runtime = resolveRuntime(options);
    this.workingDirectory = options.workingDirectory ?? process.cwd();
  }

  get meta() {
    return {
      name: 'task',
      description: TASK_TOOL_DESCRIPTION,
      parameters: taskRunSchema,
      category: 'workflow',
      tags: ['task', 'subagent', 'background'],
      dangerous: true,
    };
  }

  async execute(
    args: z.infer<typeof taskRunSchema>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const provider = resolveProvider(this.options, context);
    if (!provider) {
      return this.failure('TASK_PROVIDER_UNAVAILABLE: Provider is required for task execution', {
        error: 'TASK_PROVIDER_UNAVAILABLE',
      });
    }

    const sessionId = this.runtime.resolveSessionId(context);
    const taskId = createBackgroundTaskId();
    const childSessionId = buildSubTaskSessionId(sessionId, taskId);
    const subagentType = args.subagent_type;
    const subagentConfig = SUBAGENT_CONFIGS[subagentType];
    const model = args.model;
    const subagentOptions = buildSubagentOptions(provider, model);
    const memoryManager = resolveMemoryManager(context);
    const runBase = buildRunRecord({
      runId: taskId,
      parentSessionId: sessionId,
      childSessionId,
      mode: args.run_in_background ? 'background' : 'foreground',
      status: args.run_in_background ? 'queued' : 'running',
      description: args.description,
      prompt: args.prompt,
      subagentType,
      model,
      resume: args.resume,
      toolsUsed: [],
      messageCount: 0,
    });

    try {
      await this.runtime.saveRun(sessionId, runBase);
      const subagent = this.createSubagent({
        provider,
        memoryManager,
        subagentType,
        subagentConfig,
        childSessionId,
        taskId,
        bubbleEvents: !args.run_in_background,
        context,
      });

      if (args.run_in_background) {
        const running = { ...runBase, status: 'running' as const, updatedAt: nowIso() };
        await this.runtime.saveRun(sessionId, running);

        const execution: ActiveExecution = {
          run: running,
          agent: subagent,
          promise: Promise.resolve(),
          stopRequested: false,
        };

        const promise = this.executeSubagent(subagent, args.prompt, subagentOptions)
          .then(async (result) => {
            const finalStatus =
              execution.stopRequested && result.status !== 'completed'
                ? 'cancelled'
                : result.status;
            execution.run = {
              ...execution.run,
              status: finalStatus,
              output: result.output,
              error: result.error,
              turns: result.turns,
              toolsUsed: result.toolsUsed,
              messageCount: result.messageCount,
              lastToolName: result.lastToolName,
              finishedAt: nowIso(),
              lastActivityAt: nowIso(),
              updatedAt: nowIso(),
            };
            await this.runtime.saveRun(sessionId, execution.run);
            this.runtime.scheduleExecutionCleanup(taskId);
          })
          .catch(async (error) => {
            const message = toErrorMessage(error);
            const status: BackgroundTaskStatus = execution.stopRequested ? 'cancelled' : 'failed';
            execution.run = {
              ...execution.run,
              status,
              error: status === 'cancelled' ? 'TASK_CANCELLED' : message,
              output:
                status === 'cancelled'
                  ? execution.run.output || 'Task cancelled by user.'
                  : `Task failed: ${message}`,
              finishedAt: nowIso(),
              lastActivityAt: nowIso(),
              updatedAt: nowIso(),
            };
            await this.runtime.saveRun(sessionId, execution.run);
            this.runtime.scheduleExecutionCleanup(taskId);
          });

        execution.promise = promise;
        this.runtime.registerActiveExecution(execution);
        void promise;

        return this.success(
          {
            task_id: taskId,
            status: 'running',
            parent_session_id: sessionId,
            child_session_id: childSessionId,
            subagent_type: subagentType,
            model_hint: model,
            resume: args.resume,
          },
          `Task started in background with task_id=${taskId}`
        );
      }

      const onAbort = () => {
        subagent.abort();
      };
      const abortSignal = context.toolAbortSignal;
      let listeningAbort = false;
      if (abortSignal?.aborted) {
        onAbort();
      } else if (abortSignal) {
        abortSignal.addEventListener('abort', onAbort, { once: true });
        listeningAbort = true;
      }

      let result: SubagentRunResult;
      try {
        result = await this.executeSubagent(subagent, args.prompt, subagentOptions, context, {
          taskId,
          subagentType,
          childSessionId,
        });
      } finally {
        if (listeningAbort && abortSignal) {
          abortSignal.removeEventListener('abort', onAbort);
        }
      }
      const finalStatus = result.status;
      const finalRun = {
        ...runBase,
        status: finalStatus,
        output: result.output,
        error: result.error,
        turns: result.turns,
        toolsUsed: result.toolsUsed,
        messageCount: result.messageCount,
        lastToolName: result.lastToolName,
        finishedAt: nowIso(),
        lastActivityAt: nowIso(),
        updatedAt: nowIso(),
      } satisfies SubTaskRunRecord;
      await this.runtime.saveRun(sessionId, finalRun);

      const payload = {
        task_id: taskId,
        status: finalStatus,
        parent_session_id: sessionId,
        child_session_id: childSessionId,
        subagent_type: subagentType,
        turns: result.turns,
        tools_used: result.toolsUsed,
        error: result.error,
        model_hint: model,
        resume: args.resume,
      };
      if (finalStatus === 'completed') {
        return this.success(payload, result.output);
      }

      const failureCode = finalStatus === 'cancelled' ? 'TASK_CANCELLED' : 'TASK_SUBAGENT_FAILED';
      return this.failure(`${failureCode}: ${result.output}`, {
        ...payload,
        error: failureCode,
        details: result.error,
      });
    } catch (error) {
      const message = toErrorMessage(error);
      return this.failure(`TASK_EXECUTION_FAILED: ${message}`, {
        error: 'TASK_EXECUTION_FAILED',
        message,
        task_id: taskId,
      });
    }
  }

  private createSubagent(params: {
    provider: LLMProvider;
    memoryManager?: MemoryManager;
    subagentType: SubagentType;
    subagentConfig: SubagentConfig;
    childSessionId: string;
    taskId: string;
    bubbleEvents: boolean;
    context: ToolExecutionContext;
  }): Agent {
    const subagentToolManager = this.options.createSubagentToolManager
      ? this.options.createSubagentToolManager({
          subagentType: params.subagentType,
          parentContext: params.context,
        })
      : createDefaultSubagentToolManager(this.workingDirectory);

    const systemPrompt = `${params.subagentConfig.systemPrompt}

Execution context:
- Project root directory: ${this.workingDirectory}
- Use project-root relative paths when possible.`;

    const plugins: Plugin[] = [];
    if (params.bubbleEvents) {
      plugins.push(
        createSubagentBubblePlugin(params.context, {
          taskId: params.taskId,
          subagentType: params.subagentType,
          childSessionId: params.childSessionId,
        })
      );
    }

    return new Agent({
      provider: params.provider,
      systemPrompt,
      toolManager: subagentToolManager,
      maxSteps: params.subagentConfig.maxSteps,
      maxRetries: params.subagentConfig.maxRetries,
      memoryManager: params.memoryManager,
      sessionId: params.childSessionId,
      plugins,
    });
  }

  private async executeSubagent(
    subagent: Agent,
    prompt: string,
    options?: LLMGenerateOptions,
    context?: ToolExecutionContext,
    eventCtx?: SubagentEventContext
  ): Promise<SubagentRunResult> {
    if (context && eventCtx) {
      emitTaskToolEvent(context, {
        type: 'info',
        content: 'SUBAGENT_START',
        data: {
          source: 'subagent',
          task_id: eventCtx.taskId,
          subagent_type: eventCtx.subagentType,
          child_session_id: eventCtx.childSessionId,
          event: 'start',
        },
      });
    }
    try {
      const result = await subagent.run(prompt, options);
      const messages = subagent.getMessages();
      const toolsUsed = extractToolsUsed(messages);
      const output =
        result.text?.trim() || contentToText(messages[messages.length - 1]?.content).trim();
      const cancelled = result.completionReason === 'user_abort';
      const runResult: SubagentRunResult = {
        status: cancelled ? 'cancelled' : 'completed',
        output: cancelled
          ? output || 'Task cancelled by user.'
          : output || 'Task completed with no output',
        turns: result.loopCount,
        toolsUsed,
        messageCount: messages.length,
        lastToolName: pickLastToolName(messages),
      };
      if (context && eventCtx) {
        emitTaskToolEvent(context, {
          type: 'info',
          content: cancelled ? 'SUBAGENT_CANCELLED' : 'SUBAGENT_COMPLETED',
          data: {
            source: 'subagent',
            task_id: eventCtx.taskId,
            subagent_type: eventCtx.subagentType,
            child_session_id: eventCtx.childSessionId,
            event: cancelled ? 'cancelled' : 'completed',
            turns: runResult.turns,
            tools_used: runResult.toolsUsed,
            message_count: runResult.messageCount,
          },
        });
      }
      return runResult;
    } catch (error) {
      const messages = subagent.getMessages();
      const toolsUsed = extractToolsUsed(messages);
      const status: SubagentRunResult['status'] =
        error instanceof AgentAbortedError ? 'cancelled' : 'failed';
      const message = toErrorMessage(error);
      const runResult: SubagentRunResult = {
        status,
        output: status === 'cancelled' ? 'Task cancelled by user.' : `Task failed: ${message}`,
        error: message,
        turns: subagent.getState().loopIndex,
        toolsUsed,
        messageCount: messages.length,
        lastToolName: pickLastToolName(messages),
      };
      if (context && eventCtx) {
        emitTaskToolEvent(context, {
          type: status === 'cancelled' ? 'info' : 'error',
          content: status === 'cancelled' ? 'SUBAGENT_CANCELLED' : 'SUBAGENT_FAILED',
          data: {
            source: 'subagent',
            task_id: eventCtx.taskId,
            subagent_type: eventCtx.subagentType,
            child_session_id: eventCtx.childSessionId,
            event: status === 'cancelled' ? 'cancelled' : 'failed',
            error: message,
          },
        });
      }
      return runResult;
    }
  }
}

export class TaskCreateTool extends BaseTool<typeof taskCreateSchema> {
  private readonly runtime: TaskRuntime;

  constructor(options: TaskSharedOptions = {}) {
    super();
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_create',
      description: TASK_CREATE_DESCRIPTION,
      parameters: taskCreateSchema,
      category: 'workflow',
      tags: ['task', 'management'],
    };
  }

  async execute(
    args: z.infer<typeof taskCreateSchema>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    try {
      const sessionId = this.runtime.resolveSessionId(context);
      const tasks = await this.runtime.listManagedTasks(sessionId);
      const now = nowIso();
      const task: ManagedTask = {
        id: nextManagedTaskId(tasks),
        subject: args.subject,
        description: args.description,
        activeForm: args.activeForm,
        status: 'pending',
        owner: '',
        metadata: args.metadata,
        blocks: [],
        blockedBy: [],
        createdAt: now,
        updatedAt: now,
      };
      await this.runtime.saveManagedTask(sessionId, task);
      return this.success(task, `Created task ${task.id}: ${task.subject}`);
    } catch (error) {
      return this.failure(`TASK_CREATE_FAILED: ${toErrorMessage(error)}`, {
        error: 'TASK_CREATE_FAILED',
      });
    }
  }
}

export class TaskGetTool extends BaseTool<typeof taskGetSchema> {
  private readonly runtime: TaskRuntime;

  constructor(options: TaskSharedOptions = {}) {
    super();
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_get',
      description: TASK_GET_DESCRIPTION,
      parameters: taskGetSchema,
      category: 'workflow',
      tags: ['task', 'management'],
    };
  }

  async execute(
    args: z.infer<typeof taskGetSchema>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const sessionId = this.runtime.resolveSessionId(context);
    const tasks = await this.runtime.listManagedTasks(sessionId);
    const task = tasks.find((item) => item.id === args.taskId);
    if (!task) {
      return this.failure(`TASK_NOT_FOUND: Task not found: ${args.taskId}`, {
        error: 'TASK_NOT_FOUND',
        taskId: args.taskId,
      });
    }
    return this.success(task, `Retrieved task ${task.id}`);
  }
}

export class TaskListTool extends BaseTool<typeof taskListSchema> {
  private readonly runtime: TaskRuntime;

  constructor(options: TaskSharedOptions = {}) {
    super();
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_list',
      description: TASK_LIST_DESCRIPTION,
      parameters: taskListSchema,
      category: 'workflow',
      tags: ['task', 'management'],
    };
  }

  async execute(
    _args: z.infer<typeof taskListSchema>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const sessionId = this.runtime.resolveSessionId(context);
    const tasks = await this.runtime.listManagedTasks(sessionId);
    const sorted = [...tasks].sort((left, right) => compareTaskIds(left.id, right.id));
    const summaries = sorted.map((task) => ({
      id: task.id,
      subject: task.subject,
      status: task.status,
      owner: task.owner || '',
      blockedBy: extractOpenDependencies(tasks, task.blockedBy),
    }));

    return this.success(
      {
        count: summaries.length,
        tasks: summaries,
      },
      `Listed ${summaries.length} task(s)`
    );
  }
}

export class TaskUpdateTool extends BaseTool<typeof taskUpdateSchema> {
  private readonly runtime: TaskRuntime;

  constructor(options: TaskSharedOptions = {}) {
    super();
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_update',
      description: TASK_UPDATE_DESCRIPTION,
      parameters: taskUpdateSchema,
      category: 'workflow',
      tags: ['task', 'management'],
    };
  }

  async execute(
    args: z.infer<typeof taskUpdateSchema>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const sessionId = this.runtime.resolveSessionId(context);
    const tasks = await this.runtime.listManagedTasks(sessionId);
    const index = tasks.findIndex((task) => task.id === args.taskId);
    if (index < 0) {
      return this.failure(`TASK_NOT_FOUND: Task not found: ${args.taskId}`, {
        error: 'TASK_NOT_FOUND',
        taskId: args.taskId,
      });
    }

    if (args.status === 'deleted') {
      const updatedAt = nowIso();
      const touchedTasks = tasks
        .filter((task) => task.id !== args.taskId)
        .map((task) => {
          const blocks = task.blocks.filter((id) => id !== args.taskId);
          const blockedBy = task.blockedBy.filter((id) => id !== args.taskId);
          if (blocks.length === task.blocks.length && blockedBy.length === task.blockedBy.length) {
            return null;
          }
          return {
            ...task,
            blocks,
            blockedBy,
            updatedAt,
          };
        })
        .filter((task): task is ManagedTask => task !== null);

      for (const touchedTask of touchedTasks) {
        await this.runtime.saveManagedTask(sessionId, touchedTask);
      }
      await this.runtime.deleteManagedTask(sessionId, args.taskId);
      return this.success(
        { taskId: args.taskId, status: 'deleted' },
        `Deleted task ${args.taskId}`
      );
    }

    const next = tasks.map((task) => ({
      ...task,
      blocks: [...task.blocks],
      blockedBy: [...task.blockedBy],
    }));
    const current = next[index];

    if (args.status && !isStatusTransitionAllowed(current.status, args.status)) {
      return this.failure(
        `INVALID_STATUS_TRANSITION: Invalid status transition ${current.status} -> ${args.status}`,
        {
          error: 'INVALID_STATUS_TRANSITION',
          from: current.status,
          to: args.status,
        }
      );
    }

    const dependencyIds = uniqueStrings([...(args.addBlocks ?? []), ...(args.addBlockedBy ?? [])]);
    const missingDependencies = dependencyIds.filter(
      (dependencyId) =>
        dependencyId === args.taskId || !next.some((task) => task.id === dependencyId)
    );
    if (missingDependencies.length > 0) {
      return this.failure(
        `INVALID_DEPENDENCY: Invalid dependency task IDs: ${missingDependencies.join(', ')}`,
        {
          error: 'INVALID_DEPENDENCY',
          missingDependencies,
        }
      );
    }

    const touched = new Set<string>([args.taskId]);

    if (args.status) current.status = args.status;
    if (args.subject !== undefined) current.subject = args.subject;
    if (args.description !== undefined) current.description = args.description;
    if (args.activeForm !== undefined) current.activeForm = args.activeForm;
    if (args.owner !== undefined) current.owner = args.owner;
    if (args.metadata) current.metadata = applyMetadataPatch(current.metadata, args.metadata);

    for (const blockedTaskId of uniqueStrings(args.addBlocks ?? [])) {
      const blockedTask = next.find((task) => task.id === blockedTaskId);
      if (!blockedTask) {
        continue;
      }
      current.blocks = uniqueStrings([...current.blocks, blockedTaskId]);
      blockedTask.blockedBy = uniqueStrings([...blockedTask.blockedBy, current.id]);
      touched.add(blockedTask.id);
    }

    for (const blockerTaskId of uniqueStrings(args.addBlockedBy ?? [])) {
      const blockerTask = next.find((task) => task.id === blockerTaskId);
      if (!blockerTask) {
        continue;
      }
      current.blockedBy = uniqueStrings([...current.blockedBy, blockerTaskId]);
      blockerTask.blocks = uniqueStrings([...blockerTask.blocks, current.id]);
      touched.add(blockerTask.id);
    }

    const updatedAt = nowIso();
    for (const task of next) {
      if (touched.has(task.id)) {
        task.updatedAt = updatedAt;
      }
    }

    for (const touchedTask of next.filter((task) => touched.has(task.id))) {
      await this.runtime.saveManagedTask(sessionId, touchedTask);
    }

    return this.success(current, `Updated task ${args.taskId}`);
  }
}

export class TaskStopTool extends BaseTool<typeof taskStopSchema> {
  private readonly runtime: TaskRuntime;

  constructor(options: TaskSharedOptions = {}) {
    super();
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_stop',
      description: TASK_STOP_DESCRIPTION,
      parameters: taskStopSchema,
      category: 'workflow',
      tags: ['task', 'background'],
      dangerous: true,
    };
  }

  async execute(
    args: z.infer<typeof taskStopSchema>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const sessionId = this.runtime.resolveSessionId(context);
    const taskId = args.task_id.trim();
    if (!taskId) {
      return this.failure('TASK_NOT_FOUND: Background task not found: <empty>', {
        error: 'TASK_NOT_FOUND',
      });
    }

    const execution = this.runtime.getActiveExecution(taskId);
    const runRecord = await this.runtime.getRun(sessionId, taskId);

    if (!execution && !runRecord) {
      return this.failure(`TASK_NOT_FOUND: Background task not found: ${taskId}`, {
        error: 'TASK_NOT_FOUND',
        task_id: taskId,
      });
    }

    if (!execution || isTerminalBackgroundStatus(execution.run.status)) {
      const snapshot = runRecord ?? execution?.run;
      return this.success(
        {
          task_id: taskId,
          status: snapshot?.status ?? 'unknown',
        },
        `Task ${taskId} is already ${snapshot?.status ?? 'finished'}`
      );
    }

    execution.stopRequested = true;
    execution.run.status = 'cancelling';
    execution.run.error = 'TASK_CANCELLING';
    execution.run.output = 'Cancellation requested.';
    execution.run.lastActivityAt = nowIso();
    execution.run.updatedAt = nowIso();
    await this.runtime.saveRun(sessionId, execution.run);
    execution.agent.abort();

    const waitResult = await waitWithTimeout(execution.promise, 2000);
    if (waitResult.timedOut && !isTerminalBackgroundStatus(execution.run.status)) {
      execution.run.status = 'cancelled';
      execution.run.error = 'TASK_CANCELLED';
      execution.run.output = 'Task cancelled by user.';
      execution.run.finishedAt = nowIso();
      execution.run.lastActivityAt = execution.run.finishedAt;
      execution.run.updatedAt = execution.run.finishedAt;
      await this.runtime.saveRun(sessionId, execution.run);
      this.runtime.scheduleExecutionCleanup(taskId);
    }

    return this.success(
      {
        task_id: taskId,
        status: execution.run.status,
        parent_session_id: execution.run.parentSessionId,
        child_session_id: execution.run.childSessionId,
      },
      execution.run.status === 'cancelled'
        ? `Cancelled task ${taskId}`
        : `Cancellation requested for task ${taskId}`
    );
  }
}

export class TaskOutputTool extends BaseTool<typeof taskOutputSchema> {
  protected timeout = 600000;
  private readonly runtime: TaskRuntime;

  constructor(options: TaskSharedOptions = {}) {
    super();
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_output',
      description: TASK_OUTPUT_DESCRIPTION,
      parameters: taskOutputSchema,
      category: 'workflow',
      tags: ['task', 'background'],
    };
  }

  async execute(
    args: z.infer<typeof taskOutputSchema>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const sessionId = this.runtime.resolveSessionId(context);
    const taskId = args.task_id.trim();
    if (!taskId) {
      return this.buildTaskNotFoundResult('<empty>', sessionId);
    }

    const execution = this.runtime.getActiveExecution(taskId);
    const runRecord = await this.runtime.getRun(sessionId, taskId);
    if (!execution && !runRecord) {
      return this.buildTaskNotFoundResult(taskId, sessionId);
    }

    if (execution) {
      await this.runtime.refreshActiveExecution(taskId);
    }

    if (
      args.block &&
      execution &&
      (execution.run.status === 'queued' ||
        execution.run.status === 'running' ||
        execution.run.status === 'cancelling')
    ) {
      const waitResult = await waitWithTimeout(execution.promise, args.timeout);
      if (waitResult.timedOut) {
        await this.runtime.refreshActiveExecution(taskId);
        return this.success(
          {
            ...runMetadata(execution.run),
            timed_out: true,
          },
          execution.run.output ??
            `Task ${taskId} is still ${execution.run.status} after ${args.timeout}ms timeout`
        );
      }
    }

    const latestExecution = this.runtime.getActiveExecution(taskId);
    if (latestExecution) {
      return this.success(runMetadata(latestExecution.run), latestExecution.run.output ?? '');
    }

    const latestRun = await this.runtime.getRun(sessionId, taskId);
    if (latestRun) {
      return this.success(
        runMetadata(latestRun),
        latestRun.output ?? `Task ${taskId} status: ${latestRun.status}`
      );
    }

    return this.buildTaskNotFoundResult(taskId, sessionId);
  }

  private async buildTaskNotFoundResult(taskId: string, sessionId: string): Promise<ToolResult> {
    const runs = await this.runtime.listRuns(sessionId, {
      mode: 'background',
      orderBy: 'updatedAt',
      orderDirection: 'desc',
      limit: BACKGROUND_TASK_SUGGESTION_LIMIT,
    });
    const suggestedTaskIds = uniqueStrings(runs.map((run) => run.runId)).slice(
      0,
      BACKGROUND_TASK_SUGGESTION_LIMIT
    );
    const likelyManagedTaskId = MANAGED_TASK_ID_PATTERN.test(taskId);
    const formatHint = likelyManagedTaskId
      ? 'task_output expects background IDs (task_*) returned by task(run_in_background=true), not managed task IDs from task_list/task_create/task_update.'
      : 'task_output expects a background ID (task_*) returned by task(run_in_background=true).';
    const suggestionHint =
      suggestedTaskIds.length > 0
        ? ` Recent background task IDs: ${suggestedTaskIds.join(', ')}`
        : '';

    return this.failure(
      `TASK_NOT_FOUND: Task not found: ${taskId}. ${formatHint}${suggestionHint}`,
      {
        error: 'TASK_NOT_FOUND',
        requested_task_id: taskId,
        expected_task_id_format: 'task_*',
        likely_managed_task_id: likelyManagedTaskId,
        suggested_task_ids: suggestedTaskIds,
      }
    );
  }
}

export async function clearTaskState(sessionId?: string): Promise<void> {
  const runtime = getDefaultTaskRuntime();
  await runtime.clearState(sessionId);
}

export {
  TaskRuntime,
  getDefaultTaskRuntime,
  type TaskRuntimeOptions,
  type SubagentType,
  type ModelHint,
};

export default TaskTool;

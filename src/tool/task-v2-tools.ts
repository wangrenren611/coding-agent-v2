import { z } from 'zod';
import type { MemoryManager } from '../storage';
import type { LLMProvider } from '../providers';
import { BaseTool } from './base';
import type { ToolExecutionContext, ToolResult } from './types';
import { TaskV2Error } from './task-v2/errors';
import {
  getSubAgentProfile,
  resolveSubAgentConfigSnapshot,
  type SubAgentProfileOverrides,
} from './task-v2/profiles';
import {
  TaskV2Runtime,
  getDefaultTaskV2Runtime,
  type TaskV2RuntimeOptions,
} from './task-v2/runtime/runtime';
import { createAgentRunExecutionAdapter } from './task-v2/runtime/agent-adapter';
import { createRunId, createTaskId } from './task-v2/ulid';
import type {
  Run,
  RunId,
  SubAgentConfigSnapshot,
  Task,
  TaskDependency,
  TaskId,
} from './task-v2/types';
import { ToolManager } from './manager';

interface AgentConfigCarrier {
  config?: {
    provider?: LLMProvider;
    memoryManager?: MemoryManager;
  };
}

interface TaskV2SharedOptions extends TaskV2RuntimeOptions {
  runtime?: TaskV2Runtime;
}

export interface TaskV2RunStartToolOptions extends TaskV2SharedOptions {
  provider?: LLMProvider;
  memoryManager?: MemoryManager;
  createSubagentToolManager?: (params: {
    run: Run;
    parentContext: ToolExecutionContext;
  }) => ToolManager;
  maxSteps?: number;
}

const taskCreateSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().min(1),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
    status: z.enum(['pending', 'ready', 'blocked']).default('pending'),
  })
  .strict();

const taskGetSchema = z
  .object({
    task_id: z.string().min(1),
  })
  .strict();

const taskListSchema = z
  .object({
    status: z
      .enum(['pending', 'ready', 'running', 'blocked', 'completed', 'failed', 'cancelled'])
      .optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    limit: z.number().int().min(1).max(500).default(200),
  })
  .strict();

const taskUpdateSchema = z
  .object({
    task_id: z.string().min(1),
    title: z.string().min(1).max(200).optional(),
    description: z.string().min(1).optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    status: z
      .enum(['pending', 'ready', 'running', 'blocked', 'completed', 'failed', 'cancelled'])
      .optional(),
    expected_version: z.number().int().min(1).optional(),
  })
  .strict();

const taskDeleteSchema = z
  .object({
    task_id: z.string().min(1),
  })
  .strict();

const taskDependencyAddSchema = z
  .object({
    task_id: z.string().min(1),
    depends_on_task_id: z.string().min(1),
  })
  .strict();

const taskDependencyRemoveSchema = z
  .object({
    task_id: z.string().min(1),
    depends_on_task_id: z.string().min(1),
  })
  .strict();

const taskDependencyListSchema = z
  .object({
    task_id: z.string().min(1).optional(),
  })
  .strict();

const subAgentOverridesSchema = z
  .object({
    system_prompt: z.string().min(1).max(8_000).optional(),
    output_contract: z.string().min(1).max(4_000).optional(),
    max_steps: z.number().int().min(1).max(1_000).optional(),
    timeout_ms: z.number().int().min(1_000).max(3_600_000).optional(),
    tool_allowlist: z.array(z.string().min(1)).max(100).optional(),
    tool_denylist: z.array(z.string().min(1)).max(100).optional(),
    memory_mode: z.enum(['inherit', 'isolated', 'off']).optional(),
  })
  .strict();

const taskRunStartSchema = z
  .object({
    task_id: z.string().min(1).optional(),
    prompt: z.string().min(1).optional(),
    agent_type: z.string().min(1).default('general-purpose'),
    agent_profile_id: z.string().min(1).optional(),
    agent_overrides: subAgentOverridesSchema.optional(),
    timeout_ms: z.number().int().min(1_000).max(3_600_000).optional(),
  })
  .strict();

const taskSubmitSchema = z
  .object({
    title: z.string().min(1).max(200),
    description: z.string().min(1),
    prompt: z.string().min(1),
    profile: z.string().min(1),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
    status: z.enum(['pending', 'ready', 'blocked']).default('ready'),
    agent_overrides: subAgentOverridesSchema.optional(),
    timeout_ms: z.number().int().min(1_000).max(3_600_000).optional(),
    wait: z.boolean().default(true),
    wait_timeout_ms: z.number().int().min(1_000).max(3_600_000).default(30_000),
    poll_interval_ms: z.number().int().min(100).max(5_000).default(300),
    dedupe_window_ms: z.number().int().min(0).max(3_600_000).default(120_000),
    force_new: z.boolean().default(false),
    include_events: z.boolean().default(false),
    events_after_seq: z.number().int().min(0).default(0),
    events_limit: z.number().int().min(1).max(1_000).default(200),
  })
  .strict();

const taskDispatchReadySchema = z
  .object({
    profile: z.string().min(1),
    agent_overrides: subAgentOverridesSchema.optional(),
    timeout_ms: z.number().int().min(1_000).max(3_600_000).optional(),
    max_parallel: z.number().int().min(1).max(50).default(3),
    scan_limit: z.number().int().min(1).max(2_000).default(500),
    wait: z.boolean().default(false),
    wait_timeout_ms: z.number().int().min(1_000).max(3_600_000).default(30_000),
    poll_interval_ms: z.number().int().min(100).max(5_000).default(300),
    include_events: z.boolean().default(false),
    events_after_seq: z.number().int().min(0).default(0),
    events_limit: z.number().int().min(1).max(1_000).default(200),
  })
  .strict();

const taskRunGetSchema = z
  .object({
    run_id: z.string().min(1),
  })
  .strict();

const taskRunWaitSchema = z
  .object({
    run_id: z.string().min(1),
    timeout_ms: z.number().int().min(1_000).max(3_600_000).default(30_000),
    poll_interval_ms: z.number().int().min(100).max(5_000).default(300),
  })
  .strict();

const taskRunCancelSchema = z
  .object({
    run_id: z.string().min(1),
  })
  .strict();

const taskRunEventsSchema = z
  .object({
    run_id: z.string().min(1),
    after_seq: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(1_000).default(200),
  })
  .strict();

const taskClearSessionSchema = z.object({}).strict();

const taskGcRunsSchema = z
  .object({
    finished_before: z.string().datetime().optional(),
    older_than_hours: z
      .number()
      .int()
      .min(1)
      .max(24 * 365)
      .default(24 * 7),
    limit: z.number().int().min(1).max(5_000).default(500),
  })
  .strict();

function resolveRuntime(options: TaskV2SharedOptions = {}): TaskV2Runtime {
  if (options.runtime) {
    return options.runtime;
  }
  return getDefaultTaskV2Runtime(options);
}

function resolveSessionId(runtime: TaskV2Runtime, context: ToolExecutionContext): string {
  return runtime.resolveSessionId(context);
}

function parseInputSnapshot(snapshot: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(snapshot);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore parse errors
  }
  return {};
}

const REUSABLE_SUBMIT_RUN_STATUSES = new Set<Run['status']>([
  'queued',
  'running',
  'cancel_requested',
  'succeeded',
]);

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function parseIsoMs(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

interface SubmitMatch {
  task: Task;
  run?: Run;
}

async function findRecentSubmitMatch(
  runtime: TaskV2Runtime,
  sessionId: string,
  args: z.infer<typeof taskSubmitSchema>
): Promise<SubmitMatch | null> {
  if (args.dedupe_window_ms <= 0 || args.force_new) {
    return null;
  }

  const nowMs = Date.now();
  const cutoffMs = nowMs - args.dedupe_window_ms;
  const normalizedTitle = normalizeText(args.title);
  const normalizedDescription = normalizeText(args.description);
  const normalizedPrompt = normalizeText(args.prompt);
  const normalizedProfile = normalizeText(args.profile);
  const taskCache = new Map<TaskId, Task | null>();

  const getTaskCached = async (taskId: TaskId): Promise<Task | null> => {
    if (taskCache.has(taskId)) {
      return taskCache.get(taskId) ?? null;
    }
    try {
      const task = await runtime.service.getTask(sessionId, taskId);
      taskCache.set(taskId, task);
      return task;
    } catch {
      taskCache.set(taskId, null);
      return null;
    }
  };

  const runs = await runtime.service.listRuns(sessionId, { limit: 300 });
  for (const run of runs) {
    if (parseIsoMs(run.createdAt) < cutoffMs) continue;
    if (!REUSABLE_SUBMIT_RUN_STATUSES.has(run.status)) continue;
    if (!run.taskId) continue;
    const profile = normalizeText(run.agentProfileId ?? run.agentType);
    if (profile !== normalizedProfile) continue;
    const snapshot = parseInputSnapshot(run.inputSnapshot);
    const snapshotPrompt =
      typeof snapshot.prompt === 'string' ? normalizeText(snapshot.prompt) : '';
    if (snapshotPrompt !== normalizedPrompt) continue;
    const task = await getTaskCached(run.taskId);
    if (!task) continue;
    if (task.priority !== args.priority) continue;
    if (normalizeText(task.title) !== normalizedTitle) continue;
    if (normalizeText(task.description) !== normalizedDescription) continue;
    return { task, run };
  }

  const tasks = await runtime.service.listTasks(sessionId, { limit: 200 });
  for (const task of tasks) {
    if (parseIsoMs(task.createdAt) < cutoffMs) continue;
    if (task.priority !== args.priority) continue;
    if (normalizeText(task.title) !== normalizedTitle) continue;
    if (normalizeText(task.description) !== normalizedDescription) continue;
    const taskRuns = await runtime.service.listRuns(sessionId, { taskId: task.id, limit: 30 });
    for (const run of taskRuns) {
      if (parseIsoMs(run.createdAt) < cutoffMs) continue;
      if (!REUSABLE_SUBMIT_RUN_STATUSES.has(run.status)) continue;
      const profile = normalizeText(run.agentProfileId ?? run.agentType);
      if (profile !== normalizedProfile) continue;
      const snapshot = parseInputSnapshot(run.inputSnapshot);
      const snapshotPrompt =
        typeof snapshot.prompt === 'string' ? normalizeText(snapshot.prompt) : '';
      if (snapshotPrompt !== normalizedPrompt) continue;
      return { task, run };
    }
    if (taskRuns.length === 0) {
      return { task };
    }
  }

  return null;
}

function formatRun(run: Run): Record<string, unknown> {
  return {
    id: run.id,
    session_id: run.sessionId,
    task_id: run.taskId ?? null,
    agent_type: run.agentType,
    agent_profile_id: run.agentProfileId ?? null,
    agent_config_snapshot: run.agentConfigSnapshot ?? null,
    status: run.status,
    input_snapshot: parseInputSnapshot(run.inputSnapshot),
    output: run.output ?? null,
    error: run.error ?? null,
    timeout_ms: run.timeoutMs ?? null,
    started_at: run.startedAt ?? null,
    finished_at: run.finishedAt ?? null,
    created_at: run.createdAt,
    updated_at: run.updatedAt,
  };
}

function formatTask(task: Task): Record<string, unknown> {
  return {
    id: task.id,
    session_id: task.sessionId,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    version: task.version,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  };
}

function formatDependency(dependency: TaskDependency): Record<string, unknown> {
  return {
    task_id: dependency.taskId,
    depends_on_task_id: dependency.dependsOnTaskId,
    created_at: dependency.createdAt,
  };
}

function failureResult(error: unknown): ToolResult {
  if (error instanceof TaskV2Error) {
    return {
      success: false,
      error: `${error.code}: ${error.message}`,
      data: error.details,
    };
  }
  if (error instanceof Error) {
    return {
      success: false,
      error: error.message,
    };
  }
  return {
    success: false,
    error: String(error),
  };
}

function resolveProvider(
  options: TaskV2RunStartToolOptions,
  context: ToolExecutionContext
): LLMProvider | null {
  if (options.provider) {
    return options.provider;
  }
  const carrier = context.agent as unknown as AgentConfigCarrier;
  return carrier.config?.provider ?? null;
}

function resolveMemoryManager(
  options: TaskV2RunStartToolOptions,
  context: ToolExecutionContext
): MemoryManager | undefined {
  if (options.memoryManager) {
    return options.memoryManager;
  }
  const carrier = context.agent as unknown as AgentConfigCarrier;
  return carrier.config?.memoryManager;
}

function toProfileOverrides(
  overrides: z.infer<typeof subAgentOverridesSchema> | undefined
): SubAgentProfileOverrides | undefined {
  if (!overrides) {
    return undefined;
  }
  return {
    systemPrompt: overrides.system_prompt,
    outputContract: overrides.output_contract,
    maxSteps: overrides.max_steps,
    timeoutMs: overrides.timeout_ms,
    toolAllowlist: overrides.tool_allowlist,
    toolDenylist: overrides.tool_denylist,
    memoryMode: overrides.memory_mode,
  };
}

function resolveAgentConfig(args: z.infer<typeof taskRunStartSchema>): SubAgentConfigSnapshot {
  const profileId = args.agent_profile_id?.trim() || args.agent_type.trim();
  const profile = getSubAgentProfile(profileId);
  if (!profile) {
    throw new TaskV2Error('INVALID_ARGUMENT', `unknown agent profile: ${profileId}`, {
      agent_profile_id: args.agent_profile_id,
      agent_type: args.agent_type,
    });
  }
  return resolveSubAgentConfigSnapshot({
    profile,
    overrides: toProfileOverrides(args.agent_overrides),
    timeoutMs: args.timeout_ms,
  });
}

function applyToolPolicy(manager: ToolManager, config: SubAgentConfigSnapshot): ToolManager {
  const allowlist =
    config.toolAllowlist && config.toolAllowlist.length > 0 ? config.toolAllowlist : null;
  const denylist =
    config.toolDenylist && config.toolDenylist.length > 0 ? config.toolDenylist : null;
  const names = manager.getToolNames();
  for (const name of names) {
    const normalized = name.trim().toLowerCase();
    if (allowlist && !allowlist.includes(normalized)) {
      manager.unregister(name);
      continue;
    }
    if (denylist && denylist.includes(normalized)) {
      manager.unregister(name);
    }
  }
  return manager;
}

function ensureTaskId(raw: string): TaskId {
  return raw as TaskId;
}

function ensureRunId(raw: string): RunId {
  return raw as RunId;
}

const ACTIVE_RUN_STATUSES: Run['status'][] = ['queued', 'running', 'cancel_requested'];

function isRunTerminal(status: Run['status']): boolean {
  return (
    status === 'succeeded' || status === 'failed' || status === 'cancelled' || status === 'timeout'
  );
}

type RunStartArgs = z.infer<typeof taskRunStartSchema>;

function buildRunAdapter(params: {
  options: TaskV2RunStartToolOptions;
  context: ToolExecutionContext;
  args: RunStartArgs;
}): {
  input: {
    taskId?: TaskId;
    prompt?: string;
    agentType: string;
    agentProfileId: string;
    agentConfigSnapshot: SubAgentConfigSnapshot;
    timeoutMs?: number;
  };
  adapter: ReturnType<typeof createAgentRunExecutionAdapter>;
} | null {
  const { options, context, args } = params;
  const provider = resolveProvider(options, context);
  if (!provider) {
    return null;
  }
  const agentConfig = resolveAgentConfig(args);
  const memoryManager = resolveMemoryManager(options, context);
  const adapter = createAgentRunExecutionAdapter({
    provider,
    memoryManager,
    maxSteps: options.maxSteps ?? agentConfig.maxSteps,
    createToolManager: (run) =>
      applyToolPolicy(
        options.createSubagentToolManager?.({ run, parentContext: context }) ?? new ToolManager(),
        agentConfig
      ),
  });

  return {
    input: {
      taskId: args.task_id ? ensureTaskId(args.task_id) : undefined,
      prompt: args.prompt,
      agentType: args.agent_type,
      agentProfileId: agentConfig.profileId,
      agentConfigSnapshot: agentConfig,
      timeoutMs: agentConfig.timeoutMs,
    },
    adapter,
  };
}

export class TaskV2CreateTool extends BaseTool<typeof taskCreateSchema> {
  private readonly runtime: TaskV2Runtime;

  constructor(options: TaskV2SharedOptions = {}) {
    super();
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_create',
      description: 'Create a task in the current session.',
      parameters: taskCreateSchema,
    } as const;
  }

  async execute(args: z.infer<typeof taskCreateSchema>, context: ToolExecutionContext) {
    try {
      await this.runtime.prepare();
      const sessionId = resolveSessionId(this.runtime, context);
      const task = await this.runtime.service.createTask(sessionId, args, createTaskId());
      return this.success(formatTask(task));
    } catch (error) {
      return failureResult(error);
    }
  }
}

export class TaskV2GetTool extends BaseTool<typeof taskGetSchema> {
  private readonly runtime: TaskV2Runtime;

  constructor(options: TaskV2SharedOptions = {}) {
    super();
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_get',
      description: 'Get a task by task_id in the current session.',
      parameters: taskGetSchema,
    } as const;
  }

  async execute(args: z.infer<typeof taskGetSchema>, context: ToolExecutionContext) {
    try {
      await this.runtime.prepare();
      const sessionId = resolveSessionId(this.runtime, context);
      const task = await this.runtime.service.getTask(sessionId, ensureTaskId(args.task_id));
      return this.success(formatTask(task));
    } catch (error) {
      return failureResult(error);
    }
  }
}

export class TaskV2ListTool extends BaseTool<typeof taskListSchema> {
  private readonly runtime: TaskV2Runtime;

  constructor(options: TaskV2SharedOptions = {}) {
    super();
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_list',
      description: 'List tasks in the current session.',
      parameters: taskListSchema,
    } as const;
  }

  async execute(args: z.infer<typeof taskListSchema>, context: ToolExecutionContext) {
    try {
      await this.runtime.prepare();
      const sessionId = resolveSessionId(this.runtime, context);
      const tasks = await this.runtime.service.listTasks(sessionId, {
        status: args.status,
        priority: args.priority,
        limit: args.limit,
      });
      return this.success({
        count: tasks.length,
        tasks: tasks.map((task) => formatTask(task)),
      });
    } catch (error) {
      return failureResult(error);
    }
  }
}

export class TaskV2UpdateTool extends BaseTool<typeof taskUpdateSchema> {
  private readonly runtime: TaskV2Runtime;

  constructor(options: TaskV2SharedOptions = {}) {
    super();
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_update',
      description: 'Update a task by task_id in the current session.',
      parameters: taskUpdateSchema,
    } as const;
  }

  async execute(args: z.infer<typeof taskUpdateSchema>, context: ToolExecutionContext) {
    try {
      await this.runtime.prepare();
      const sessionId = resolveSessionId(this.runtime, context);
      const task = await this.runtime.service.updateTask(sessionId, ensureTaskId(args.task_id), {
        title: args.title,
        description: args.description,
        priority: args.priority,
        status: args.status,
        expectedVersion: args.expected_version,
      });
      return this.success(formatTask(task));
    } catch (error) {
      return failureResult(error);
    }
  }
}

export class TaskV2DeleteTool extends BaseTool<typeof taskDeleteSchema> {
  private readonly runtime: TaskV2Runtime;

  constructor(options: TaskV2SharedOptions = {}) {
    super();
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_delete',
      description: 'Delete a task by task_id in the current session.',
      parameters: taskDeleteSchema,
    } as const;
  }

  async execute(args: z.infer<typeof taskDeleteSchema>, context: ToolExecutionContext) {
    try {
      await this.runtime.prepare();
      const sessionId = resolveSessionId(this.runtime, context);
      await this.runtime.service.deleteTask(sessionId, ensureTaskId(args.task_id));
      return this.success({ task_id: args.task_id, deleted: true });
    } catch (error) {
      return failureResult(error);
    }
  }
}

export class TaskV2DependencyAddTool extends BaseTool<typeof taskDependencyAddSchema> {
  private readonly runtime: TaskV2Runtime;

  constructor(options: TaskV2SharedOptions = {}) {
    super();
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_dependency_add',
      description: 'Add a dependency edge: task_id depends_on_task_id.',
      parameters: taskDependencyAddSchema,
    } as const;
  }

  async execute(args: z.infer<typeof taskDependencyAddSchema>, context: ToolExecutionContext) {
    try {
      await this.runtime.prepare();
      const sessionId = resolveSessionId(this.runtime, context);
      await this.runtime.service.addDependency(
        sessionId,
        ensureTaskId(args.task_id),
        ensureTaskId(args.depends_on_task_id)
      );
      return this.success({
        task_id: args.task_id,
        depends_on_task_id: args.depends_on_task_id,
        created: true,
      });
    } catch (error) {
      return failureResult(error);
    }
  }
}

export class TaskV2DependencyRemoveTool extends BaseTool<typeof taskDependencyRemoveSchema> {
  private readonly runtime: TaskV2Runtime;

  constructor(options: TaskV2SharedOptions = {}) {
    super();
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_dependency_remove',
      description: 'Remove a dependency edge: task_id depends_on_task_id.',
      parameters: taskDependencyRemoveSchema,
    } as const;
  }

  async execute(args: z.infer<typeof taskDependencyRemoveSchema>, context: ToolExecutionContext) {
    try {
      await this.runtime.prepare();
      const sessionId = resolveSessionId(this.runtime, context);
      await this.runtime.service.removeDependency(
        sessionId,
        ensureTaskId(args.task_id),
        ensureTaskId(args.depends_on_task_id)
      );
      return this.success({
        task_id: args.task_id,
        depends_on_task_id: args.depends_on_task_id,
        removed: true,
      });
    } catch (error) {
      return failureResult(error);
    }
  }
}

export class TaskV2DependencyListTool extends BaseTool<typeof taskDependencyListSchema> {
  private readonly runtime: TaskV2Runtime;

  constructor(options: TaskV2SharedOptions = {}) {
    super();
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_dependency_list',
      description: 'List dependency edges in current session (optionally by task_id).',
      parameters: taskDependencyListSchema,
    } as const;
  }

  async execute(args: z.infer<typeof taskDependencyListSchema>, context: ToolExecutionContext) {
    try {
      await this.runtime.prepare();
      const sessionId = resolveSessionId(this.runtime, context);
      const dependencies = await this.runtime.service.listDependencies(
        sessionId,
        args.task_id ? ensureTaskId(args.task_id) : undefined
      );
      return this.success({
        count: dependencies.length,
        dependencies: dependencies.map((dependency) => formatDependency(dependency)),
      });
    } catch (error) {
      return failureResult(error);
    }
  }
}

export class TaskV2RunStartTool extends BaseTool<typeof taskRunStartSchema> {
  private readonly runtime: TaskV2Runtime;
  private readonly options: TaskV2RunStartToolOptions;

  constructor(options: TaskV2RunStartToolOptions = {}) {
    super();
    this.options = options;
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_run_start',
      description: 'Start a run for task_id or ad-hoc prompt.',
      parameters: taskRunStartSchema,
    } as const;
  }

  async execute(args: z.infer<typeof taskRunStartSchema>, context: ToolExecutionContext) {
    try {
      await this.runtime.prepare();
      const sessionId = resolveSessionId(this.runtime, context);
      const runAdapter = buildRunAdapter({
        options: this.options,
        context,
        args,
      });
      if (!runAdapter) {
        return this.failure(
          'TASK_PROVIDER_MISSING: task_run_start requires provider on parent agent or tool option'
        );
      }

      const run = await this.runtime.service.startRun(
        sessionId,
        createRunId(),
        runAdapter.input,
        runAdapter.adapter
      );

      return this.success(formatRun(run));
    } catch (error) {
      return failureResult(error);
    }
  }
}

export class TaskV2SubmitTool extends BaseTool<typeof taskSubmitSchema> {
  private readonly runtime: TaskV2Runtime;
  private readonly options: TaskV2RunStartToolOptions;

  constructor(options: TaskV2RunStartToolOptions = {}) {
    super();
    this.options = options;
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_submit',
      description:
        'High-level task entrypoint with minimal input: prompt + profile + title + description. Includes short-window dedupe to avoid retry duplicates.',
      parameters: taskSubmitSchema,
    } as const;
  }

  async execute(args: z.infer<typeof taskSubmitSchema>, context: ToolExecutionContext) {
    try {
      await this.runtime.prepare();
      const sessionId = resolveSessionId(this.runtime, context);

      const submitMatch = await findRecentSubmitMatch(this.runtime, sessionId, args);
      const deduplicated = Boolean(submitMatch);

      const task =
        submitMatch?.task ??
        (await this.runtime.service.createTask(
          sessionId,
          {
            title: args.title,
            description: args.description,
            priority: args.priority,
            status: args.status,
          },
          createTaskId()
        ));

      const startedRun =
        submitMatch?.run ??
        (await (async () => {
          const runAdapter = buildRunAdapter({
            options: this.options,
            context,
            args: {
              task_id: task.id,
              prompt: args.prompt,
              agent_type: args.profile,
              agent_profile_id: args.profile,
              agent_overrides: args.agent_overrides,
              timeout_ms: args.timeout_ms,
            },
          });
          if (!runAdapter) {
            throw new TaskV2Error(
              'TASK_PROVIDER_MISSING',
              'task_submit requires provider on parent agent or tool option'
            );
          }

          return this.runtime.service.startRun(
            sessionId,
            createRunId(),
            runAdapter.input,
            runAdapter.adapter
          );
        })());

      if (!args.wait) {
        return this.success({
          task: formatTask(task),
          run: formatRun(startedRun),
          waited: false,
          deduplicated,
        });
      }

      const run = await this.runtime.service.waitRun(sessionId, startedRun.id, {
        timeoutMs: args.wait_timeout_ms,
        pollIntervalMs: args.poll_interval_ms,
      });
      const result: Record<string, unknown> = {
        task: formatTask(task),
        run: formatRun(run),
        waited: true,
        timed_out: !isRunTerminal(run.status),
        deduplicated,
      };

      if (args.include_events) {
        const events = await this.runtime.service.listRunEvents(sessionId, run.id, {
          afterSeq: args.events_after_seq,
          limit: args.events_limit,
        });
        result.events = events.map((event) => ({
          run_id: event.runId,
          seq: event.seq,
          type: event.type,
          payload: event.payload,
          created_at: event.createdAt,
        }));
        result.event_count = events.length;
        result.next_after_seq =
          events.length > 0 ? events[events.length - 1].seq : args.events_after_seq;
      }

      return this.success(result);
    } catch (error) {
      return failureResult(error);
    }
  }
}

export class TaskV2DispatchReadyTool extends BaseTool<typeof taskDispatchReadySchema> {
  private readonly runtime: TaskV2Runtime;
  private readonly options: TaskV2RunStartToolOptions;

  constructor(options: TaskV2RunStartToolOptions = {}) {
    super();
    this.options = options;
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_dispatch_ready',
      description:
        'Promote dependency-ready tasks and dispatch runs concurrently with max_parallel.',
      parameters: taskDispatchReadySchema,
    } as const;
  }

  async execute(args: z.infer<typeof taskDispatchReadySchema>, context: ToolExecutionContext) {
    try {
      await this.runtime.prepare();
      const sessionId = resolveSessionId(this.runtime, context);

      const provider = resolveProvider(this.options, context);
      if (!provider) {
        return this.failure(
          'TASK_PROVIDER_MISSING: task_dispatch_ready requires provider on parent agent or tool option'
        );
      }

      const tasks = await this.runtime.service.listTasks(sessionId, { limit: args.scan_limit });
      const taskById = new Map<TaskId, Task>(tasks.map((task) => [task.id, task]));
      const edges = await this.runtime.service.listDependencies(sessionId);
      const depsByTaskId = new Map<TaskId, TaskId[]>();
      for (const edge of edges) {
        const deps = depsByTaskId.get(edge.taskId) ?? [];
        deps.push(edge.dependsOnTaskId);
        depsByTaskId.set(edge.taskId, deps);
      }

      const isDependencySatisfied = (taskId: TaskId): boolean => {
        const deps = depsByTaskId.get(taskId) ?? [];
        return deps.every((depTaskId) => {
          const depTask = taskById.get(depTaskId);
          return depTask?.status === 'completed';
        });
      };

      const promotedTaskIds: string[] = [];
      const skipped: Array<{ task_id: string; reason: string }> = [];
      for (const task of tasks) {
        if (task.status !== 'pending' && task.status !== 'blocked') {
          continue;
        }
        if (!isDependencySatisfied(task.id)) {
          continue;
        }
        try {
          const promoted = await this.runtime.service.updateTask(sessionId, task.id, {
            status: 'ready',
            expectedVersion: task.version,
          });
          taskById.set(promoted.id, promoted);
          promotedTaskIds.push(promoted.id);
        } catch (error) {
          if (error instanceof TaskV2Error) {
            skipped.push({ task_id: task.id, reason: error.code });
            continue;
          }
          throw error;
        }
      }

      const candidates = Array.from(taskById.values()).filter(
        (task) => task.status === 'ready' && isDependencySatisfied(task.id)
      );
      const dispatchQueue: Task[] = [];
      for (const task of candidates) {
        const runs = await this.runtime.service.listRuns(sessionId, { taskId: task.id, limit: 20 });
        const hasActiveRun = runs.some((run) => ACTIVE_RUN_STATUSES.includes(run.status));
        if (hasActiveRun) {
          skipped.push({ task_id: task.id, reason: 'active_run_exists' });
          continue;
        }
        dispatchQueue.push(task);
      }

      const selected = dispatchQueue.slice(0, args.max_parallel);
      const dispatched: Array<{ task_id: string; run_id: string; status: string }> = [];
      for (const task of selected) {
        const runAdapter = buildRunAdapter({
          options: this.options,
          context,
          args: {
            task_id: task.id,
            agent_type: args.profile,
            agent_profile_id: args.profile,
            agent_overrides: args.agent_overrides,
            timeout_ms: args.timeout_ms,
          },
        });
        if (!runAdapter) {
          return this.failure(
            'TASK_PROVIDER_MISSING: task_dispatch_ready requires provider on parent agent or tool option'
          );
        }
        const run = await this.runtime.service.startRun(
          sessionId,
          createRunId(),
          runAdapter.input,
          runAdapter.adapter
        );
        dispatched.push({
          task_id: task.id,
          run_id: run.id,
          status: run.status,
        });
      }

      const response: Record<string, unknown> = {
        scanned_tasks: tasks.length,
        dependency_edges: edges.length,
        promoted_count: promotedTaskIds.length,
        promoted_task_ids: promotedTaskIds,
        candidate_count: candidates.length,
        dispatched_count: dispatched.length,
        dispatched,
        skipped_count: skipped.length,
        skipped,
      };

      if (args.wait && dispatched.length > 0) {
        const waits = await Promise.all(
          dispatched.map((item) =>
            this.runtime.service.waitRun(sessionId, ensureRunId(item.run_id), {
              timeoutMs: args.wait_timeout_ms,
              pollIntervalMs: args.poll_interval_ms,
            })
          )
        );
        response.waited = true;
        response.wait_results = waits.map((run) => ({
          run_id: run.id,
          task_id: run.taskId ?? null,
          status: run.status,
          timed_out: !isRunTerminal(run.status),
        }));

        if (args.include_events) {
          const eventResults = await Promise.all(
            waits.map((run) =>
              this.runtime.service.listRunEvents(sessionId, run.id, {
                afterSeq: args.events_after_seq,
                limit: args.events_limit,
              })
            )
          );
          response.events = eventResults.map((events, index) => ({
            run_id: waits[index].id,
            count: events.length,
            next_after_seq:
              events.length > 0 ? events[events.length - 1].seq : args.events_after_seq,
            events: events.map((event) => ({
              run_id: event.runId,
              seq: event.seq,
              type: event.type,
              payload: event.payload,
              created_at: event.createdAt,
            })),
          }));
        }
      } else {
        response.waited = false;
      }

      return this.success(response);
    } catch (error) {
      return failureResult(error);
    }
  }
}

export class TaskV2RunGetTool extends BaseTool<typeof taskRunGetSchema> {
  private readonly runtime: TaskV2Runtime;

  constructor(options: TaskV2SharedOptions = {}) {
    super();
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_run_get',
      description: 'Get run status by run_id in the current session.',
      parameters: taskRunGetSchema,
    } as const;
  }

  async execute(args: z.infer<typeof taskRunGetSchema>, context: ToolExecutionContext) {
    try {
      await this.runtime.prepare();
      const sessionId = resolveSessionId(this.runtime, context);
      const run = await this.runtime.service.getRun(sessionId, ensureRunId(args.run_id));
      return this.success(formatRun(run));
    } catch (error) {
      return failureResult(error);
    }
  }
}

export class TaskV2RunWaitTool extends BaseTool<typeof taskRunWaitSchema> {
  private readonly runtime: TaskV2Runtime;

  constructor(options: TaskV2SharedOptions = {}) {
    super();
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_run_wait',
      description: 'Block until run reaches terminal status or timeout.',
      parameters: taskRunWaitSchema,
    } as const;
  }

  async execute(args: z.infer<typeof taskRunWaitSchema>, context: ToolExecutionContext) {
    try {
      await this.runtime.prepare();
      const sessionId = resolveSessionId(this.runtime, context);
      const run = await this.runtime.service.waitRun(sessionId, ensureRunId(args.run_id), {
        timeoutMs: args.timeout_ms,
        pollIntervalMs: args.poll_interval_ms,
      });
      return this.success({
        ...formatRun(run),
        timed_out: !['succeeded', 'failed', 'cancelled', 'timeout'].includes(run.status),
      });
    } catch (error) {
      return failureResult(error);
    }
  }
}

export class TaskV2RunCancelTool extends BaseTool<typeof taskRunCancelSchema> {
  private readonly runtime: TaskV2Runtime;

  constructor(options: TaskV2SharedOptions = {}) {
    super();
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_run_cancel',
      description: 'Request cancellation for run_id in the current session.',
      parameters: taskRunCancelSchema,
    } as const;
  }

  async execute(args: z.infer<typeof taskRunCancelSchema>, context: ToolExecutionContext) {
    try {
      await this.runtime.prepare();
      const sessionId = resolveSessionId(this.runtime, context);
      await this.runtime.service.cancelRun(sessionId, ensureRunId(args.run_id));
      const run = await this.runtime.service.getRun(sessionId, ensureRunId(args.run_id));
      return this.success(formatRun(run));
    } catch (error) {
      return failureResult(error);
    }
  }
}

export class TaskV2RunEventsTool extends BaseTool<typeof taskRunEventsSchema> {
  private readonly runtime: TaskV2Runtime;

  constructor(options: TaskV2SharedOptions = {}) {
    super();
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_run_events',
      description: 'List append-only run events with cursor pagination.',
      parameters: taskRunEventsSchema,
    } as const;
  }

  async execute(args: z.infer<typeof taskRunEventsSchema>, context: ToolExecutionContext) {
    try {
      await this.runtime.prepare();
      const sessionId = resolveSessionId(this.runtime, context);
      const events = await this.runtime.service.listRunEvents(sessionId, ensureRunId(args.run_id), {
        afterSeq: args.after_seq,
        limit: args.limit,
      });
      return this.success({
        run_id: args.run_id,
        count: events.length,
        next_after_seq: events.length > 0 ? events[events.length - 1].seq : args.after_seq,
        events: events.map((event) => ({
          run_id: event.runId,
          seq: event.seq,
          type: event.type,
          payload: event.payload,
          created_at: event.createdAt,
        })),
      });
    } catch (error) {
      return failureResult(error);
    }
  }
}

export class TaskV2ClearSessionTool extends BaseTool<typeof taskClearSessionSchema> {
  private readonly runtime: TaskV2Runtime;

  constructor(options: TaskV2SharedOptions = {}) {
    super();
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_clear_session',
      description: 'Clear tasks/runs for current session only.',
      parameters: taskClearSessionSchema,
      dangerous: true,
      requireConfirm: true,
    } as const;
  }

  async execute(_args: z.infer<typeof taskClearSessionSchema>, context: ToolExecutionContext) {
    try {
      await this.runtime.prepare();
      const sessionId = resolveSessionId(this.runtime, context);
      await this.runtime.service.clearSession(sessionId);
      return this.success({ session_id: sessionId, cleared: true });
    } catch (error) {
      return failureResult(error);
    }
  }
}

export class TaskV2GcRunsTool extends BaseTool<typeof taskGcRunsSchema> {
  private readonly runtime: TaskV2Runtime;

  constructor(options: TaskV2SharedOptions = {}) {
    super();
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_gc_runs',
      description: 'Garbage collect finished runs older than a threshold.',
      parameters: taskGcRunsSchema,
      dangerous: true,
      requireConfirm: true,
    } as const;
  }

  async execute(args: z.infer<typeof taskGcRunsSchema>, _context: ToolExecutionContext) {
    try {
      await this.runtime.prepare();
      const finishedBefore =
        args.finished_before ??
        new Date(Date.now() - args.older_than_hours * 60 * 60 * 1000).toISOString();
      const deleted = await this.runtime.service.gcRuns(finishedBefore, args.limit);
      return this.success({
        finished_before: finishedBefore,
        deleted_runs: deleted,
      });
    } catch (error) {
      return failureResult(error);
    }
  }
}

export {
  TaskV2Runtime,
  getDefaultTaskV2Runtime,
  type TaskV2RuntimeOptions,
  type TaskV2SharedOptions,
};

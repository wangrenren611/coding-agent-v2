import { z } from 'zod';
import type { MemoryManager } from '../storage';
import type { LLMProvider } from '../providers';
import { BaseTool } from './base';
import type { ToolExecutionContext, ToolResult } from './types';
import { TaskV3Error } from './task-v3/errors';
import {
  getSubAgentProfile,
  resolveSubAgentConfigSnapshot,
  type SubAgentProfileOverrides,
} from './task-v3/profiles';
import {
  TaskV3Runtime,
  getDefaultTaskV3Runtime,
  type TaskV3RuntimeOptions,
} from './task-v3/runtime/runtime';
import { createAgentRunExecutionAdapter } from './task-v3/runtime/agent-adapter';
import { createRunId, createTaskId } from './task-v3/ulid';
import type {
  Run,
  RunId,
  SubAgentConfigSnapshot,
  Task,
  TaskId,
  TaskPriority,
  TaskStatus,
} from './task-v3/types';
import { ToolManager } from './manager';

interface AgentConfigCarrier {
  config?: {
    provider?: LLMProvider;
    memoryManager?: MemoryManager;
  };
}

interface TaskV3SharedOptions extends TaskV3RuntimeOptions {
  runtime?: TaskV3Runtime;
}

export interface TaskV3ToolOptions extends TaskV3SharedOptions {
  provider?: LLMProvider;
  memoryManager?: MemoryManager;
  createSubagentToolManager?: (params: {
    run: Run;
    parentContext: ToolExecutionContext;
  }) => ToolManager;
  maxSteps?: number;
}

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

const taskSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().min(1).optional(),
    prompt: z.string().min(1).optional(),
    system_prompt: z.string().min(1).max(8_000).optional(),
    profile: z.string().min(1).optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    agent_overrides: subAgentOverridesSchema.optional(),
    wait: z.boolean().optional(),
    poll_interval_ms: z.number().int().min(100).max(5_000).optional(),
    dedupe_window_ms: z.number().int().min(0).max(3_600_000).optional(),
    force_new: z.boolean().optional(),
    include_events: z.boolean().optional(),
    events_after_seq: z.number().int().min(0).optional(),
    events_limit: z.number().int().min(1).max(1_000).optional(),
  })
  .strict();

const tasksSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            key: z.string().min(1).max(80).optional(),
            title: z.string().min(1).max(200).optional(),
            description: z.string().min(1).optional(),
            prompt: z.string().min(1).optional(),
            system_prompt: z.string().min(1).max(8_000).optional(),
            profile: z.string().min(1).optional(),
            priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
            depends_on: z.array(z.string().min(1).max(80)).max(100).optional(),
            agent_overrides: subAgentOverridesSchema.optional(),
          })
          .strict()
      )
      .min(1)
      .max(100),
    max_parallel: z.number().int().min(1).max(50).optional(),
    wait: z.boolean().optional(),
    poll_interval_ms: z.number().int().min(100).max(5_000).optional(),
    dedupe_window_ms: z.number().int().min(0).max(3_600_000).optional(),
    force_new: z.boolean().optional(),
    fail_fast: z.boolean().optional(),
    include_events: z.boolean().optional(),
    events_after_seq: z.number().int().min(0).optional(),
    events_limit: z.number().int().min(1).max(1_000).optional(),
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
    restart: z.boolean().default(false),
    prompt: z.string().min(1).optional(),
    system_prompt: z.string().min(1).max(8_000).optional(),
    profile: z.string().min(1).default('general-purpose'),
    agent_overrides: subAgentOverridesSchema.optional(),
    timeout_ms: z.number().int().min(1_000).max(3_600_000).optional(),
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

const ACTIVE_RUN_STATUSES: Run['status'][] = ['queued', 'running', 'cancel_requested'];

const REUSABLE_SUBMIT_RUN_STATUSES = new Set<Run['status']>([
  'queued',
  'running',
  'cancel_requested',
  'succeeded',
]);

const DEFAULT_TASK_PROFILE = 'general-purpose';
const DEFAULT_TASK_PRIORITY: TaskPriority = 'medium';
const DEFAULT_TASK_STATUS: Extract<TaskStatus, 'pending' | 'ready' | 'blocked'> = 'ready';
const DEFAULT_TASK_RUN_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TASK_TOOL_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TASK_WAIT = true;
const DEFAULT_TASK_WAIT_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TASK_POLL_INTERVAL_MS = 300;
const DEFAULT_TASK_DEDUPE_WINDOW_MS = 120_000;
const DEFAULT_TASK_FORCE_NEW = false;
const DEFAULT_TASK_INCLUDE_EVENTS = false;
const DEFAULT_TASK_EVENTS_AFTER_SEQ = 0;
const DEFAULT_TASK_EVENTS_LIMIT = 200;

const DEFAULT_TASKS_MAX_PARALLEL = 3;
const DEFAULT_TASKS_WAIT = true;
const DEFAULT_TASKS_WAIT_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_TASKS_POLL_INTERVAL_MS = 300;
const DEFAULT_TASKS_DEDUPE_WINDOW_MS = 120_000;
const DEFAULT_TASKS_FORCE_NEW = false;
const DEFAULT_TASKS_FAIL_FAST = false;
const DEFAULT_TASKS_INCLUDE_EVENTS = false;
const DEFAULT_TASKS_EVENTS_AFTER_SEQ = 0;
const DEFAULT_TASKS_EVENTS_LIMIT = 100;

interface NormalizedTaskInput {
  title: string;
  description: string;
  prompt: string;
  system_prompt?: string;
  profile: string;
  priority: TaskPriority;
  agent_overrides?: z.infer<typeof subAgentOverridesSchema>;
  timeout_ms: number;
  wait: boolean;
  wait_timeout_ms: number;
  poll_interval_ms: number;
  dedupe_window_ms: number;
  force_new: boolean;
  include_events: boolean;
  events_after_seq: number;
  events_limit: number;
}

interface NormalizedTasksItem {
  key: string;
  title: string;
  description: string;
  prompt: string;
  system_prompt?: string;
  profile: string;
  priority: TaskPriority;
  depends_on: string[];
  agent_overrides?: z.infer<typeof subAgentOverridesSchema>;
  timeout_ms: number;
}

interface NormalizedTasksInput {
  items: NormalizedTasksItem[];
  max_parallel: number;
  wait: boolean;
  wait_timeout_ms: number;
  poll_interval_ms: number;
  dedupe_window_ms: number;
  force_new: boolean;
  fail_fast: boolean;
  include_events: boolean;
  events_after_seq: number;
  events_limit: number;
}

function resolveRuntime(options: TaskV3SharedOptions = {}): TaskV3Runtime {
  if (options.runtime) {
    return options.runtime;
  }
  return getDefaultTaskV3Runtime(options);
}

function resolveSessionId(runtime: TaskV3Runtime, context: ToolExecutionContext): string {
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

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function parseIsoMs(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstNonEmpty(values: Array<string | undefined>): string | undefined {
  for (const raw of values) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
}

function buildAutoTitle(text: string): string {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  if (singleLine.length === 0) {
    return 'Delegated Task';
  }
  return singleLine.slice(0, 120);
}

function normalizeSingleTaskInput(raw: z.infer<typeof taskSchema>): NormalizedTaskInput {
  const prompt = firstNonEmpty([raw.prompt, raw.description, raw.title]);
  if (!prompt) {
    throw new TaskV3Error(
      'INVALID_ARGUMENT',
      'task requires at least one of: prompt, description, or title'
    );
  }

  const description = firstNonEmpty([raw.description, prompt]) ?? prompt;
  const title = firstNonEmpty([raw.title]) ?? buildAutoTitle(description);

  return {
    title,
    description,
    prompt,
    system_prompt: firstNonEmpty([raw.system_prompt]),
    profile: firstNonEmpty([raw.profile]) ?? DEFAULT_TASK_PROFILE,
    priority: raw.priority ?? DEFAULT_TASK_PRIORITY,
    agent_overrides: raw.agent_overrides,
    timeout_ms: DEFAULT_TASK_RUN_TIMEOUT_MS,
    wait: raw.wait ?? DEFAULT_TASK_WAIT,
    wait_timeout_ms: DEFAULT_TASK_WAIT_TIMEOUT_MS,
    poll_interval_ms: raw.poll_interval_ms ?? DEFAULT_TASK_POLL_INTERVAL_MS,
    dedupe_window_ms: raw.dedupe_window_ms ?? DEFAULT_TASK_DEDUPE_WINDOW_MS,
    force_new: raw.force_new ?? DEFAULT_TASK_FORCE_NEW,
    include_events: raw.include_events ?? DEFAULT_TASK_INCLUDE_EVENTS,
    events_after_seq: raw.events_after_seq ?? DEFAULT_TASK_EVENTS_AFTER_SEQ,
    events_limit: raw.events_limit ?? DEFAULT_TASK_EVENTS_LIMIT,
  };
}

function normalizeTasksInput(raw: z.infer<typeof tasksSchema>): NormalizedTasksInput {
  const normalizedItems = raw.items.map((item, index) => {
    const prompt = firstNonEmpty([item.prompt, item.description, item.title]);
    if (!prompt) {
      throw new TaskV3Error(
        'INVALID_ARGUMENT',
        'each tasks item requires at least one of: prompt, description, or title',
        { index }
      );
    }

    const description = firstNonEmpty([item.description, prompt]) ?? prompt;
    const title = firstNonEmpty([item.title]) ?? buildAutoTitle(description);
    const key = firstNonEmpty([item.key]) ?? `item_${index + 1}`;
    const dependsOn = Array.from(
      new Set((item.depends_on ?? []).map((dep) => dep.trim()).filter((dep) => dep.length > 0))
    );

    return {
      key,
      title,
      description,
      prompt,
      system_prompt: firstNonEmpty([item.system_prompt]),
      profile: firstNonEmpty([item.profile]) ?? DEFAULT_TASK_PROFILE,
      priority: item.priority ?? DEFAULT_TASK_PRIORITY,
      depends_on: dependsOn,
      agent_overrides: item.agent_overrides,
      timeout_ms: DEFAULT_TASK_RUN_TIMEOUT_MS,
    } satisfies NormalizedTasksItem;
  });

  const keySet = new Set(normalizedItems.map((item) => item.key));
  const titleToKey = new Map(
    normalizedItems.map((item) => [normalizeText(item.title), item.key] as const)
  );
  const itemsWithResolvedDeps = normalizedItems.map((item) => ({
    ...item,
    depends_on: item.depends_on.map((dep) => {
      if (keySet.has(dep)) return dep;
      const byTitle = titleToKey.get(normalizeText(dep));
      return byTitle ?? dep;
    }),
  }));

  return {
    items: itemsWithResolvedDeps,
    max_parallel: raw.max_parallel ?? DEFAULT_TASKS_MAX_PARALLEL,
    wait: raw.wait ?? DEFAULT_TASKS_WAIT,
    wait_timeout_ms: DEFAULT_TASKS_WAIT_TIMEOUT_MS,
    poll_interval_ms: raw.poll_interval_ms ?? DEFAULT_TASKS_POLL_INTERVAL_MS,
    dedupe_window_ms: raw.dedupe_window_ms ?? DEFAULT_TASKS_DEDUPE_WINDOW_MS,
    force_new: raw.force_new ?? DEFAULT_TASKS_FORCE_NEW,
    fail_fast: raw.fail_fast ?? DEFAULT_TASKS_FAIL_FAST,
    include_events: raw.include_events ?? DEFAULT_TASKS_INCLUDE_EVENTS,
    events_after_seq: raw.events_after_seq ?? DEFAULT_TASKS_EVENTS_AFTER_SEQ,
    events_limit: raw.events_limit ?? DEFAULT_TASKS_EVENTS_LIMIT,
  };
}

function isTaskTerminal(status: TaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function isRunTerminal(status: Run['status']): boolean {
  return (
    status === 'succeeded' || status === 'failed' || status === 'cancelled' || status === 'timeout'
  );
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

function resolveProvider(
  options: TaskV3ToolOptions,
  context: ToolExecutionContext
): LLMProvider | null {
  if (options.provider) {
    return options.provider;
  }
  const carrier = context.agent as unknown as AgentConfigCarrier;
  return carrier.config?.provider ?? null;
}

function resolveMemoryManager(
  options: TaskV3ToolOptions,
  context: ToolExecutionContext
): MemoryManager | undefined {
  if (options.memoryManager) {
    return options.memoryManager;
  }
  const carrier = context.agent as unknown as AgentConfigCarrier;
  return carrier.config?.memoryManager;
}

function resolveAgentConfig(args: {
  profile: string;
  system_prompt?: string;
  agent_overrides?: z.infer<typeof subAgentOverridesSchema>;
  timeout_ms?: number;
}): SubAgentConfigSnapshot {
  const profileId = args.profile.trim();
  const profile = getSubAgentProfile(profileId);
  if (!profile) {
    throw new TaskV3Error('INVALID_ARGUMENT', `unknown agent profile: ${profileId}`, {
      profile,
      agent_profile_id: profileId,
    });
  }

  const overrides = toProfileOverrides(args.agent_overrides);
  const overrideSystemPrompt = overrides?.systemPrompt;
  const baseOverrides: SubAgentProfileOverrides | undefined = overrides
    ? { ...overrides, systemPrompt: undefined }
    : undefined;

  const snapshot = resolveSubAgentConfigSnapshot({
    profile,
    overrides: baseOverrides,
    timeoutMs: args.timeout_ms,
  });

  const promptParts = [snapshot.systemPrompt, args.system_prompt, overrideSystemPrompt]
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0);
  const dedupedPromptParts = Array.from(new Set(promptParts));
  snapshot.systemPrompt = dedupedPromptParts.join('\n\n');
  return snapshot;
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

function failureResult(error: unknown): ToolResult {
  if (error instanceof TaskV3Error) {
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

function isProfileCompatibleRun(run: Run, profile: string): boolean {
  const normalizedProfile = normalizeText(profile);
  const runProfile = normalizeText(run.agentProfileId ?? run.agentType);
  return runProfile === normalizedProfile;
}

async function findRecentTaskMatch(params: {
  runtime: TaskV3Runtime;
  sessionId: string;
  title: string;
  description: string;
  prompt: string;
  systemPrompt?: string;
  profile: string;
  priority: TaskPriority;
  dedupeWindowMs: number;
  forceNew: boolean;
}): Promise<{ task: Task; run?: Run } | null> {
  const {
    runtime,
    sessionId,
    title,
    description,
    prompt,
    systemPrompt,
    profile,
    priority,
    dedupeWindowMs,
    forceNew,
  } = params;
  if (dedupeWindowMs <= 0 || forceNew) {
    return null;
  }

  const nowMs = Date.now();
  const cutoffMs = nowMs - dedupeWindowMs;
  const normalizedTitle = normalizeText(title);
  const normalizedDescription = normalizeText(description);
  const normalizedPrompt = normalizeText(prompt);
  const normalizedSystemPrompt =
    typeof systemPrompt === 'string' && systemPrompt.trim().length > 0
      ? normalizeText(systemPrompt)
      : '';
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
    if (!run.taskId) continue;
    if (parseIsoMs(run.createdAt) < cutoffMs) continue;
    if (!REUSABLE_SUBMIT_RUN_STATUSES.has(run.status)) continue;
    if (!isProfileCompatibleRun(run, profile)) continue;
    if (normalizedSystemPrompt.length > 0) {
      const runSystemPrompt = normalizeText(run.agentConfigSnapshot?.systemPrompt ?? '');
      if (!runSystemPrompt.includes(normalizedSystemPrompt)) continue;
    }
    const snapshot = parseInputSnapshot(run.inputSnapshot);
    const runPrompt = typeof snapshot.prompt === 'string' ? normalizeText(snapshot.prompt) : '';
    if (runPrompt !== normalizedPrompt) continue;

    const task = await getTaskCached(run.taskId);
    if (!task) continue;
    if (task.priority !== priority) continue;
    if (normalizeText(task.title) !== normalizedTitle) continue;
    if (normalizeText(task.description) !== normalizedDescription) continue;
    return { task, run };
  }

  return null;
}

function buildRunAdapter(params: {
  options: TaskV3ToolOptions;
  context: ToolExecutionContext;
  profile: string;
  systemPrompt?: string;
  taskId?: TaskId;
  prompt?: string;
  agentOverrides?: z.infer<typeof subAgentOverridesSchema>;
  timeoutMs?: number;
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
  const provider = resolveProvider(params.options, params.context);
  if (!provider) {
    return null;
  }

  const agentConfig = resolveAgentConfig({
    profile: params.profile,
    system_prompt: params.systemPrompt,
    agent_overrides: params.agentOverrides,
    timeout_ms: params.timeoutMs,
  });

  const memoryManager = resolveMemoryManager(params.options, params.context);

  const adapter = createAgentRunExecutionAdapter({
    provider,
    memoryManager,
    maxSteps: params.options.maxSteps ?? agentConfig.maxSteps,
    createToolManager: (run) =>
      applyToolPolicy(
        params.options.createSubagentToolManager?.({ run, parentContext: params.context }) ??
          new ToolManager(),
        agentConfig
      ),
  });

  return {
    input: {
      taskId: params.taskId,
      prompt: params.prompt,
      agentType: params.profile,
      agentProfileId: agentConfig.profileId,
      agentConfigSnapshot: agentConfig,
      timeoutMs: agentConfig.timeoutMs,
    },
    adapter,
  };
}

async function maybeWithEvents(params: {
  runtime: TaskV3Runtime;
  sessionId: string;
  run: Run;
  includeEvents: boolean;
  afterSeq: number;
  limit: number;
}): Promise<Record<string, unknown>> {
  if (!params.includeEvents) {
    return {};
  }

  const events = await params.runtime.service.listRunEvents(params.sessionId, params.run.id, {
    afterSeq: params.afterSeq,
    limit: params.limit,
  });

  return {
    event_count: events.length,
    next_after_seq: events.length > 0 ? events[events.length - 1].seq : params.afterSeq,
    events: events.map((event) => ({
      run_id: event.runId,
      seq: event.seq,
      type: event.type,
      payload: event.payload,
      created_at: event.createdAt,
    })),
  };
}

export class TaskV3Tool extends BaseTool<typeof taskSchema> {
  protected timeout = DEFAULT_TASK_TOOL_TIMEOUT_MS;
  private readonly runtime: TaskV3Runtime;
  private readonly options: TaskV3ToolOptions;

  constructor(options: TaskV3ToolOptions = {}) {
    super();
    this.options = options;
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task',
      description:
        "Delegate a single sub-agent task. Use this for one clear objective (analysis, bug triage, exploration, planning, or focused coding). Minimal input can be description-only or prompt-only; title/profile are optional and auto-derived. Optional system_prompt is appended to the selected profile's system prompt. Timeout controls are intentionally not exposed in this tool; runtime uses a very large internal timeout and relies on agent-level timeout policy. If wait=true (default), this call blocks; if wait=false, it returns immediately with task/run IDs for async polling via task_run_get/task_run_wait/task_run_events.",
      parameters: taskSchema,
    } as const;
  }

  async execute(args: z.infer<typeof taskSchema>, context: ToolExecutionContext) {
    try {
      await this.runtime.prepare();
      const sessionId = resolveSessionId(this.runtime, context);
      const input = normalizeSingleTaskInput(args);

      const match = await findRecentTaskMatch({
        runtime: this.runtime,
        sessionId,
        title: input.title,
        description: input.description,
        prompt: input.prompt,
        systemPrompt: input.system_prompt,
        profile: input.profile,
        priority: input.priority,
        dedupeWindowMs: input.dedupe_window_ms,
        forceNew: input.force_new,
      });

      const task =
        match?.task ??
        (await this.runtime.service.createTask(
          sessionId,
          {
            title: input.title,
            description: input.description,
            priority: input.priority,
            status: DEFAULT_TASK_STATUS,
          },
          createTaskId()
        ));

      const run =
        match?.run ??
        (await (async () => {
          const runAdapter = buildRunAdapter({
            options: this.options,
            context,
            profile: input.profile,
            systemPrompt: input.system_prompt,
            taskId: task.id,
            prompt: input.prompt,
            agentOverrides: input.agent_overrides,
            timeoutMs: input.timeout_ms,
          });
          if (!runAdapter) {
            throw new TaskV3Error(
              'TASK_PROVIDER_MISSING',
              'task requires provider on parent agent or tool option'
            );
          }
          return this.runtime.service.startRun(
            sessionId,
            createRunId(),
            runAdapter.input,
            runAdapter.adapter
          );
        })());

      if (!input.wait) {
        return this.success({
          task: formatTask(task),
          run: formatRun(run),
          waited: false,
          deduplicated: Boolean(match),
        });
      }

      const waited = await this.runtime.service.waitRun(sessionId, run.id, {
        timeoutMs: input.wait_timeout_ms,
        pollIntervalMs: input.poll_interval_ms,
      });

      return this.success({
        task: formatTask(await this.runtime.service.getTask(sessionId, task.id)),
        run: formatRun(waited),
        waited: true,
        timed_out: !isRunTerminal(waited.status),
        deduplicated: Boolean(match),
        ...(await maybeWithEvents({
          runtime: this.runtime,
          sessionId,
          run: waited,
          includeEvents: input.include_events,
          afterSeq: input.events_after_seq,
          limit: input.events_limit,
        })),
      });
    } catch (error) {
      return failureResult(error);
    }
  }
}

export class TaskV3TasksTool extends BaseTool<typeof tasksSchema> {
  protected timeout = DEFAULT_TASK_TOOL_TIMEOUT_MS;
  private readonly runtime: TaskV3Runtime;
  private readonly options: TaskV3ToolOptions;

  constructor(options: TaskV3ToolOptions = {}) {
    super();
    this.options = options;
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'tasks',
      description:
        "Delegate and orchestrate multiple sub-agent tasks in one call. Use this for parallel work or dependency-aware workflows. Provide items[] with optional key/depends_on; missing key/title/profile are auto-derived. Each item can set system_prompt, which is appended to that item's profile system prompt. The tool handles scheduling with max_parallel, dependency promotion, and optional fail_fast behavior. Timeout controls are intentionally not exposed in this tool; runtime uses a very large internal timeout and relies on agent-level timeout policy. If wait=true (default), it runs orchestration rounds; if wait=false, it dispatches an initial round and returns task/run IDs for follow-up polling.",
      parameters: tasksSchema,
    } as const;
  }

  async execute(args: z.infer<typeof tasksSchema>, context: ToolExecutionContext) {
    try {
      await this.runtime.prepare();
      const sessionId = resolveSessionId(this.runtime, context);
      const input = normalizeTasksInput(args);

      const keyToTaskId = new Map<string, TaskId>();
      const keyToRunId = new Map<string, RunId>();
      const keyToSpec = new Map<string, (typeof input.items)[number]>();
      const duplicateKeys = new Set<string>();

      for (const item of input.items) {
        if (keyToSpec.has(item.key)) {
          duplicateKeys.add(item.key);
        }
        keyToSpec.set(item.key, item);
      }

      if (duplicateKeys.size > 0) {
        throw new TaskV3Error('INVALID_ARGUMENT', 'tasks contains duplicate keys', {
          duplicate_keys: Array.from(duplicateKeys),
        });
      }

      for (const item of input.items) {
        for (const depKey of item.depends_on) {
          if (!keyToSpec.has(depKey)) {
            throw new TaskV3Error('INVALID_ARGUMENT', 'depends_on references unknown key', {
              key: item.key,
              depends_on: depKey,
            });
          }
        }
      }

      for (const item of input.items) {
        const match = await findRecentTaskMatch({
          runtime: this.runtime,
          sessionId,
          title: item.title,
          description: item.description,
          prompt: item.prompt,
          systemPrompt: item.system_prompt,
          profile: item.profile,
          priority: item.priority,
          dedupeWindowMs: input.dedupe_window_ms,
          forceNew: input.force_new,
        });

        const status: Extract<TaskStatus, 'pending' | 'blocked'> =
          item.depends_on.length > 0 ? 'blocked' : 'pending';

        const task =
          match?.task ??
          (await this.runtime.service.createTask(
            sessionId,
            {
              title: item.title,
              description: item.description,
              priority: item.priority,
              status,
            },
            createTaskId()
          ));

        keyToTaskId.set(item.key, task.id);
        if (match?.run) {
          keyToRunId.set(item.key, match.run.id);
        }
      }

      for (const item of input.items) {
        const taskId = keyToTaskId.get(item.key);
        if (!taskId) continue;
        for (const depKey of item.depends_on) {
          const depTaskId = keyToTaskId.get(depKey);
          if (!depTaskId) continue;
          await this.runtime.service.addDependency(sessionId, taskId, depTaskId);
        }
      }

      const deadline = Date.now() + input.wait_timeout_ms;
      const startedRunIds = new Set<RunId>(Array.from(keyToRunId.values()));
      const allBatchTaskIds = Array.from(keyToTaskId.values());
      let terminatedByFailFast = false;

      const dispatchRound = async (): Promise<number> => {
        const tasks = await Promise.all(
          allBatchTaskIds.map((taskId) => this.runtime.service.getTask(sessionId, taskId))
        );
        const deps = await this.runtime.service.listDependencies(sessionId);
        const depsByTask = new Map<TaskId, TaskId[]>();
        for (const edge of deps) {
          const list = depsByTask.get(edge.taskId) ?? [];
          list.push(edge.dependsOnTaskId);
          depsByTask.set(edge.taskId, list);
        }

        const taskById = new Map<TaskId, Task>(tasks.map((task) => [task.id, task]));

        const depsCompleted = (taskId: TaskId): boolean => {
          const required = depsByTask.get(taskId) ?? [];
          return required.every((depId) => taskById.get(depId)?.status === 'completed');
        };

        for (const task of tasks) {
          if ((task.status === 'pending' || task.status === 'blocked') && depsCompleted(task.id)) {
            const updated = await this.runtime.service.updateTask(sessionId, task.id, {
              status: 'ready',
              expectedVersion: task.version,
            });
            taskById.set(updated.id, updated);
          }
        }

        const activeCount = await Promise.all(
          allBatchTaskIds.map(async (taskId) => {
            const runs = await this.runtime.service.listRuns(sessionId, { taskId, limit: 20 });
            return runs.some((run) => ACTIVE_RUN_STATUSES.includes(run.status));
          })
        ).then((rows) => rows.filter(Boolean).length);

        const availableSlots = Math.max(0, input.max_parallel - activeCount);
        if (availableSlots <= 0) {
          return 0;
        }

        let dispatched = 0;
        for (const item of input.items) {
          if (dispatched >= availableSlots) {
            break;
          }
          const taskId = keyToTaskId.get(item.key);
          if (!taskId) {
            continue;
          }

          const task = await this.runtime.service.getTask(sessionId, taskId);
          if (task.status !== 'ready') {
            continue;
          }

          const runs = await this.runtime.service.listRuns(sessionId, { taskId, limit: 20 });
          const hasActiveRun = runs.some((run) => ACTIVE_RUN_STATUSES.includes(run.status));
          if (hasActiveRun) {
            continue;
          }

          const runAdapter = buildRunAdapter({
            options: this.options,
            context,
            profile: item.profile,
            systemPrompt: item.system_prompt,
            taskId,
            prompt: item.prompt,
            agentOverrides: item.agent_overrides,
            timeoutMs: item.timeout_ms,
          });

          if (!runAdapter) {
            throw new TaskV3Error(
              'TASK_PROVIDER_MISSING',
              'tasks requires provider on parent agent or tool option'
            );
          }

          const run = await this.runtime.service.startRun(
            sessionId,
            createRunId(),
            runAdapter.input,
            runAdapter.adapter
          );
          keyToRunId.set(item.key, run.id);
          startedRunIds.add(run.id);
          dispatched += 1;
        }

        return dispatched;
      };

      // Always do one scheduling round even when wait=false
      await dispatchRound();

      if (input.wait) {
        while (Date.now() < deadline) {
          const currentTasks = await Promise.all(
            allBatchTaskIds.map(async (taskId) => this.runtime.service.getTask(sessionId, taskId))
          );

          const completed = currentTasks.filter((task) => isTaskTerminal(task.status));
          if (completed.length === allBatchTaskIds.length) {
            break;
          }

          if (
            input.fail_fast &&
            currentTasks.some((task) => task.status === 'failed' || task.status === 'cancelled')
          ) {
            terminatedByFailFast = true;

            for (const runId of startedRunIds) {
              await this.runtime.service.cancelRun(sessionId, runId).catch(() => undefined);
            }

            for (const task of currentTasks) {
              if (isTaskTerminal(task.status) || task.status === 'running') {
                continue;
              }
              await this.runtime.service
                .updateTask(sessionId, task.id, {
                  status: 'cancelled',
                  expectedVersion: task.version,
                })
                .catch(() => undefined);
            }
            break;
          }

          await dispatchRound();
          await new Promise((resolve) => setTimeout(resolve, input.poll_interval_ms));
        }
      }

      const finalTasks = await Promise.all(
        allBatchTaskIds.map((taskId) => this.runtime.service.getTask(sessionId, taskId))
      );
      const itemResults = await Promise.all(
        input.items.map(async (item) => {
          const taskId = keyToTaskId.get(item.key);
          const runId = keyToRunId.get(item.key);
          const task = taskId ? await this.runtime.service.getTask(sessionId, taskId) : null;
          const run = runId ? await this.runtime.service.getRun(sessionId, runId) : null;

          let events: Array<Record<string, unknown>> | undefined;
          let nextAfterSeq: number | undefined;
          if (input.include_events && run) {
            const runEvents = await this.runtime.service.listRunEvents(sessionId, run.id, {
              afterSeq: input.events_after_seq,
              limit: input.events_limit,
            });
            events = runEvents.map((event) => ({
              run_id: event.runId,
              seq: event.seq,
              type: event.type,
              payload: event.payload,
              created_at: event.createdAt,
            }));
            nextAfterSeq =
              runEvents.length > 0 ? runEvents[runEvents.length - 1].seq : input.events_after_seq;
          }

          return {
            key: item.key,
            task: task ? formatTask(task) : null,
            run: run ? formatRun(run) : null,
            event_count: events ? events.length : undefined,
            next_after_seq: nextAfterSeq,
            events,
          };
        })
      );

      const terminalCount = finalTasks.filter((task) => isTaskTerminal(task.status)).length;

      return this.success({
        wait: input.wait,
        wait_timeout_reached: input.wait ? terminalCount !== finalTasks.length : false,
        terminated_by_fail_fast: terminatedByFailFast,
        total_tasks: finalTasks.length,
        terminal_tasks: terminalCount,
        started_runs: Array.from(startedRunIds),
        items: itemResults,
      });
    } catch (error) {
      return failureResult(error);
    }
  }
}

export class TaskV3GetTool extends BaseTool<typeof taskGetSchema> {
  private readonly runtime: TaskV3Runtime;

  constructor(options: TaskV3SharedOptions = {}) {
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

export class TaskV3ListTool extends BaseTool<typeof taskListSchema> {
  private readonly runtime: TaskV3Runtime;

  constructor(options: TaskV3SharedOptions = {}) {
    super();
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_list',
      description: 'List tasks in current session.',
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

export class TaskV3UpdateTool extends BaseTool<typeof taskUpdateSchema> {
  protected timeout = DEFAULT_TASK_TOOL_TIMEOUT_MS;
  private readonly runtime: TaskV3Runtime;
  private readonly options: TaskV3ToolOptions;

  constructor(options: TaskV3ToolOptions = {}) {
    super();
    this.options = options;
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_update',
      description:
        'Update task metadata/status. Optional restart=true starts a new run revision for the same task.',
      parameters: taskUpdateSchema,
    } as const;
  }

  async execute(args: z.infer<typeof taskUpdateSchema>, context: ToolExecutionContext) {
    try {
      await this.runtime.prepare();
      const sessionId = resolveSessionId(this.runtime, context);
      const taskId = ensureTaskId(args.task_id);

      const updated = await this.runtime.service.updateTask(sessionId, taskId, {
        title: args.title,
        description: args.description,
        priority: args.priority,
        status: args.status,
        expectedVersion: args.expected_version,
      });

      if (!args.restart) {
        return this.success({
          task: formatTask(updated),
          restarted: false,
        });
      }

      const runs = await this.runtime.service.listRuns(sessionId, { taskId, limit: 30 });
      for (const run of runs) {
        if (ACTIVE_RUN_STATUSES.includes(run.status)) {
          await this.runtime.service.cancelRun(sessionId, run.id);
        }
      }

      const runAdapter = buildRunAdapter({
        options: this.options,
        context,
        profile: args.profile,
        systemPrompt: args.system_prompt,
        taskId,
        prompt: args.prompt,
        agentOverrides: args.agent_overrides,
        timeoutMs: args.timeout_ms,
      });

      if (!runAdapter) {
        return this.failure('TASK_PROVIDER_MISSING: task_update(restart=true) requires provider');
      }

      const started = await this.runtime.service.startRun(
        sessionId,
        createRunId(),
        runAdapter.input,
        runAdapter.adapter
      );

      if (!args.wait) {
        return this.success({
          task: formatTask(await this.runtime.service.getTask(sessionId, taskId)),
          restarted: true,
          run: formatRun(started),
          waited: false,
        });
      }

      const waited = await this.runtime.service.waitRun(sessionId, started.id, {
        timeoutMs: args.wait_timeout_ms,
        pollIntervalMs: args.poll_interval_ms,
      });

      return this.success({
        task: formatTask(await this.runtime.service.getTask(sessionId, taskId)),
        restarted: true,
        run: formatRun(waited),
        waited: true,
        timed_out: !isRunTerminal(waited.status),
        ...(await maybeWithEvents({
          runtime: this.runtime,
          sessionId,
          run: waited,
          includeEvents: args.include_events,
          afterSeq: args.events_after_seq,
          limit: args.events_limit,
        })),
      });
    } catch (error) {
      return failureResult(error);
    }
  }
}

export class TaskV3RunGetTool extends BaseTool<typeof taskRunGetSchema> {
  private readonly runtime: TaskV3Runtime;

  constructor(options: TaskV3SharedOptions = {}) {
    super();
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_run_get',
      description: 'Get run details by run_id in current session.',
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

export class TaskV3RunWaitTool extends BaseTool<typeof taskRunWaitSchema> {
  protected timeout = DEFAULT_TASK_TOOL_TIMEOUT_MS;
  private readonly runtime: TaskV3Runtime;

  constructor(options: TaskV3SharedOptions = {}) {
    super();
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_run_wait',
      description: 'Wait until run terminal status or timeout.',
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
        timed_out: !isRunTerminal(run.status),
      });
    } catch (error) {
      return failureResult(error);
    }
  }
}

export class TaskV3RunCancelTool extends BaseTool<typeof taskRunCancelSchema> {
  private readonly runtime: TaskV3Runtime;

  constructor(options: TaskV3SharedOptions = {}) {
    super();
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_run_cancel',
      description: 'Request run cancellation in current session.',
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

export class TaskV3RunEventsTool extends BaseTool<typeof taskRunEventsSchema> {
  private readonly runtime: TaskV3Runtime;

  constructor(options: TaskV3SharedOptions = {}) {
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

export class TaskV3ClearSessionTool extends BaseTool<typeof taskClearSessionSchema> {
  private readonly runtime: TaskV3Runtime;

  constructor(options: TaskV3SharedOptions = {}) {
    super();
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_clear_session',
      description: 'Clear v3 tasks/runs for current session only.',
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

export class TaskV3GcRunsTool extends BaseTool<typeof taskGcRunsSchema> {
  private readonly runtime: TaskV3Runtime;

  constructor(options: TaskV3SharedOptions = {}) {
    super();
    this.runtime = resolveRuntime(options);
  }

  get meta() {
    return {
      name: 'task_gc_runs',
      description: 'Garbage collect finished v3 runs older than threshold.',
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
  TaskV3Runtime,
  getDefaultTaskV3Runtime,
  type TaskV3RuntimeOptions,
  type TaskV3SharedOptions,
};

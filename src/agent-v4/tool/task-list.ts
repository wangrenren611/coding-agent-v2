import { z } from 'zod';
import { BaseTool, type ToolResult } from './base-tool';
import { buildTaskSuccess } from './task-errors';
import { getTaskStore, type TaskStore } from './task-store';
import { safeJsonClone, type TaskEntity, type TaskPriority, type TaskStatus } from './task-types';
import { TASK_LIST_DESCRIPTION } from './tool-prompts';

const schema = z
  .object({
    namespace: z.string().min(1).optional().describe('Optional task namespace'),
    statuses: z
      .array(z.enum(['pending', 'in_progress', 'completed', 'cancelled', 'failed']))
      .optional()
      .describe('Optional status filter'),
    owner: z.string().min(1).optional().describe('Optional owner filter'),
    tag: z.string().min(1).optional().describe('Optional tag-name filter'),
    include_history: z.boolean().optional().describe('Include history for each returned task'),
  })
  .strict();

type TaskListArgs = z.infer<typeof schema>;

export interface TaskListToolOptions {
  store?: TaskStore;
  defaultNamespace?: string;
}

interface TaskSummary {
  id: string;
  subject: string;
  status: TaskStatus;
  priority: TaskPriority;
  owner: string | null;
  blocked_by: string[];
  blocks: string[];
  progress: number;
  is_blocked: boolean;
  can_be_claimed: boolean;
  created_at: number;
  updated_at: number;
  history?: unknown;
}

function computeSummary(task: TaskEntity, taskMap: Record<string, TaskEntity>): TaskSummary {
  const blockedByCount = task.blockedBy.filter((blockerId) => {
    const blocker = taskMap[blockerId];
    return !blocker || blocker.status !== 'completed';
  }).length;
  return {
    id: task.id,
    subject: task.subject,
    status: task.status,
    priority: task.priority,
    owner: task.owner,
    blocked_by: safeJsonClone(task.blockedBy),
    blocks: safeJsonClone(task.blocks),
    progress: task.progress,
    is_blocked: blockedByCount > 0,
    can_be_claimed: task.status === 'pending' && blockedByCount === 0 && !task.owner,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
  };
}

function rankTask(summary: TaskSummary): number {
  if (summary.can_be_claimed && summary.priority === 'critical') return 0;
  if (summary.status === 'in_progress') return 1;
  if (summary.can_be_claimed && summary.priority === 'high') return 2;
  if (summary.can_be_claimed && summary.priority === 'normal') return 3;
  if (summary.can_be_claimed && summary.priority === 'low') return 4;
  if (summary.is_blocked) return 5;
  if (summary.status === 'completed') return 6;
  if (summary.status === 'cancelled' || summary.status === 'failed') return 7;
  return 8;
}

export class TaskListTool extends BaseTool<typeof schema> {
  name = 'task_list';
  description = TASK_LIST_DESCRIPTION;
  parameters = schema;

  private readonly store: TaskStore;
  private readonly defaultNamespace?: string;

  constructor(options: TaskListToolOptions = {}) {
    super();
    this.store = options.store || getTaskStore();
    this.defaultNamespace = options.defaultNamespace;
  }

  override getConcurrencyMode(): 'parallel-safe' {
    return 'parallel-safe';
  }

  override getConcurrencyLockKey(args: TaskListArgs): string {
    const namespace = args.namespace || this.defaultNamespace || 'default';
    return `taskns:${namespace}:list`;
  }

  async execute(args: TaskListArgs): Promise<ToolResult> {
    const namespace = args.namespace || this.defaultNamespace;
    const normalizedNamespace = this.store.normalizeNamespace(namespace);
    const state = await this.store.getState(normalizedNamespace);
    const tasks = Object.values(state.tasks);

    let filtered = tasks;
    if (args.statuses && args.statuses.length > 0) {
      const statusSet = new Set(args.statuses);
      filtered = filtered.filter((task) => statusSet.has(task.status));
    }
    if (args.owner) {
      filtered = filtered.filter((task) => task.owner === args.owner);
    }
    if (args.tag) {
      filtered = filtered.filter((task) => task.tags.some((tag) => tag.name === args.tag));
    }

    const summaries = filtered.map((task) => {
      const summary = computeSummary(task, state.tasks);
      if (args.include_history === true) {
        summary.history = safeJsonClone(task.history);
      }
      return summary;
    });

    summaries.sort((a, b) => {
      const rankDelta = rankTask(a) - rankTask(b);
      if (rankDelta !== 0) return rankDelta;
      if (a.created_at !== b.created_at) return a.created_at - b.created_at;
      return a.id.localeCompare(b.id);
    });

    return buildTaskSuccess({
      namespace: normalizedNamespace,
      total: summaries.length,
      tasks: summaries,
    });
  }
}

export default TaskListTool;

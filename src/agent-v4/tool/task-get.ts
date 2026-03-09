import { z } from 'zod';
import { BaseTool, type ToolResult } from './base-tool';
import { buildTaskFailure, buildTaskSuccess } from './task-errors';
import { getTaskStore, type TaskStore } from './task-store';
import { evaluateTaskCanStart, safeJsonClone, type TaskEntity } from './task-types';
import { TASK_GET_DESCRIPTION } from './tool-prompts';

const schema = z
  .object({
    namespace: z.string().min(1).optional().describe('Optional task namespace'),
    task_id: z.string().min(1).describe('Task identifier to retrieve'),
    include_history: z.boolean().optional().describe('Include full history entries when true'),
  })
  .strict();

type TaskGetArgs = z.infer<typeof schema>;

export interface TaskGetToolOptions {
  store?: TaskStore;
  defaultNamespace?: string;
}

function calculateCheckpointProgress(task: TaskEntity): number {
  if (!task.checkpoints || task.checkpoints.length === 0) {
    return 0;
  }
  const completedCount = task.checkpoints.filter((checkpoint) => checkpoint.completed).length;
  return Math.round((completedCount / task.checkpoints.length) * 100);
}

export class TaskGetTool extends BaseTool<typeof schema> {
  name = 'task_get';
  description = TASK_GET_DESCRIPTION;
  parameters = schema;

  private readonly store: TaskStore;
  private readonly defaultNamespace?: string;

  constructor(options: TaskGetToolOptions = {}) {
    super();
    this.store = options.store || getTaskStore();
    this.defaultNamespace = options.defaultNamespace;
  }

  override getConcurrencyMode(): 'parallel-safe' {
    return 'parallel-safe';
  }

  override getConcurrencyLockKey(args: TaskGetArgs): string {
    const namespace = args.namespace || this.defaultNamespace || 'default';
    return `taskns:${namespace}:task:${args.task_id}`;
  }

  async execute(args: TaskGetArgs): Promise<ToolResult> {
    const namespace = args.namespace || this.defaultNamespace;
    const normalizedNamespace = this.store.normalizeNamespace(namespace);
    const state = await this.store.getState(normalizedNamespace);

    const task = state.tasks[args.task_id];
    if (!task) {
      return buildTaskFailure('TASK_NOT_FOUND', `task not found: ${args.task_id}`, {
        namespace: normalizedNamespace,
        task_id: args.task_id,
      });
    }

    const blockers = task.blockedBy.map((blockerId) => {
      const blocker = state.tasks[blockerId];
      return blocker
        ? {
            id: blocker.id,
            subject: blocker.subject,
            status: blocker.status,
          }
        : {
            id: blockerId,
            subject: '(missing task)',
            status: 'missing',
          };
    });

    const blockedTasks = task.blocks.map((blockedTaskId) => {
      const blockedTask = state.tasks[blockedTaskId];
      return blockedTask
        ? {
            id: blockedTask.id,
            subject: blockedTask.subject,
            status: blockedTask.status,
          }
        : {
            id: blockedTaskId,
            subject: '(missing task)',
            status: 'missing',
          };
    });

    const checkpointProgress = calculateCheckpointProgress(task);
    const canStart = evaluateTaskCanStart(task, state.tasks);
    const detail = {
      ...safeJsonClone(task),
      blockers,
      blocked_tasks: blockedTasks,
      can_start: canStart,
      checkpoint_progress: checkpointProgress,
      effective_progress: Math.max(task.progress, checkpointProgress),
      history: args.include_history === true ? safeJsonClone(task.history) : undefined,
    };

    return buildTaskSuccess({
      namespace: normalizedNamespace,
      task: detail,
    });
  }
}

export default TaskGetTool;

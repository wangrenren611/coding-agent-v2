import { z } from 'zod';
import { BaseTool, type ToolResult } from './base-tool';
import { buildTaskFailure, buildTaskSuccess, parsePrefixedError } from './task-errors';
import { getTaskStore, type TaskStore } from './task-store';
import {
  evaluateTaskCanStart,
  isTaskTerminal,
  safeJsonClone,
  validateTaskTransition,
  type TaskHistoryEntry,
} from './task-types';
import {
  addDependencyEdge,
  ensureGraphNode,
  removeDependencyEdge,
  wouldCreateCycle,
} from './task-graph';
import { TASK_UPDATE_DESCRIPTION } from './tool-prompts';

const schema = z
  .object({
    namespace: z.string().min(1).optional().describe('Optional task namespace'),
    task_id: z.string().min(1).describe('Task identifier to update'),
    status: z
      .enum(['pending', 'in_progress', 'completed', 'cancelled', 'failed'])
      .optional()
      .describe('Optional task status update'),
    expected_version: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Optional optimistic lock version'),
    subject: z.string().min(3).optional().describe('Optional task title update'),
    description: z.string().min(10).optional().describe('Optional task description update'),
    active_form: z.string().min(1).optional().describe('Optional active-form text update'),
    priority: z
      .enum(['critical', 'high', 'normal', 'low'])
      .optional()
      .describe('Optional priority update'),
    owner: z
      .union([z.string().min(1), z.null()])
      .optional()
      .describe('Optional owner update (or null to clear)'),
    progress: z.number().int().min(0).max(100).optional().describe('Optional progress percentage'),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Optional metadata merge patch'),
    add_blocked_by: z
      .array(z.string().min(1))
      .optional()
      .describe('Dependency ids to add as blockers'),
    remove_blocked_by: z
      .array(z.string().min(1))
      .optional()
      .describe('Dependency ids to remove from blockers'),
    reason: z.string().optional().describe('Optional reason for update/audit trail'),
    updated_by: z.string().optional().describe('Optional actor identifier'),
  })
  .strict();

type TaskUpdateArgs = z.infer<typeof schema>;

export interface TaskUpdateToolOptions {
  store?: TaskStore;
  defaultNamespace?: string;
}

function pushUnique(items: string[], id: string): void {
  if (!items.includes(id)) {
    items.push(id);
  }
}

function removeItem(items: string[], id: string): void {
  const index = items.indexOf(id);
  if (index >= 0) {
    items.splice(index, 1);
  }
}

export class TaskUpdateTool extends BaseTool<typeof schema> {
  name = 'task_update';
  description = TASK_UPDATE_DESCRIPTION;
  parameters = schema;

  private readonly store: TaskStore;
  private readonly defaultNamespace?: string;

  constructor(options: TaskUpdateToolOptions = {}) {
    super();
    this.store = options.store || getTaskStore();
    this.defaultNamespace = options.defaultNamespace;
  }

  override getConcurrencyMode(): 'exclusive' {
    return 'exclusive';
  }

  override getConcurrencyLockKey(args: TaskUpdateArgs): string {
    const namespace = args.namespace || this.defaultNamespace || 'default';
    return `taskns:${namespace}`;
  }

  async execute(args: TaskUpdateArgs): Promise<ToolResult> {
    const namespace = args.namespace || this.defaultNamespace;

    const hasAnyChange =
      args.status !== undefined ||
      args.subject !== undefined ||
      args.description !== undefined ||
      args.active_form !== undefined ||
      args.priority !== undefined ||
      args.owner !== undefined ||
      args.progress !== undefined ||
      args.metadata !== undefined ||
      (args.add_blocked_by && args.add_blocked_by.length > 0) ||
      (args.remove_blocked_by && args.remove_blocked_by.length > 0);

    if (!hasAnyChange) {
      return buildTaskFailure('TASK_UPDATE_EMPTY', 'no update fields provided', {
        task_id: args.task_id,
      });
    }

    try {
      const updated = await this.store.updateState(namespace, (state) => {
        const task = state.tasks[args.task_id];
        if (!task) {
          throw new Error(`TASK_NOT_FOUND: task not found: ${args.task_id}`);
        }

        if (args.expected_version && task.version !== args.expected_version) {
          throw new Error(
            `TASK_VERSION_CONFLICT: expected ${args.expected_version}, actual ${task.version}`
          );
        }

        const previousStatus = task.status;
        const previousOwner = task.owner;
        const now = Date.now();

        if (isTaskTerminal(task.status)) {
          throw new Error(`TASK_TERMINAL_IMMUTABLE: task is terminal (${task.status})`);
        }

        if (args.status && !validateTaskTransition(task.status, args.status)) {
          throw new Error(
            `TASK_INVALID_STATUS_TRANSITION: invalid transition ${task.status} -> ${args.status}`
          );
        }

        const historyEntries: TaskHistoryEntry[] = [];

        if (args.add_blocked_by && args.add_blocked_by.length > 0) {
          for (const blockerId of args.add_blocked_by) {
            const blocker = state.tasks[blockerId];
            if (!blocker) {
              throw new Error(`TASK_NOT_FOUND: blocker task not found: ${blockerId}`);
            }
            if (blockerId === task.id) {
              throw new Error('TASK_CYCLE_DEPENDENCY: task cannot depend on itself');
            }
            ensureGraphNode(state.graph, blockerId);
            ensureGraphNode(state.graph, task.id);
            if (wouldCreateCycle(state.graph, blockerId, task.id)) {
              throw new Error(
                `TASK_CYCLE_DEPENDENCY: adding dependency ${blockerId} -> ${task.id} creates cycle`
              );
            }

            addDependencyEdge(state.graph, blockerId, task.id);
            pushUnique(task.blockedBy, blockerId);
            pushUnique(blocker.blocks, task.id);
          }

          historyEntries.push({
            timestamp: now,
            action: 'dependency_added',
            actor: args.updated_by || null,
            reason: args.reason,
            metadata: {
              blockedBy: safeJsonClone(args.add_blocked_by),
            },
          });
        }

        if (args.remove_blocked_by && args.remove_blocked_by.length > 0) {
          for (const blockerId of args.remove_blocked_by) {
            const blocker = state.tasks[blockerId];
            if (!blocker) {
              continue;
            }

            removeDependencyEdge(state.graph, blockerId, task.id);
            removeItem(task.blockedBy, blockerId);
            removeItem(blocker.blocks, task.id);
          }

          historyEntries.push({
            timestamp: now,
            action: 'dependency_removed',
            actor: args.updated_by || null,
            reason: args.reason,
            metadata: {
              blockedBy: safeJsonClone(args.remove_blocked_by),
            },
          });
        }

        if (args.subject !== undefined) task.subject = args.subject.trim();
        if (args.description !== undefined) task.description = args.description.trim();
        if (args.active_form !== undefined) task.activeForm = args.active_form.trim();
        if (args.priority !== undefined) task.priority = args.priority;
        if (args.owner !== undefined) task.owner = args.owner;
        if (args.progress !== undefined) task.progress = args.progress;
        if (args.metadata !== undefined) {
          task.metadata = {
            ...task.metadata,
            ...safeJsonClone(args.metadata),
          };
        }

        if (args.status !== undefined) {
          task.status = args.status;
          if (args.status === 'in_progress' && previousStatus !== 'in_progress') {
            task.startedAt = now;
          }
          if (args.status === 'completed') {
            task.completedAt = now;
            task.progress = 100;
            task.owner = null;
          }
          if (args.status === 'cancelled') {
            task.cancelledAt = now;
            task.owner = null;
          }
          if (
            args.status === 'pending' &&
            previousStatus === 'in_progress' &&
            args.owner === undefined
          ) {
            task.owner = null;
          }
          if (args.status === 'failed') {
            task.lastError = args.reason || task.lastError || 'task marked as failed';
            task.lastErrorAt = now;
            task.owner = null;
          }
        }

        if (args.status !== undefined && previousStatus !== task.status) {
          historyEntries.push({
            timestamp: now,
            action: task.status === 'cancelled' ? 'cancelled' : 'status_changed',
            fromStatus: previousStatus,
            toStatus: task.status,
            actor: args.updated_by || null,
            reason: args.reason,
          });
        }

        if (args.owner !== undefined && previousOwner !== task.owner) {
          historyEntries.push({
            timestamp: now,
            action: 'owner_changed',
            actor: args.updated_by || null,
            reason: args.reason,
            metadata: {
              from: previousOwner,
              to: task.owner,
            },
          });
        }

        if (
          args.status === undefined &&
          args.add_blocked_by === undefined &&
          args.remove_blocked_by === undefined
        ) {
          historyEntries.push({
            timestamp: now,
            action: 'updated',
            actor: args.updated_by || null,
            reason: args.reason,
          });
        }

        task.history.push(...historyEntries);
        task.updatedAt = now;
        task.version += 1;
        ensureGraphNode(state.graph, task.id);

        return safeJsonClone(task);
      });

      const canStart = evaluateTaskCanStart(updated.result, updated.state.tasks);

      return buildTaskSuccess({
        namespace: this.store.normalizeNamespace(namespace),
        task: updated.result,
        can_start: canStart,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const parsed = parsePrefixedError(message);
      return buildTaskFailure(parsed.code, parsed.detail, {
        task_id: args.task_id,
      });
    }
  }
}

export default TaskUpdateTool;

import { z } from 'zod';
import { BaseTool, type ToolResult } from './base-tool';
import { buildTaskFailure, buildTaskSuccess } from './task-errors';
import { getTaskStore, type TaskStore } from './task-store';
import {
  createUnconfiguredSubagentRunnerAdapter,
  type SubagentRunnerAdapter,
} from './task-runner-adapter';
import { isAgentRunTerminal, safeJsonClone } from './task-types';
import { TASK_STOP_DESCRIPTION } from './tool-prompts';

const cancelLinkedTaskSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return value;
}, z.boolean());

const schema = z
  .object({
    namespace: z.string().min(1).optional().describe('Optional task namespace'),
    agent_id: z.string().min(1).optional().describe('Direct agent run id to stop'),
    task_id: z
      .string()
      .min(1)
      .optional()
      .describe('Planning task id used to resolve linked agent run'),
    reason: z.string().optional().describe('Optional cancellation reason'),
    cancel_linked_task: cancelLinkedTaskSchema
      .optional()
      .describe('When true, also cancel linked planning tasks'),
  })
  .strict();

type TaskStopArgs = z.infer<typeof schema>;

export interface TaskStopToolOptions {
  store?: TaskStore;
  runner?: SubagentRunnerAdapter;
  defaultNamespace?: string;
}

export class TaskStopTool extends BaseTool<typeof schema> {
  name = 'task_stop';
  description = TASK_STOP_DESCRIPTION;
  parameters = schema;

  private readonly store: TaskStore;
  private readonly runner: SubagentRunnerAdapter;
  private readonly defaultNamespace?: string;

  constructor(options: TaskStopToolOptions = {}) {
    super();
    this.store = options.store || getTaskStore();
    this.runner = options.runner || createUnconfiguredSubagentRunnerAdapter();
    this.defaultNamespace = options.defaultNamespace;
  }

  override getConcurrencyMode(): 'exclusive' {
    return 'exclusive';
  }

  override getConcurrencyLockKey(args: TaskStopArgs): string {
    const namespace = args.namespace || this.defaultNamespace || 'default';
    return `taskns:${namespace}`;
  }

  async execute(args: TaskStopArgs): Promise<ToolResult> {
    const namespace = args.namespace || this.defaultNamespace;
    const normalizedNamespace = this.store.normalizeNamespace(namespace);

    const resolved = await this.resolveAgentId(normalizedNamespace, args);
    if (!resolved.ok) {
      return buildTaskFailure(resolved.code, resolved.message, {
        namespace: normalizedNamespace,
      });
    }

    const agentId = resolved.agentId;
    const before = await this.runner.poll(normalizedNamespace, agentId);
    if (!before) {
      return buildTaskFailure('AGENT_RUN_NOT_FOUND', `agent run not found: ${agentId}`, {
        namespace: normalizedNamespace,
      });
    }
    if (isAgentRunTerminal(before.status)) {
      return buildTaskFailure(
        'AGENT_RUN_ALREADY_TERMINAL',
        `agent run already terminal: ${before.status}`,
        {
          namespace: normalizedNamespace,
          agent_id: agentId,
        }
      );
    }

    const cancelled = await this.runner.cancel(normalizedNamespace, agentId, args.reason);
    if (!cancelled) {
      return buildTaskFailure('AGENT_RUN_NOT_FOUND', `agent run not found: ${agentId}`, {
        namespace: normalizedNamespace,
      });
    }

    let affectedTaskIds: string[] = [];
    const cancelLinkedTask = args.cancel_linked_task !== undefined ? args.cancel_linked_task : true;

    if (cancelLinkedTask) {
      const updated = await this.store.updateState(normalizedNamespace, (state) => {
        const now = Date.now();
        const targets = Object.values(state.tasks).filter((task) => task.agentId === agentId);

        for (const task of targets) {
          if (task.status === 'completed' || task.status === 'cancelled') {
            continue;
          }
          const previousStatus = task.status;
          task.status = 'cancelled';
          task.owner = null;
          task.cancelledAt = now;
          task.updatedAt = now;
          task.version += 1;
          task.history.push({
            timestamp: now,
            action: 'cancelled',
            fromStatus: previousStatus,
            toStatus: 'cancelled',
            actor: 'task_stop',
            reason: args.reason || 'Cancelled by task_stop',
            metadata: {
              agentId,
            },
          });
          affectedTaskIds.push(task.id);
        }
        return null;
      });
      void updated;
    }

    return buildTaskSuccess({
      namespace: normalizedNamespace,
      agent_run: safeJsonClone(cancelled),
      cancelled_task_ids: affectedTaskIds,
    });
  }

  private async resolveAgentId(
    namespace: string,
    args: TaskStopArgs
  ): Promise<{ ok: true; agentId: string } | { ok: false; code: string; message: string }> {
    if (args.agent_id) {
      return { ok: true, agentId: args.agent_id };
    }
    if (!args.task_id) {
      return {
        ok: false,
        code: 'TASK_STOP_TARGET_REQUIRED',
        message: 'agent_id or task_id is required',
      };
    }

    const state = await this.store.getState(namespace);
    const task = state.tasks[args.task_id];
    if (!task) {
      return {
        ok: false,
        code: 'TASK_NOT_FOUND',
        message: `task not found: ${args.task_id}`,
      };
    }
    if (!task.agentId) {
      return {
        ok: false,
        code: 'AGENT_RUN_NOT_FOUND',
        message: `task has no linked agent run: ${args.task_id}`,
      };
    }
    return {
      ok: true,
      agentId: task.agentId,
    };
  }
}

export default TaskStopTool;

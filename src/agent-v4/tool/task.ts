import { z } from 'zod';
import { BaseTool, type ToolResult } from './base-tool';
import { buildTaskFailure, buildTaskSuccess, parsePrefixedError } from './task-errors';
import { getTaskStore, type TaskStore } from './task-store';
import {
  createUnconfiguredSubagentRunnerAdapter,
  type StartAgentInput,
  type SubagentRunnerAdapter,
} from './task-runner-adapter';
import { getTaskSubagentConfig, resolveTaskSubagentTools } from './task-subagent-config';
import { attachParentAbortCascade } from './task-parent-abort';
import {
  evaluateTaskCanStart,
  isAgentRunTerminal,
  safeJsonClone,
  type SubagentType,
} from './task-types';
import type { ToolExecutionContext } from './types';
import { TASK_TOOL_DESCRIPTION } from './tool-prompts';

const runInBackgroundSchema = z.preprocess((value) => {
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
    subagent_type: z
      .enum([
        'Bash',
        'general-purpose',
        'Explore',
        'Restore',
        'Plan',
        'research-agent',
        'find-skills',
      ])
      .describe('The type of specialized agent to use for this task'),
    prompt: z.string().min(1).describe('The task for the agent to perform'),
    description: z.string().optional().describe('A short (3-5 words) description of the task'),

    run_in_background: runInBackgroundSchema
      .optional()
      .describe('Run task in background and return agent/task id immediately'),
  })
  .strict();

type LegacyTaskToolArgs = {
  model?: 'sonnet' | 'opus' | 'haiku';
  resume?: string;
  allowed_tools?: string[];
  linked_task_id?: string;
  metadata?: Record<string, unknown>;
};

type TaskToolArgs = z.infer<typeof schema> & LegacyTaskToolArgs;

export interface TaskToolOptions {
  store?: TaskStore;
  runner?: SubagentRunnerAdapter;
  defaultNamespace?: string;
}

export class TaskTool extends BaseTool<typeof schema> {
  name = 'agent';
  description = TASK_TOOL_DESCRIPTION;
  parameters = schema;

  private readonly store: TaskStore;
  private readonly runner: SubagentRunnerAdapter;
  private readonly defaultNamespace?: string;

  constructor(options: TaskToolOptions = {}) {
    super();
    this.store = options.store || getTaskStore();
    this.runner = options.runner || createUnconfiguredSubagentRunnerAdapter();
    this.defaultNamespace = options.defaultNamespace;
  }

  override getConcurrencyMode(): 'exclusive' {
    return 'exclusive';
  }

  override getConcurrencyLockKey(args: TaskToolArgs): string {
    const namespace = args.namespace || this.defaultNamespace || 'default';
    return `taskns:${namespace}`;
  }

  async execute(args: TaskToolArgs, context?: ToolExecutionContext): Promise<ToolResult> {
    const namespace = args.namespace || this.defaultNamespace;
    const normalizedNamespace = this.store.normalizeNamespace(namespace);

    try {
      if (args.linked_task_id) {
        const state = await this.store.getState(normalizedNamespace);
        const linkedTask = state.tasks[args.linked_task_id];
        if (!linkedTask) {
          return buildTaskFailure(
            'TASK_NOT_FOUND',
            `linked task not found: ${args.linked_task_id}`,
            {
              namespace: normalizedNamespace,
            }
          );
        }
        const canStart = evaluateTaskCanStart(linkedTask, state.tasks);
        if (!canStart.canStart && linkedTask.status === 'pending') {
          return buildTaskFailure('TASK_BLOCKED', canStart.reason || 'linked task is blocked', {
            task_id: args.linked_task_id,
            namespace: normalizedNamespace,
          });
        }
      }

      const subagentType = args.subagent_type as SubagentType;
      const subagentConfig = getTaskSubagentConfig(subagentType);
      const startInput: StartAgentInput = {
        subagentType,
        prompt: args.prompt,
        systemPrompt: subagentConfig.systemPrompt,
        description: args.description,
        model: args.model,
        allowedTools: resolveTaskSubagentTools(subagentType, args.allowed_tools),
        runInBackground: args.run_in_background === true,
        resume: args.resume,
        linkedTaskId: args.linked_task_id,
        metadata: safeJsonClone(args.metadata || {}),
      };

      const run = await this.runner.start(normalizedNamespace, startInput, context);
      const detachParentAbort = attachParentAbortCascade({
        context,
        namespace: normalizedNamespace,
        agentId: run.agentId,
        linkedTaskId: args.linked_task_id,
        runner: this.runner,
        store: this.store,
      });

      if (args.linked_task_id) {
        await this.store.updateState(normalizedNamespace, (state) => {
          const task = state.tasks[args.linked_task_id as string];
          if (!task) {
            return null;
          }

          const now = Date.now();
          task.agentId = run.agentId;

          if (run.status === 'completed') {
            task.status = 'completed';
            task.progress = 100;
            task.owner = null;
            task.completedAt = now;
          } else if (run.status === 'cancelled') {
            task.status = 'cancelled';
            task.owner = null;
            task.cancelledAt = now;
          } else if (run.status === 'failed' || run.status === 'timed_out') {
            task.status = 'failed';
            task.owner = null;
            task.lastError = run.error || `linked agent ${run.status}`;
            task.lastErrorAt = now;
          } else {
            if (task.status === 'pending') {
              task.status = 'in_progress';
              task.startedAt = now;
            }
            task.owner = `agent:${run.agentId}`;
          }

          task.updatedAt = now;
          task.version += 1;
          task.history.push({
            timestamp: now,
            action: 'agent_linked',
            actor: 'task-tool',
            metadata: {
              agentId: run.agentId,
              agentStatus: run.status,
            },
          });
          return null;
        });
      }
      if (isAgentRunTerminal(run.status)) {
        detachParentAbort();
      }

      return buildTaskSuccess({
        namespace: normalizedNamespace,
        agent_run: run,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const parsed = parsePrefixedError(message);
      return buildTaskFailure(parsed.code, parsed.detail, {
        namespace: normalizedNamespace,
      });
    }
  }
}

export default TaskTool;

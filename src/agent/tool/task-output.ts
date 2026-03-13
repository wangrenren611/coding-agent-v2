import { z } from 'zod';
import { BaseTool, type ToolResult } from './base-tool';
import { buildTaskFailure, buildTaskSuccess } from './task-errors';
import { getTaskStore, type TaskStore } from './task-store';
import {
  createUnconfiguredSubagentRunnerAdapter,
  type SubagentRunnerAdapter,
} from './task-runner-adapter';
import { isAgentRunTerminal, safeJsonClone, type AgentRunEntity } from './task-types';
import type { ToolExecutionContext } from './types';
import { TASK_OUTPUT_DESCRIPTION } from './tool-prompts';

const blockSchema = z.preprocess((value) => {
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
    agent_id: z.string().min(1).optional().describe('Direct agent run id to query'),
    task_id: z
      .string()
      .min(1)
      .optional()
      .describe('Planning task id used to resolve linked agent run'),
    block: blockSchema.optional().describe('Wait for task completion before returning'),
    timeout_ms: z
      .number()
      .int()
      .min(1)
      .max(30 * 60 * 1000)
      .optional()
      .describe('Timeout in milliseconds when blocking'),
    poll_interval_ms: z
      .number()
      .int()
      .min(20)
      .max(5000)
      .optional()
      .describe('Polling interval in milliseconds'),
  })
  .strict();

type TaskOutputArgs = z.infer<typeof schema>;

export interface TaskOutputToolOptions {
  store?: TaskStore;
  runner?: SubagentRunnerAdapter;
  defaultNamespace?: string;
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new Error('TASK_OUTPUT_ABORTED: polling aborted');
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new Error('TASK_OUTPUT_ABORTED: polling aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function sanitizeTaskOutputRun(run: AgentRunEntity): AgentRunEntity {
  const cloned = safeJsonClone(run);
  if (cloned.status === 'completed') {
    return cloned;
  }

  delete cloned.output;

  if (
    (cloned.status === 'failed' ||
      cloned.status === 'timed_out' ||
      cloned.status === 'cancelled') &&
    (!cloned.error || cloned.error.trim().length === 0)
  ) {
    cloned.error = `Agent run ${cloned.status}`;
  }

  return cloned;
}

export class TaskOutputTool extends BaseTool<typeof schema> {
  name = 'task_output';
  description = TASK_OUTPUT_DESCRIPTION;
  parameters = schema;

  private readonly store: TaskStore;
  private readonly runner: SubagentRunnerAdapter;
  private readonly defaultNamespace?: string;

  constructor(options: TaskOutputToolOptions = {}) {
    super();
    this.store = options.store || getTaskStore();
    this.runner = options.runner || createUnconfiguredSubagentRunnerAdapter();
    this.defaultNamespace = options.defaultNamespace;
  }

  override getConcurrencyMode(): 'parallel-safe' {
    return 'parallel-safe';
  }

  override getConcurrencyLockKey(args: TaskOutputArgs): string {
    const namespace = args.namespace || this.defaultNamespace || 'default';
    const target = args.agent_id || args.task_id || 'unknown';
    return `taskns:${namespace}:agent:${target}`;
  }

  async execute(args: TaskOutputArgs, context?: ToolExecutionContext): Promise<ToolResult> {
    const namespace = args.namespace || this.defaultNamespace;
    const normalizedNamespace = this.store.normalizeNamespace(namespace);

    const resolvedAgentIdResult = await this.resolveAgentId(normalizedNamespace, args);
    if (!resolvedAgentIdResult.ok) {
      return buildTaskFailure(resolvedAgentIdResult.code, resolvedAgentIdResult.message, {
        namespace: normalizedNamespace,
      });
    }

    const agentId = resolvedAgentIdResult.agentId;

    const shouldBlock = args.block !== undefined ? args.block : true;
    const timeoutMs = args.timeout_ms !== undefined ? args.timeout_ms : 30000;
    const pollIntervalMs = args.poll_interval_ms !== undefined ? args.poll_interval_ms : 200;

    // Default semantics: block=true.
    if (!shouldBlock) {
      const run = await this.runner.poll(normalizedNamespace, agentId);
      if (!run) {
        return buildTaskFailure('AGENT_RUN_NOT_FOUND', `agent run not found: ${agentId}`, {
          namespace: normalizedNamespace,
        });
      }
      return buildTaskSuccess({
        namespace: normalizedNamespace,
        agent_run: sanitizeTaskOutputRun(run),
      });
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const run = await this.runner.poll(normalizedNamespace, agentId);
      if (!run) {
        return buildTaskFailure('AGENT_RUN_NOT_FOUND', `agent run not found: ${agentId}`, {
          namespace: normalizedNamespace,
        });
      }
      if (isAgentRunTerminal(run.status)) {
        return buildTaskSuccess({
          namespace: normalizedNamespace,
          agent_run: sanitizeTaskOutputRun(run),
          waited_ms: Date.now() - startedAt,
          completed: true,
        });
      }
      await sleep(pollIntervalMs, context?.toolAbortSignal);
    }

    const latest = await this.runner.poll(normalizedNamespace, agentId);
    if (!latest) {
      return buildTaskFailure('AGENT_RUN_NOT_FOUND', `agent run not found: ${agentId}`, {
        namespace: normalizedNamespace,
      });
    }
    return buildTaskSuccess({
      namespace: normalizedNamespace,
      agent_run: sanitizeTaskOutputRun(latest),
      waited_ms: Date.now() - startedAt,
      completed: false,
      timeout_hit: true,
    });
  }

  private async resolveAgentId(
    namespace: string,
    args: TaskOutputArgs
  ): Promise<{ ok: true; agentId: string } | { ok: false; code: string; message: string }> {
    if (args.agent_id) {
      return { ok: true, agentId: args.agent_id };
    }
    if (!args.task_id) {
      return {
        ok: false,
        code: 'TASK_OUTPUT_TARGET_REQUIRED',
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

export default TaskOutputTool;

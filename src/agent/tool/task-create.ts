import { z } from 'zod';
import { BaseTool, type ToolResult } from './base-tool';
import { buildTaskFailure, buildTaskSuccess, parsePrefixedError } from './task-errors';
import { getTaskStore, type TaskStore } from './task-store';
import {
  DEFAULT_RETRY_CONFIG,
  createTaskId,
  safeJsonClone,
  type RetryConfig,
  type TaskCheckpoint,
  type TaskEntity,
  type TaskTag,
  type TaskPriority,
} from './task-types';
import { ensureGraphNode } from './task-graph';
import { TASK_CREATE_DESCRIPTION } from './tool-prompts';

const checkpointSchema = z
  .object({
    id: z.string().min(1).describe('Checkpoint identifier'),
    name: z.string().min(1).describe('Checkpoint display name'),
    completed: z.boolean().optional().describe('Whether checkpoint is already completed'),
  })
  .strict();

const retryConfigSchema = z
  .object({
    maxRetries: z.number().int().min(0).describe('Maximum retry attempts'),
    retryDelayMs: z.number().int().min(0).describe('Initial delay between retries in milliseconds'),
    backoffMultiplier: z.number().min(1).describe('Exponential backoff multiplier'),
    retryOn: z.array(z.string().min(1)).describe('Error categories that should trigger retry'),
  })
  .strict();

const tagSchema = z
  .object({
    name: z.string().min(1).describe('Tag name'),
    color: z.string().optional().describe('Optional color hint'),
    category: z.string().optional().describe('Optional tag category'),
  })
  .strict();

const schema = z
  .object({
    namespace: z.string().min(1).optional().describe('Optional task namespace'),
    subject: z.string().min(3).describe('A brief actionable title in imperative form'),
    description: z
      .string()
      .min(10)
      .describe('Detailed task description with context and acceptance criteria'),
    active_form: z
      .string()
      .min(1)
      .optional()
      .describe('Present continuous form shown while task is in progress'),
    priority: z.enum(['critical', 'high', 'normal', 'low']).optional().describe('Task priority'),
    tags: z.array(tagSchema).optional().describe('Optional task tags'),
    checkpoints: z
      .array(checkpointSchema)
      .optional()
      .describe('Optional checkpoints for progress tracking'),
    retry_config: retryConfigSchema.optional().describe('Optional retry behavior configuration'),
    timeout_ms: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Optional timeout budget in milliseconds'),
    metadata: z.record(z.string(), z.unknown()).optional().describe('Optional metadata map'),
    created_by: z.string().optional().describe('Optional actor identifier'),
  })
  .strict();

type TaskCreateArgs = z.infer<typeof schema>;

export interface TaskCreateToolOptions {
  store?: TaskStore;
  defaultNamespace?: string;
}

export class TaskCreateTool extends BaseTool<typeof schema> {
  name = 'task_create';
  description = TASK_CREATE_DESCRIPTION;
  parameters = schema;

  private readonly store: TaskStore;
  private readonly defaultNamespace?: string;

  constructor(options: TaskCreateToolOptions = {}) {
    super();
    this.store = options.store || getTaskStore();
    this.defaultNamespace = options.defaultNamespace;
  }

  override getConcurrencyMode(): 'exclusive' {
    return 'exclusive';
  }

  override getConcurrencyLockKey(args: TaskCreateArgs): string {
    const namespace = args.namespace || this.defaultNamespace || 'default';
    return `taskns:${namespace}`;
  }

  async execute(args: TaskCreateArgs): Promise<ToolResult> {
    const namespace = args.namespace || this.defaultNamespace;

    try {
      const created = await this.store.updateState(namespace, (state) => {
        const now = Date.now();
        const normalizedSubject = args.subject.trim();

        const duplicate = Object.values(state.tasks).find(
          (task) =>
            task.subject === normalizedSubject &&
            task.status !== 'completed' &&
            task.status !== 'cancelled' &&
            task.status !== 'failed'
        );
        if (duplicate) {
          throw new Error(
            `TASK_DUPLICATE_SUBJECT: duplicate active task subject already exists: ${duplicate.id}`
          );
        }

        const id = createTaskId();
        const checkpointItems: TaskCheckpoint[] = (args.checkpoints || []).map((checkpoint) => ({
          id: checkpoint.id,
          name: checkpoint.name,
          completed: checkpoint.completed || false,
        }));
        const retryConfig: RetryConfig = args.retry_config
          ? safeJsonClone(args.retry_config as RetryConfig)
          : safeJsonClone(DEFAULT_RETRY_CONFIG);
        const tags: TaskTag[] = (args.tags || []).map((tag) => safeJsonClone(tag));

        const task: TaskEntity = {
          id,
          subject: normalizedSubject,
          description: args.description.trim(),
          activeForm: args.active_form?.trim() || `${normalizedSubject} in progress`,
          status: 'pending',
          priority: (args.priority || 'normal') as TaskPriority,
          owner: null,
          blockedBy: [],
          blocks: [],
          progress: 0,
          checkpoints: checkpointItems,
          retryConfig,
          retryCount: 0,
          timeoutMs: args.timeout_ms,
          tags,
          metadata: safeJsonClone(args.metadata || {}),
          history: [
            {
              timestamp: now,
              action: 'created',
              actor: args.created_by || null,
              metadata: {
                subject: normalizedSubject,
              },
            },
          ],
          createdAt: now,
          updatedAt: now,
          version: 1,
        };

        state.tasks[id] = task;
        ensureGraphNode(state.graph, id);

        return safeJsonClone(task);
      });

      return buildTaskSuccess({
        namespace: this.store.normalizeNamespace(namespace),
        task: created.result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const parsed = parsePrefixedError(message);
      return buildTaskFailure(parsed.code, parsed.detail);
    }
  }
}

export default TaskCreateTool;

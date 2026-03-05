import { z } from 'zod';
import type { Agent } from '../../agent';

export const TaskStatusSchema = z.enum(['pending', 'in_progress', 'completed']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const BackgroundTaskStatusSchema = z.enum([
  'queued',
  'running',
  'cancelling',
  'cancelled',
  'completed',
  'failed',
]);
export type BackgroundTaskStatus = z.infer<typeof BackgroundTaskStatusSchema>;

export const SubagentTypeSchema = z.enum([
  'bash',
  'general-purpose',
  'explore',
  'plan',
  'ui-sketcher',
  'bug-analyzer',
  'code-reviewer',
]);
export type SubagentType = z.infer<typeof SubagentTypeSchema>;

export const ModelHintSchema = z.enum(['sonnet', 'opus', 'haiku']);
export type ModelHint = z.infer<typeof ModelHintSchema>;

export const JsonObjectSchema = z.record(z.string(), z.unknown());
export const JsonPatchSchema = z.record(z.string(), z.union([z.unknown(), z.null()]));

export const ManagedTaskSchema = z
  .object({
    id: z.string().min(1),
    subject: z.string().min(1),
    description: z.string().min(1),
    activeForm: z.string().min(1),
    status: TaskStatusSchema,
    owner: z.string().default(''),
    metadata: JsonObjectSchema.optional(),
    blocks: z.array(z.string().min(1)),
    blockedBy: z.array(z.string().min(1)),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict();
export type ManagedTask = z.infer<typeof ManagedTaskSchema>;

export const SubTaskRunRecordSchema = z
  .object({
    runId: z.string().min(1),
    parentSessionId: z.string().min(1),
    childSessionId: z.string().min(1),
    mode: z.enum(['foreground', 'background']),
    status: BackgroundTaskStatusSchema,
    description: z.string().min(1),
    prompt: z.string().min(1),
    subagentType: SubagentTypeSchema,
    model: ModelHintSchema.optional(),
    resume: z.string().min(1).optional(),
    output: z.string().optional(),
    error: z.string().optional(),
    turns: z.number().int().min(0).optional(),
    toolsUsed: z.array(z.string().min(1)),
    messageCount: z.number().int().min(0),
    createdAt: z.string().min(1),
    startedAt: z.string().min(1),
    finishedAt: z.string().optional(),
    lastActivityAt: z.string().min(1),
    lastToolName: z.string().optional(),
    updatedAt: z.string().min(1),
  })
  .strict();
export type SubTaskRunRecord = z.infer<typeof SubTaskRunRecordSchema>;

export interface ActiveExecution {
  run: SubTaskRunRecord;
  agent: Agent;
  promise: Promise<void>;
  stopRequested: boolean;
  cleanupTimer?: NodeJS.Timeout;
}

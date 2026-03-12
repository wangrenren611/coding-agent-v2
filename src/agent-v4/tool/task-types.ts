import { randomUUID } from 'node:crypto';

export const TASK_STATUS_VALUES = [
  'pending',
  'in_progress',
  'completed',
  'cancelled',
  'failed',
] as const;

export type TaskStatus = (typeof TASK_STATUS_VALUES)[number];

export const TASK_PRIORITY_VALUES = ['critical', 'high', 'normal', 'low'] as const;

export type TaskPriority = (typeof TASK_PRIORITY_VALUES)[number];

export const AGENT_RUN_STATUS_VALUES = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
  'paused',
  'timed_out',
] as const;

export type AgentRunStatus = (typeof AGENT_RUN_STATUS_VALUES)[number];

export const SUBAGENT_TYPE_VALUES = [
  'Bash',
  'general-purpose',
  'Explore',
  'Restore',
  'Plan',
  'research-agent',
  'find-skills',
] as const;

export type SubagentType = (typeof SUBAGENT_TYPE_VALUES)[number];

export interface TaskCheckpoint {
  id: string;
  name: string;
  completed: boolean;
  completedAt?: number;
}

export interface TaskTag {
  name: string;
  color?: string;
  category?: string;
}

export interface RetryConfig {
  maxRetries: number;
  retryDelayMs: number;
  backoffMultiplier: number;
  retryOn: string[];
}

export interface TaskHistoryEntry {
  timestamp: number;
  action: string;
  fromStatus?: TaskStatus;
  toStatus?: TaskStatus;
  actor?: string | null;
  reason?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskEntity {
  id: string;
  subject: string;
  description: string;
  activeForm: string;
  status: TaskStatus;
  priority: TaskPriority;
  owner: string | null;
  blockedBy: string[];
  blocks: string[];
  progress: number;
  checkpoints: TaskCheckpoint[];
  retryConfig: RetryConfig;
  retryCount: number;
  lastError?: string;
  lastErrorAt?: number;
  timeoutMs?: number;
  tags: TaskTag[];
  metadata: Record<string, unknown>;
  history: TaskHistoryEntry[];
  agentId?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  cancelledAt?: number;
  version: number;
}

export interface AgentRunEntity {
  agentId: string;
  status: AgentRunStatus;
  subagentType: SubagentType;
  prompt: string;
  description?: string;
  model?: 'sonnet' | 'opus' | 'haiku';
  maxTurns?: number;
  allowedTools?: string[];
  linkedTaskId?: string;
  output?: string;
  error?: string;
  progress?: number;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  updatedAt: number;
  outputFile?: string;
  metadata: Record<string, unknown>;
  version: number;
}

export interface DependencyGraphState {
  adjacency: Record<string, string[]>;
  reverse: Record<string, string[]>;
}

export interface TaskNamespaceState {
  namespace: string;
  tasks: Record<string, TaskEntity>;
  agentRuns: Record<string, AgentRunEntity>;
  graph: DependencyGraphState;
  updatedAt: number;
  schemaVersion: 1;
}

export interface CanStartResult {
  canStart: boolean;
  reason?: string;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  retryDelayMs: 5000,
  backoffMultiplier: 2,
  retryOn: ['timeout', 'network_error'],
};

export const VALID_TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'pending', 'cancelled', 'failed'],
  completed: [],
  cancelled: [],
  failed: ['pending'],
};

export function createTaskId(): string {
  return `task_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

export function createAgentId(): string {
  return `agent_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

export function isTaskTerminal(status: TaskStatus): boolean {
  return status === 'completed' || status === 'cancelled';
}

export function isTaskFinal(status: TaskStatus): boolean {
  return status === 'completed' || status === 'cancelled' || status === 'failed';
}

export function isAgentRunTerminal(status: AgentRunStatus): boolean {
  return (
    status === 'completed' ||
    status === 'failed' ||
    status === 'cancelled' ||
    status === 'timed_out'
  );
}

export function validateTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) {
    return true;
  }
  return VALID_TASK_TRANSITIONS[from].includes(to);
}

export function createEmptyNamespaceState(namespace: string): TaskNamespaceState {
  return {
    namespace,
    tasks: {},
    agentRuns: {},
    graph: {
      adjacency: {},
      reverse: {},
    },
    updatedAt: Date.now(),
    schemaVersion: 1,
  };
}

export function evaluateTaskCanStart(
  task: TaskEntity,
  allTasks: Record<string, TaskEntity>
): CanStartResult {
  if (task.status !== 'pending') {
    return {
      canStart: false,
      reason: `Task status is ${task.status}, expected pending`,
    };
  }

  if (task.owner) {
    return {
      canStart: false,
      reason: `Task is already owned by ${task.owner}`,
    };
  }

  const cancelledBlockers: string[] = [];
  const failedBlockers: string[] = [];
  const incompleteBlockers: string[] = [];

  for (const blockerId of task.blockedBy) {
    const blocker = allTasks[blockerId];
    if (!blocker) {
      incompleteBlockers.push(blockerId);
      continue;
    }
    if (blocker.status === 'cancelled') {
      cancelledBlockers.push(blockerId);
      continue;
    }
    if (blocker.status === 'failed') {
      failedBlockers.push(blockerId);
      continue;
    }
    if (blocker.status !== 'completed') {
      incompleteBlockers.push(blockerId);
    }
  }

  if (cancelledBlockers.length > 0 || failedBlockers.length > 0) {
    return {
      canStart: false,
      reason:
        `Blocked by cancelled/failed dependencies: ` +
        `${[...cancelledBlockers, ...failedBlockers].join(', ')}`,
    };
  }

  if (incompleteBlockers.length > 0) {
    return {
      canStart: false,
      reason: `Blocked by incomplete dependencies: ${incompleteBlockers.join(', ')}`,
    };
  }

  return { canStart: true };
}

export function safeJsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

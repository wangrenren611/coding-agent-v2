export type TaskId = `tsk_${string}`;
export type RunId = `run_${string}`;

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export type TaskStatus =
  | 'pending'
  | 'ready'
  | 'blocked'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type RunStatus =
  | 'queued'
  | 'running'
  | 'cancel_requested'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export type SubAgentMemoryMode = 'inherit' | 'isolated' | 'off';

export interface SubAgentConfigSnapshot {
  profileId: string;
  profileName: string;
  profileVersion: number;
  systemPrompt: string;
  outputContract?: string;
  maxSteps: number;
  timeoutMs?: number;
  toolAllowlist?: string[];
  toolDenylist?: string[];
  memoryMode: SubAgentMemoryMode;
  metadata?: Record<string, unknown>;
}

export interface Task {
  id: TaskId;
  sessionId: string;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDependency {
  taskId: TaskId;
  dependsOnTaskId: TaskId;
  createdAt: string;
}

export interface Run {
  id: RunId;
  sessionId: string;
  taskId?: TaskId;
  agentType: string;
  agentProfileId?: string;
  agentConfigSnapshot?: SubAgentConfigSnapshot;
  status: RunStatus;
  inputSnapshot: string;
  output?: string;
  error?: string;
  timeoutMs?: number;
  startedAt?: string;
  finishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RunEvent {
  runId: RunId;
  seq: number;
  type: 'status' | 'stdout' | 'stderr' | 'tool_use' | 'tool_result' | 'meta';
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface CreateTaskInput {
  title: string;
  description: string;
  priority?: TaskPriority;
  status?: Extract<TaskStatus, 'pending' | 'ready' | 'blocked'>;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  expectedVersion?: number;
}

export interface StartRunInput {
  taskId?: TaskId;
  prompt?: string;
  agentType: string;
  agentProfileId?: string;
  agentConfigSnapshot?: SubAgentConfigSnapshot;
  timeoutMs?: number;
}

export type RunTerminalStatus = Extract<
  RunStatus,
  'succeeded' | 'failed' | 'cancelled' | 'timeout'
>;

import type {
  CreateTaskInput,
  Run,
  RunEvent,
  RunId,
  RunStatus,
  RunTerminalStatus,
  StartRunInput,
  Task,
  TaskDependency,
  TaskId,
  UpdateTaskInput,
} from '../types';

export interface CreateTaskParams {
  sessionId: string;
  input: CreateTaskInput;
  now: string;
  id: TaskId;
}

export interface StartRunParams {
  sessionId: string;
  input: StartRunInput;
  now: string;
  id: RunId;
}

export interface TaskQuery {
  status?: Task['status'];
  priority?: Task['priority'];
  limit?: number;
}

export interface RunQuery {
  taskId?: TaskId;
  status?: RunStatus;
  limit?: number;
}

export interface CompleteRunInput {
  status: RunTerminalStatus;
  output?: string;
  error?: string;
  now: string;
}

export interface AppendRunEventInput {
  runId: RunId;
  type: RunEvent['type'];
  payload: RunEvent['payload'];
  createdAt: string;
}

export interface TaskRepository {
  prepare(): Promise<void>;

  createTask(params: CreateTaskParams): Promise<Task>;
  getTask(sessionId: string, taskId: TaskId): Promise<Task | null>;
  listTasks(sessionId: string, query?: TaskQuery): Promise<Task[]>;
  updateTask(
    sessionId: string,
    taskId: TaskId,
    patch: UpdateTaskInput,
    now: string
  ): Promise<Task | null>;
  deleteTask(sessionId: string, taskId: TaskId): Promise<boolean>;

  addDependency(sessionId: string, edge: TaskDependency): Promise<void>;
  removeDependency(sessionId: string, taskId: TaskId, dependsOnTaskId: TaskId): Promise<void>;
  listDependencies(sessionId: string, taskId?: TaskId): Promise<TaskDependency[]>;

  createRun(params: StartRunParams): Promise<Run>;
  getRun(sessionId: string, runId: RunId): Promise<Run | null>;
  listRuns(sessionId: string, query?: RunQuery): Promise<Run[]>;
  listRunsByStatus(statuses: RunStatus[], limit?: number): Promise<Run[]>;
  updateRunStatus(
    sessionId: string,
    runId: RunId,
    status: RunStatus,
    now: string
  ): Promise<Run | null>;
  completeRun(sessionId: string, runId: RunId, input: CompleteRunInput): Promise<Run | null>;

  appendRunEvent(sessionId: string, event: AppendRunEventInput): Promise<RunEvent>;
  listRunEvents(
    sessionId: string,
    runId: RunId,
    afterSeq?: number,
    limit?: number
  ): Promise<RunEvent[]>;

  clearSession(sessionId: string): Promise<void>;
  gcRuns(params: { finishedBefore: string; limit: number }): Promise<number>;
}

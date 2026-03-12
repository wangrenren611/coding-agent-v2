import { describe, expect, it } from 'vitest';
import {
  TASK_STATUS_VALUES,
  TASK_PRIORITY_VALUES,
  AGENT_RUN_STATUS_VALUES,
  SUBAGENT_TYPE_VALUES,
  DEFAULT_RETRY_CONFIG,
  VALID_TASK_TRANSITIONS,
  createTaskId,
  createAgentId,
  isTaskTerminal,
  isTaskFinal,
  isAgentRunTerminal,
  validateTaskTransition,
  createEmptyNamespaceState,
  evaluateTaskCanStart,
  safeJsonClone,
} from '../task-types';
import type { TaskEntity } from '../task-types';

describe('constants', () => {
  it('TASK_STATUS_VALUES contains expected values', () => {
    expect(TASK_STATUS_VALUES).toEqual([
      'pending',
      'in_progress',
      'completed',
      'cancelled',
      'failed',
    ]);
  });

  it('TASK_PRIORITY_VALUES contains expected values', () => {
    expect(TASK_PRIORITY_VALUES).toEqual(['critical', 'high', 'normal', 'low']);
  });

  it('AGENT_RUN_STATUS_VALUES contains expected values', () => {
    expect(AGENT_RUN_STATUS_VALUES).toEqual([
      'queued',
      'running',
      'completed',
      'failed',
      'cancelled',
      'paused',
      'timed_out',
    ]);
  });

  it('SUBAGENT_TYPE_VALUES contains expected values', () => {
    expect(SUBAGENT_TYPE_VALUES).toContain('Bash');
    expect(SUBAGENT_TYPE_VALUES).toContain('general-purpose');
    expect(SUBAGENT_TYPE_VALUES).toContain('Explore');
    expect(SUBAGENT_TYPE_VALUES).toContain('Plan');
  });

  it('DEFAULT_RETRY_CONFIG has expected values', () => {
    expect(DEFAULT_RETRY_CONFIG.maxRetries).toBe(3);
    expect(DEFAULT_RETRY_CONFIG.retryDelayMs).toBe(5000);
    expect(DEFAULT_RETRY_CONFIG.backoffMultiplier).toBe(2);
    expect(DEFAULT_RETRY_CONFIG.retryOn).toEqual(['timeout', 'network_error']);
  });

  it('VALID_TASK_TRANSITIONS defines correct transitions', () => {
    expect(VALID_TASK_TRANSITIONS.pending).toEqual(['in_progress', 'cancelled']);
    expect(VALID_TASK_TRANSITIONS.in_progress).toEqual([
      'completed',
      'pending',
      'cancelled',
      'failed',
    ]);
    expect(VALID_TASK_TRANSITIONS.completed).toEqual([]);
    expect(VALID_TASK_TRANSITIONS.cancelled).toEqual([]);
    expect(VALID_TASK_TRANSITIONS.failed).toEqual(['pending']);
  });
});

describe('createTaskId', () => {
  it('creates unique task IDs', () => {
    const id1 = createTaskId();
    const id2 = createTaskId();

    expect(id1).not.toBe(id2);
  });

  it('creates IDs with task_ prefix', () => {
    const id = createTaskId();
    expect(id.startsWith('task_')).toBe(true);
  });

  it('creates IDs with timestamp and UUID', () => {
    const id = createTaskId();
    const parts = id.split('_');

    expect(parts.length).toBe(3);
    expect(parts[0]).toBe('task');
    expect(Number(parts[1])).toBeGreaterThan(0);
    expect(parts[2]).toHaveLength(8);
  });
});

describe('createAgentId', () => {
  it('creates unique agent IDs', () => {
    const id1 = createAgentId();
    const id2 = createAgentId();

    expect(id1).not.toBe(id2);
  });

  it('creates IDs with agent_ prefix', () => {
    const id = createAgentId();
    expect(id.startsWith('agent_')).toBe(true);
  });

  it('creates IDs with timestamp and UUID', () => {
    const id = createAgentId();
    const parts = id.split('_');

    expect(parts.length).toBe(3);
    expect(parts[0]).toBe('agent');
    expect(Number(parts[1])).toBeGreaterThan(0);
    expect(parts[2]).toHaveLength(8);
  });
});

describe('isTaskTerminal', () => {
  it('returns true for completed status', () => {
    expect(isTaskTerminal('completed')).toBe(true);
  });

  it('returns true for cancelled status', () => {
    expect(isTaskTerminal('cancelled')).toBe(true);
  });

  it('returns false for pending status', () => {
    expect(isTaskTerminal('pending')).toBe(false);
  });

  it('returns false for in_progress status', () => {
    expect(isTaskTerminal('in_progress')).toBe(false);
  });

  it('returns false for failed status', () => {
    expect(isTaskTerminal('failed')).toBe(false);
  });
});

describe('isTaskFinal', () => {
  it('returns true for completed status', () => {
    expect(isTaskFinal('completed')).toBe(true);
  });

  it('returns true for cancelled status', () => {
    expect(isTaskFinal('cancelled')).toBe(true);
  });

  it('returns true for failed status', () => {
    expect(isTaskFinal('failed')).toBe(true);
  });

  it('returns false for pending status', () => {
    expect(isTaskFinal('pending')).toBe(false);
  });

  it('returns false for in_progress status', () => {
    expect(isTaskFinal('in_progress')).toBe(false);
  });
});

describe('isAgentRunTerminal', () => {
  it('returns true for completed status', () => {
    expect(isAgentRunTerminal('completed')).toBe(true);
  });

  it('returns true for failed status', () => {
    expect(isAgentRunTerminal('failed')).toBe(true);
  });

  it('returns true for cancelled status', () => {
    expect(isAgentRunTerminal('cancelled')).toBe(true);
  });

  it('returns true for timed_out status', () => {
    expect(isAgentRunTerminal('timed_out')).toBe(true);
  });

  it('returns false for queued status', () => {
    expect(isAgentRunTerminal('queued')).toBe(false);
  });

  it('returns false for running status', () => {
    expect(isAgentRunTerminal('running')).toBe(false);
  });

  it('returns false for paused status', () => {
    expect(isAgentRunTerminal('paused')).toBe(false);
  });
});

describe('validateTaskTransition', () => {
  it('allows same status transition', () => {
    expect(validateTaskTransition('pending', 'pending')).toBe(true);
    expect(validateTaskTransition('in_progress', 'in_progress')).toBe(true);
    expect(validateTaskTransition('completed', 'completed')).toBe(true);
  });

  it('allows valid transitions from pending', () => {
    expect(validateTaskTransition('pending', 'in_progress')).toBe(true);
    expect(validateTaskTransition('pending', 'cancelled')).toBe(true);
  });

  it('denies invalid transitions from pending', () => {
    expect(validateTaskTransition('pending', 'completed')).toBe(false);
    expect(validateTaskTransition('pending', 'failed')).toBe(false);
  });

  it('allows valid transitions from in_progress', () => {
    expect(validateTaskTransition('in_progress', 'completed')).toBe(true);
    expect(validateTaskTransition('in_progress', 'pending')).toBe(true);
    expect(validateTaskTransition('in_progress', 'cancelled')).toBe(true);
    expect(validateTaskTransition('in_progress', 'failed')).toBe(true);
  });

  it('denies any transitions from completed', () => {
    expect(validateTaskTransition('completed', 'pending')).toBe(false);
    expect(validateTaskTransition('completed', 'in_progress')).toBe(false);
    expect(validateTaskTransition('completed', 'cancelled')).toBe(false);
    expect(validateTaskTransition('completed', 'failed')).toBe(false);
  });

  it('denies any transitions from cancelled', () => {
    expect(validateTaskTransition('cancelled', 'pending')).toBe(false);
    expect(validateTaskTransition('cancelled', 'in_progress')).toBe(false);
    expect(validateTaskTransition('cancelled', 'completed')).toBe(false);
    expect(validateTaskTransition('cancelled', 'failed')).toBe(false);
  });

  it('allows valid transitions from failed', () => {
    expect(validateTaskTransition('failed', 'pending')).toBe(true);
  });

  it('denies invalid transitions from failed', () => {
    expect(validateTaskTransition('failed', 'in_progress')).toBe(false);
    expect(validateTaskTransition('failed', 'completed')).toBe(false);
    expect(validateTaskTransition('failed', 'cancelled')).toBe(false);
  });
});

describe('createEmptyNamespaceState', () => {
  it('creates empty state with correct namespace', () => {
    const state = createEmptyNamespaceState('test-namespace');

    expect(state.namespace).toBe('test-namespace');
    expect(state.tasks).toEqual({});
    expect(state.agentRuns).toEqual({});
    expect(state.graph.adjacency).toEqual({});
    expect(state.graph.reverse).toEqual({});
    expect(state.schemaVersion).toBe(1);
    expect(state.updatedAt).toBeGreaterThan(0);
  });

  it('creates state with default namespace', () => {
    const state = createEmptyNamespaceState('default');

    expect(state.namespace).toBe('default');
  });

  it('creates state with empty string namespace', () => {
    const state = createEmptyNamespaceState('');

    expect(state.namespace).toBe('');
  });
});

describe('evaluateTaskCanStart', () => {
  const createTask = (overrides: Partial<TaskEntity> = {}): TaskEntity => ({
    id: 'task_1',
    subject: 'Test Task',
    description: 'Test description',
    activeForm: 'Testing',
    status: 'pending',
    priority: 'normal',
    owner: null,
    blockedBy: [],
    blocks: [],
    progress: 0,
    checkpoints: [],
    retryConfig: DEFAULT_RETRY_CONFIG,
    retryCount: 0,
    tags: [],
    metadata: {},
    history: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: 1,
    ...overrides,
  });

  it('allows pending task with no blockers to start', () => {
    const task = createTask();
    const result = evaluateTaskCanStart(task, {});

    expect(result.canStart).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('denies non-pending task', () => {
    const task = createTask({ status: 'in_progress' });
    const result = evaluateTaskCanStart(task, {});

    expect(result.canStart).toBe(false);
    expect(result.reason).toContain('Task status is in_progress');
  });

  it('denies task with owner', () => {
    const task = createTask({ owner: 'user_1' });
    const result = evaluateTaskCanStart(task, {});

    expect(result.canStart).toBe(false);
    expect(result.reason).toContain('Task is already owned by user_1');
  });

  it('denies task with incomplete blockers', () => {
    const task = createTask({ blockedBy: ['task_2'] });
    const allTasks: Record<string, TaskEntity> = {
      task_2: createTask({ id: 'task_2', status: 'in_progress' }),
    };

    const result = evaluateTaskCanStart(task, allTasks);

    expect(result.canStart).toBe(false);
    expect(result.reason).toContain('Blocked by incomplete dependencies');
    expect(result.reason).toContain('task_2');
  });

  it('denies task with cancelled blockers', () => {
    const task = createTask({ blockedBy: ['task_2'] });
    const allTasks: Record<string, TaskEntity> = {
      task_2: createTask({ id: 'task_2', status: 'cancelled' }),
    };

    const result = evaluateTaskCanStart(task, allTasks);

    expect(result.canStart).toBe(false);
    expect(result.reason).toContain('Blocked by cancelled/failed dependencies');
    expect(result.reason).toContain('task_2');
  });

  it('denies task with failed blockers', () => {
    const task = createTask({ blockedBy: ['task_2'] });
    const allTasks: Record<string, TaskEntity> = {
      task_2: createTask({ id: 'task_2', status: 'failed' }),
    };

    const result = evaluateTaskCanStart(task, allTasks);

    expect(result.canStart).toBe(false);
    expect(result.reason).toContain('Blocked by cancelled/failed dependencies');
    expect(result.reason).toContain('task_2');
  });

  it('allows task with completed blockers', () => {
    const task = createTask({ blockedBy: ['task_2'] });
    const allTasks: Record<string, TaskEntity> = {
      task_2: createTask({ id: 'task_2', status: 'completed' }),
    };

    const result = evaluateTaskCanStart(task, allTasks);

    expect(result.canStart).toBe(true);
  });

  it('denies task with non-existent blockers', () => {
    const task = createTask({ blockedBy: ['task_2'] });
    const allTasks: Record<string, TaskEntity> = {};

    const result = evaluateTaskCanStart(task, allTasks);

    expect(result.canStart).toBe(false);
    expect(result.reason).toContain('Blocked by incomplete dependencies');
    expect(result.reason).toContain('task_2');
  });

  it('handles multiple blockers', () => {
    const task = createTask({ blockedBy: ['task_2', 'task_3', 'task_4'] });
    const allTasks: Record<string, TaskEntity> = {
      task_2: createTask({ id: 'task_2', status: 'completed' }),
      task_3: createTask({ id: 'task_3', status: 'in_progress' }),
      task_4: createTask({ id: 'task_4', status: 'cancelled' }),
    };

    const result = evaluateTaskCanStart(task, allTasks);

    expect(result.canStart).toBe(false);
    expect(result.reason).toContain('Blocked by cancelled/failed dependencies');
    expect(result.reason).toContain('task_4');
  });

  it('handles mixed blocker statuses', () => {
    const task = createTask({ blockedBy: ['task_2', 'task_3'] });
    const allTasks: Record<string, TaskEntity> = {
      task_2: createTask({ id: 'task_2', status: 'completed' }),
      task_3: createTask({ id: 'task_3', status: 'pending' }),
    };

    const result = evaluateTaskCanStart(task, allTasks);

    expect(result.canStart).toBe(false);
    expect(result.reason).toContain('Blocked by incomplete dependencies');
    expect(result.reason).toContain('task_3');
  });
});

describe('safeJsonClone', () => {
  it('clones simple objects', () => {
    const obj = { a: 1, b: 'test', c: true };
    const cloned = safeJsonClone(obj);

    expect(cloned).toEqual(obj);
    expect(cloned).not.toBe(obj);
  });

  it('clones nested objects', () => {
    const obj = { a: { b: { c: 1 } } };
    const cloned = safeJsonClone(obj);

    expect(cloned).toEqual(obj);
    expect(cloned.a).not.toBe(obj.a);
    expect(cloned.a.b).not.toBe(obj.a.b);
  });

  it('clones arrays', () => {
    const arr = [1, 2, 3, { a: 4 }];
    const cloned = safeJsonClone(arr);

    expect(cloned).toEqual(arr);
    expect(cloned).not.toBe(arr);
    expect(cloned[3]).not.toBe(arr[3]);
  });

  it('clones null', () => {
    expect(safeJsonClone(null)).toBeNull();
  });

  it('throws for undefined', () => {
    // JSON.stringify(undefined) returns undefined (not a string)
    // JSON.parse(undefined) throws an error
    expect(() => safeJsonClone(undefined)).toThrow();
  });

  it('clones numbers', () => {
    expect(safeJsonClone(42)).toBe(42);
    expect(safeJsonClone(3.14)).toBe(3.14);
    expect(safeJsonClone(-1)).toBe(-1);
  });

  it('clones strings', () => {
    expect(safeJsonClone('test')).toBe('test');
    expect(safeJsonClone('')).toBe('');
  });

  it('clones booleans', () => {
    expect(safeJsonClone(true)).toBe(true);
    expect(safeJsonClone(false)).toBe(false);
  });

  it('handles Date objects', () => {
    const date = new Date('2024-01-01');
    const cloned = safeJsonClone(date);

    // Date objects are serialized as strings
    expect(typeof cloned).toBe('string');
  });

  it('handles circular references by throwing', () => {
    const obj: Record<string, unknown> = { a: 1 };
    obj.self = obj;

    expect(() => safeJsonClone(obj)).toThrow();
  });

  it('handles functions by omitting them', () => {
    const obj = { a: 1, fn: () => {} };
    const cloned = safeJsonClone(obj);

    expect(cloned).toEqual({ a: 1 });
  });

  it('handles symbols by omitting them', () => {
    const obj = { a: 1, [Symbol('test')]: 'value' };
    const cloned = safeJsonClone(obj);

    expect(cloned).toEqual({ a: 1 });
  });
});

import { describe, expect, it } from 'vitest';
import { buildTaskFailure, buildTaskSuccess, parsePrefixedError } from '../task-errors';
import {
  addDependencyEdge,
  ensureGraphNode,
  hasPath,
  removeDependencyEdge,
  wouldCreateCycle,
} from '../task-graph';
import {
  createAgentId,
  createEmptyNamespaceState,
  createTaskId,
  evaluateTaskCanStart,
  isAgentRunTerminal,
  isTaskFinal,
  isTaskTerminal,
  safeJsonClone,
  validateTaskTransition,
  type TaskEntity,
} from '../task-types';

function makeTask(overrides: Partial<TaskEntity> = {}): TaskEntity {
  const now = 1;
  return {
    id: overrides.id || 'task-x',
    subject: overrides.subject || 'Subject',
    description: overrides.description || 'Description long enough for validation.',
    activeForm: overrides.activeForm || 'Doing subject',
    status: overrides.status || 'pending',
    priority: overrides.priority || 'normal',
    owner: overrides.owner === undefined ? null : overrides.owner,
    blockedBy: overrides.blockedBy || [],
    blocks: overrides.blocks || [],
    progress: overrides.progress || 0,
    checkpoints: overrides.checkpoints || [],
    retryConfig: overrides.retryConfig || {
      maxRetries: 1,
      retryDelayMs: 1,
      backoffMultiplier: 1,
      retryOn: ['timeout'],
    },
    retryCount: overrides.retryCount || 0,
    lastError: overrides.lastError,
    lastErrorAt: overrides.lastErrorAt,
    timeoutMs: overrides.timeoutMs,
    tags: overrides.tags || [],
    metadata: overrides.metadata || {},
    history: overrides.history || [],
    agentId: overrides.agentId,
    createdAt: overrides.createdAt || now,
    updatedAt: overrides.updatedAt || now,
    startedAt: overrides.startedAt,
    completedAt: overrides.completedAt,
    cancelledAt: overrides.cancelledAt,
    version: overrides.version || 1,
  };
}

describe('task utility modules branch coverage', () => {
  it('covers task error builders and prefixed error parser fallback', () => {
    const failed = buildTaskFailure('TASK_X', 'something bad', { a: 1 });
    expect(failed.success).toBe(false);
    expect(failed.output).toContain('TASK_X: something bad');
    expect(failed.metadata).toMatchObject({
      error: 'TASK_X',
      message: 'something bad',
      a: 1,
    });

    const success = buildTaskSuccess({ ok: true, n: 2 });
    expect(success.success).toBe(true);
    expect(success.metadata).toMatchObject({ ok: true, n: 2 });

    expect(parsePrefixedError('TASK_ABC: fine detail')).toEqual({
      code: 'TASK_ABC',
      detail: 'fine detail',
    });
    expect(parsePrefixedError('plain failure message')).toEqual({
      code: 'TASK_OPERATION_FAILED',
      detail: 'plain failure message',
    });
  });

  it('covers dependency graph node/edge/path/cycle branches', () => {
    const graph = {
      adjacency: {} as Record<string, string[]>,
      reverse: {} as Record<string, string[]>,
    };

    ensureGraphNode(graph, 'a');
    ensureGraphNode(graph, 'a');
    expect(graph.adjacency.a).toEqual([]);
    expect(graph.reverse.a).toEqual([]);

    addDependencyEdge(graph, 'a', 'b');
    addDependencyEdge(graph, 'a', 'b');
    expect(graph.adjacency.a).toEqual(['b']);
    expect(graph.reverse.b).toEqual(['a']);

    addDependencyEdge(graph, 'a', 'c');
    addDependencyEdge(graph, 'b', 'd');
    addDependencyEdge(graph, 'c', 'd');
    expect(hasPath(graph, 'a', 'd')).toBe(true);
    expect(hasPath(graph, 'a', 'a')).toBe(true);
    expect(hasPath(graph, 'a', 'z')).toBe(false);
    expect(hasPath({ adjacency: {}, reverse: {} }, 'missing', 'target')).toBe(false);

    expect(wouldCreateCycle(graph, 'x', 'x')).toBe(true);
    expect(wouldCreateCycle(graph, 'd', 'a')).toBe(true);
    expect(wouldCreateCycle(graph, 'z', 'a')).toBe(false);

    removeDependencyEdge(graph, 'a', 'b');
    expect(graph.adjacency.a).toEqual(['c']);
    expect(graph.reverse.b).toEqual([]);
  });

  it('covers task type helpers and evaluateTaskCanStart branches', () => {
    expect(createTaskId()).toContain('task_');
    expect(createAgentId()).toContain('agent_');

    expect(isTaskTerminal('completed')).toBe(true);
    expect(isTaskTerminal('cancelled')).toBe(true);
    expect(isTaskTerminal('failed')).toBe(false);
    expect(isTaskFinal('failed')).toBe(true);
    expect(isAgentRunTerminal('timed_out')).toBe(true);
    expect(isAgentRunTerminal('paused')).toBe(false);

    expect(validateTaskTransition('pending', 'pending')).toBe(true);
    expect(validateTaskTransition('pending', 'in_progress')).toBe(true);
    expect(validateTaskTransition('pending', 'completed')).toBe(false);

    const ns = createEmptyNamespaceState('n1');
    expect(ns.namespace).toBe('n1');
    expect(ns.schemaVersion).toBe(1);
    expect(ns.tasks).toEqual({});

    const cloneSource = { x: { y: 1 } };
    const clone = safeJsonClone(cloneSource);
    clone.x.y = 99;
    expect(cloneSource.x.y).toBe(1);

    const nonPending = evaluateTaskCanStart(makeTask({ status: 'in_progress' }), {});
    expect(nonPending.canStart).toBe(false);
    expect(nonPending.reason).toContain('in_progress');

    const owned = evaluateTaskCanStart(makeTask({ owner: 'agent-1' }), {});
    expect(owned.canStart).toBe(false);
    expect(owned.reason).toContain('already owned');

    const blockerMap = {
      b1: makeTask({ id: 'b1', status: 'cancelled' }),
      b2: makeTask({ id: 'b2', status: 'failed' }),
      b3: makeTask({ id: 'b3', status: 'in_progress' }),
      b4: makeTask({ id: 'b4', status: 'completed' }),
    };
    const cancelledOrFailed = evaluateTaskCanStart(
      makeTask({ blockedBy: ['missing', 'b1', 'b2', 'b3', 'b4'] }),
      blockerMap
    );
    expect(cancelledOrFailed.canStart).toBe(false);
    expect(cancelledOrFailed.reason).toContain('cancelled/failed');
    expect(cancelledOrFailed.reason).toContain('b1');
    expect(cancelledOrFailed.reason).toContain('b2');

    const incomplete = evaluateTaskCanStart(makeTask({ blockedBy: ['missing', 'b3'] }), blockerMap);
    expect(incomplete.canStart).toBe(false);
    expect(incomplete.reason).toContain('incomplete dependencies');
    expect(incomplete.reason).toContain('missing');
    expect(incomplete.reason).toContain('b3');

    const canStart = evaluateTaskCanStart(makeTask({ blockedBy: ['b4'] }), blockerMap);
    expect(canStart).toEqual({ canStart: true });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { buildExecutionWaves, runWithConcurrencyAndLock } from '../concurrency';
import type { ToolCall } from '../../../providers';
import type { ToolConcurrencyPolicy } from '../../tool/types';

function createToolCall(name: string, id: string = `call_${name}`): ToolCall {
  return {
    id,
    type: 'function',
    index: 0,
    function: {
      name,
      arguments: '{}',
    },
  };
}

function createPlan(
  toolCall: ToolCall,
  mode: ToolConcurrencyPolicy['mode'] = 'exclusive',
  lockKey?: string
): { toolCall: ToolCall; policy: ToolConcurrencyPolicy } {
  return {
    toolCall,
    policy: { mode, lockKey },
  };
}

describe('buildExecutionWaves', () => {
  it('returns empty array for empty input', () => {
    expect(buildExecutionWaves([])).toEqual([]);
  });

  it('creates exclusive wave for single exclusive plan', () => {
    const plan = createPlan(createToolCall('bash'));
    const waves = buildExecutionWaves([plan]);

    expect(waves).toHaveLength(1);
    expect(waves[0].type).toBe('exclusive');
    expect(waves[0].plans).toHaveLength(1);
    expect(waves[0].plans[0]).toBe(plan);
  });

  it('creates parallel wave for single parallel-safe plan', () => {
    const plan = createPlan(createToolCall('file_read'), 'parallel-safe');
    const waves = buildExecutionWaves([plan]);

    expect(waves).toHaveLength(1);
    expect(waves[0].type).toBe('parallel');
    expect(waves[0].plans).toHaveLength(1);
    expect(waves[0].plans[0]).toBe(plan);
  });

  it('groups consecutive parallel-safe plans into single wave', () => {
    const plans = [
      createPlan(createToolCall('file_read'), 'parallel-safe'),
      createPlan(createToolCall('glob'), 'parallel-safe'),
      createPlan(createToolCall('grep'), 'parallel-safe'),
    ];

    const waves = buildExecutionWaves(plans);

    expect(waves).toHaveLength(1);
    expect(waves[0].type).toBe('parallel');
    expect(waves[0].plans).toHaveLength(3);
  });

  it('creates separate waves for exclusive plans', () => {
    const plans = [
      createPlan(createToolCall('bash'), 'exclusive'),
      createPlan(createToolCall('write_file'), 'exclusive'),
    ];

    const waves = buildExecutionWaves(plans);

    expect(waves).toHaveLength(2);
    expect(waves[0].type).toBe('exclusive');
    expect(waves[1].type).toBe('exclusive');
  });

  it('creates mixed waves correctly', () => {
    const plans = [
      createPlan(createToolCall('file_read'), 'parallel-safe'),
      createPlan(createToolCall('bash'), 'exclusive'),
      createPlan(createToolCall('glob'), 'parallel-safe'),
      createPlan(createToolCall('grep'), 'parallel-safe'),
      createPlan(createToolCall('write_file'), 'exclusive'),
    ];

    const waves = buildExecutionWaves(plans);

    expect(waves).toHaveLength(4);
    expect(waves[0].type).toBe('parallel');
    expect(waves[0].plans).toHaveLength(1);
    expect(waves[1].type).toBe('exclusive');
    expect(waves[1].plans).toHaveLength(1);
    expect(waves[2].type).toBe('parallel');
    expect(waves[2].plans).toHaveLength(2);
    expect(waves[3].type).toBe('exclusive');
    expect(waves[3].plans).toHaveLength(1);
  });

  it('handles parallel-safe with lock keys', () => {
    const plans = [
      createPlan(createToolCall('file_read'), 'parallel-safe', 'file:read'),
      createPlan(createToolCall('file_read'), 'parallel-safe', 'file:read'),
      createPlan(createToolCall('file_read'), 'parallel-safe', 'file:write'),
    ];

    const waves = buildExecutionWaves(plans);

    expect(waves).toHaveLength(1);
    expect(waves[0].type).toBe('parallel');
    expect(waves[0].plans).toHaveLength(3);
  });
});

describe('runWithConcurrencyAndLock', () => {
  it('returns empty array for empty tasks', async () => {
    const result = await runWithConcurrencyAndLock([], 5);
    expect(result).toEqual([]);
  });

  it('runs single task successfully', async () => {
    const task = { run: vi.fn().mockResolvedValue('result') };
    const result = await runWithConcurrencyAndLock([task], 5);

    expect(result).toEqual(['result']);
    expect(task.run).toHaveBeenCalledOnce();
  });

  it('runs multiple tasks concurrently within limit', async () => {
    const executionOrder: string[] = [];
    const tasks = [
      {
        run: vi.fn().mockImplementation(async () => {
          executionOrder.push('task1-start');
          await new Promise((resolve) => setTimeout(resolve, 10));
          executionOrder.push('task1-end');
          return 'result1';
        }),
      },
      {
        run: vi.fn().mockImplementation(async () => {
          executionOrder.push('task2-start');
          await new Promise((resolve) => setTimeout(resolve, 5));
          executionOrder.push('task2-end');
          return 'result2';
        }),
      },
      {
        run: vi.fn().mockImplementation(async () => {
          executionOrder.push('task3-start');
          await new Promise((resolve) => setTimeout(resolve, 15));
          executionOrder.push('task3-end');
          return 'result3';
        }),
      },
    ];

    const result = await runWithConcurrencyAndLock(tasks, 2);

    expect(result).toEqual(['result1', 'result2', 'result3']);
    expect(executionOrder).toContain('task1-start');
    expect(executionOrder).toContain('task2-start');
    expect(executionOrder).toContain('task3-start');
  });

  it('respects lock keys', async () => {
    const executionOrder: string[] = [];
    const tasks = [
      {
        lockKey: 'resource:1',
        run: vi.fn().mockImplementation(async () => {
          executionOrder.push('task1-start');
          await new Promise((resolve) => setTimeout(resolve, 20));
          executionOrder.push('task1-end');
          return 'result1';
        }),
      },
      {
        lockKey: 'resource:1',
        run: vi.fn().mockImplementation(async () => {
          executionOrder.push('task2-start');
          await new Promise((resolve) => setTimeout(resolve, 10));
          executionOrder.push('task2-end');
          return 'result2';
        }),
      },
      {
        lockKey: 'resource:2',
        run: vi.fn().mockImplementation(async () => {
          executionOrder.push('task3-start');
          await new Promise((resolve) => setTimeout(resolve, 5));
          executionOrder.push('task3-end');
          return 'result3';
        }),
      },
    ];

    const result = await runWithConcurrencyAndLock(tasks, 3);

    expect(result).toEqual(['result1', 'result2', 'result3']);
    // Tasks with same lock key should not run concurrently
    const task1End = executionOrder.indexOf('task1-end');
    const task2Start = executionOrder.indexOf('task2-start');

    // Task2 should start after task1 ends (same lock key)
    expect(task2Start).toBeGreaterThan(task1End);
  });

  it('handles task failure', async () => {
    const error = new Error('Task failed');
    const tasks = [
      { run: vi.fn().mockResolvedValue('success') },
      { run: vi.fn().mockRejectedValue(error) },
    ];

    await expect(runWithConcurrencyAndLock(tasks, 2)).rejects.toThrow('Task failed');
  });

  it('handles concurrent limit of 1', async () => {
    const executionOrder: string[] = [];
    const tasks = [
      {
        run: vi.fn().mockImplementation(async () => {
          executionOrder.push('task1');
          return 'result1';
        }),
      },
      {
        run: vi.fn().mockImplementation(async () => {
          executionOrder.push('task2');
          return 'result2';
        }),
      },
    ];

    const result = await runWithConcurrencyAndLock(tasks, 1);

    expect(result).toEqual(['result1', 'result2']);
    expect(executionOrder).toEqual(['task1', 'task2']);
  });

  it('handles tasks without lock keys', async () => {
    const tasks = [
      { run: vi.fn().mockResolvedValue('result1') },
      { run: vi.fn().mockResolvedValue('result2') },
      { run: vi.fn().mockResolvedValue('result3') },
    ];

    const result = await runWithConcurrencyAndLock(tasks, 2);

    expect(result).toEqual(['result1', 'result2', 'result3']);
  });

  it('handles mixed lock keys and no lock keys', async () => {
    const executionOrder: string[] = [];
    const tasks = [
      {
        lockKey: 'resource:1',
        run: vi.fn().mockImplementation(async () => {
          executionOrder.push('task1');
          return 'result1';
        }),
      },
      {
        run: vi.fn().mockImplementation(async () => {
          executionOrder.push('task2');
          return 'result2';
        }),
      },
      {
        lockKey: 'resource:1',
        run: vi.fn().mockImplementation(async () => {
          executionOrder.push('task3');
          return 'result3';
        }),
      },
    ];

    const result = await runWithConcurrencyAndLock(tasks, 3);

    expect(result).toEqual(['result1', 'result2', 'result3']);
    // Task3 should wait for task1 to complete (same lock key)
    const task1Index = executionOrder.indexOf('task1');
    const task3Index = executionOrder.indexOf('task3');
    expect(task3Index).toBeGreaterThan(task1Index);
  });
});

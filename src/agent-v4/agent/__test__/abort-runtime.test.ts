import { describe, expect, it, vi } from 'vitest';
import { TimeoutBudgetExceededError } from '../error';
import {
  normalizeTimeoutBudgetError,
  sleepWithAbort,
  throwIfAborted,
  timeoutBudgetErrorFromSignal,
} from '../abort-runtime';

describe('abort-runtime', () => {
  it('returns timeout budget error from aborted signal reason', () => {
    const controller = new AbortController();
    controller.abort({
      type: 'agent-timeout-budget',
      stage: 'llm',
      message: 'Timeout budget exceeded at llm stage',
    });

    const err = timeoutBudgetErrorFromSignal(controller.signal);
    expect(err).toBeInstanceOf(TimeoutBudgetExceededError);
    expect(err?.message).toContain('llm stage');
  });

  it('normalizes timeout budget error from either explicit error or signal reason', () => {
    const explicit = new TimeoutBudgetExceededError('explicit');
    expect(normalizeTimeoutBudgetError(explicit, undefined)).toBe(explicit);

    const controller = new AbortController();
    controller.abort({
      type: 'agent-timeout-budget',
      stage: 'tool',
      message: 'Timeout budget exceeded at tool stage',
    });
    const normalized = normalizeTimeoutBudgetError(new Error('other'), controller.signal);
    expect(normalized).toBeInstanceOf(TimeoutBudgetExceededError);
    expect(normalized?.message).toContain('tool stage');
  });

  it('throwIfAborted throws AbortError when signal is aborted without budget reason', () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => throwIfAborted(controller.signal, 'Operation aborted')).toThrowError('Operation aborted');
  });

  it('throwIfAborted throws TimeoutBudgetExceededError when budget reason exists', () => {
    const controller = new AbortController();
    controller.abort({
      type: 'agent-timeout-budget',
      stage: 'total',
      message: 'Timeout budget exceeded at execution stage',
    });
    expect(() => throwIfAborted(controller.signal, 'Operation aborted')).toThrow(TimeoutBudgetExceededError);
  });

  it('sleepWithAbort resolves for non-positive delay and rejects on abort', async () => {
    await expect(sleepWithAbort(0)).resolves.toBeUndefined();
    await expect(sleepWithAbort(-1)).resolves.toBeUndefined();

    const preAborted = new AbortController();
    preAborted.abort();
    await expect(sleepWithAbort(10, preAborted.signal, 'Operation aborted')).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Operation aborted',
    });
  });

  it('sleepWithAbort rejects when aborted during wait', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const promise = sleepWithAbort(100, controller.signal, 'Operation aborted');
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    await expect(promise).rejects.toMatchObject({
      name: 'AbortError',
      message: 'Operation aborted',
    });
    vi.useRealTimers();
  });
});

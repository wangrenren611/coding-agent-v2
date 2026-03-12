import { describe, expect, it } from 'vitest';
import {
  createTimeoutBudgetState,
  createExecutionAbortScope,
  createStageAbortScope,
  combineAbortSignals,
  getAbortReason,
  getTotalRemainingBudgetMs,
  consumeStageBudget,
  createTimeoutBudgetReason,
  isTimeoutBudgetReason,
  timeoutBudgetReasonFromSignal,
} from '../timeout-budget';

describe('createTimeoutBudgetState', () => {
  it('returns undefined when no valid timeout is provided', () => {
    const result = createTimeoutBudgetState({
      inputTimeoutBudgetMs: undefined,
      configTimeoutBudgetMs: undefined,
      inputLlmTimeoutRatio: 0.5,
      configLlmTimeoutRatio: 0.7,
    });

    expect(result).toBeUndefined();
  });

  it('returns undefined when timeout is zero or negative', () => {
    // When inputTimeoutBudgetMs is 0, it should use configTimeoutBudgetMs
    const result1 = createTimeoutBudgetState({
      inputTimeoutBudgetMs: 0,
      configTimeoutBudgetMs: 1000,
      inputLlmTimeoutRatio: 0.5,
      configLlmTimeoutRatio: 0.7,
    });
    expect(result1).toBeDefined();
    expect(result1!.totalMs).toBe(1000);

    // When inputTimeoutBudgetMs is negative, it should use configTimeoutBudgetMs
    const result2 = createTimeoutBudgetState({
      inputTimeoutBudgetMs: -100,
      configTimeoutBudgetMs: 1000,
      inputLlmTimeoutRatio: 0.5,
      configLlmTimeoutRatio: 0.7,
    });
    expect(result2).toBeDefined();
    expect(result2!.totalMs).toBe(1000);

    // When both are invalid, return undefined
    expect(
      createTimeoutBudgetState({
        inputTimeoutBudgetMs: 0,
        configTimeoutBudgetMs: 0,
        inputLlmTimeoutRatio: 0.5,
        configLlmTimeoutRatio: 0.7,
      })
    ).toBeUndefined();
  });

  it('uses input timeout when provided', () => {
    const result = createTimeoutBudgetState({
      inputTimeoutBudgetMs: 5000,
      configTimeoutBudgetMs: 10000,
      inputLlmTimeoutRatio: 0.6,
      configLlmTimeoutRatio: 0.7,
    });

    expect(result).toBeDefined();
    expect(result!.totalMs).toBe(5000);
    expect(result!.llmRemainingMs).toBe(3000); // 5000 * 0.6
    expect(result!.toolRemainingMs).toBe(2000); // 5000 - 3000
  });

  it('uses config timeout when input is invalid', () => {
    const result = createTimeoutBudgetState({
      inputTimeoutBudgetMs: NaN,
      configTimeoutBudgetMs: 10000,
      inputLlmTimeoutRatio: NaN,
      configLlmTimeoutRatio: 0.7,
    });

    expect(result).toBeDefined();
    expect(result!.totalMs).toBe(10000);
    // When inputLlmTimeoutRatio is NaN, it should use configLlmTimeoutRatio (0.7)
    expect(result!.llmRemainingMs).toBe(7000); // 10000 * 0.7
    expect(result!.toolRemainingMs).toBe(3000); // 10000 - 7000
  });

  it('clamps ratio between 0.05 and 0.95', () => {
    const result1 = createTimeoutBudgetState({
      inputTimeoutBudgetMs: 10000,
      configTimeoutBudgetMs: 10000,
      inputLlmTimeoutRatio: 0.01, // below minimum
      configLlmTimeoutRatio: 0.7,
    });

    expect(result1!.llmRemainingMs).toBe(500); // 10000 * 0.05 (clamped)

    const result2 = createTimeoutBudgetState({
      inputTimeoutBudgetMs: 10000,
      configTimeoutBudgetMs: 10000,
      inputLlmTimeoutRatio: 0.99, // above maximum
      configLlmTimeoutRatio: 0.7,
    });

    expect(result2!.llmRemainingMs).toBe(9500); // 10000 * 0.95 (clamped)
  });

  it('uses config ratio when input ratio is invalid', () => {
    const result = createTimeoutBudgetState({
      inputTimeoutBudgetMs: 10000,
      configTimeoutBudgetMs: 10000,
      inputLlmTimeoutRatio: NaN,
      configLlmTimeoutRatio: 0.8,
    });

    expect(result!.llmRemainingMs).toBe(8000); // 10000 * 0.8
  });

  it('ensures minimum llm remaining of 1ms', () => {
    const result = createTimeoutBudgetState({
      inputTimeoutBudgetMs: 10,
      configTimeoutBudgetMs: 10,
      inputLlmTimeoutRatio: 0.05,
      configLlmTimeoutRatio: 0.7,
    });

    expect(result!.llmRemainingMs).toBe(1); // minimum 1ms
    expect(result!.toolRemainingMs).toBe(9); // 10 - 1
  });
});

describe('getTotalRemainingBudgetMs', () => {
  it('returns remaining time correctly', () => {
    const budget = {
      totalMs: 10000,
      startedAt: Date.now() - 2000, // 2 seconds ago
      llmRemainingMs: 7000,
      toolRemainingMs: 3000,
    };

    const remaining = getTotalRemainingBudgetMs(budget);
    expect(remaining).toBeLessThanOrEqual(8000);
    expect(remaining).toBeGreaterThan(7900);
  });

  it('returns 0 when budget is exhausted', () => {
    const budget = {
      totalMs: 1000,
      startedAt: Date.now() - 2000, // 2 seconds ago
      llmRemainingMs: 700,
      toolRemainingMs: 300,
    };

    const remaining = getTotalRemainingBudgetMs(budget);
    expect(remaining).toBe(0);
  });
});

describe('consumeStageBudget', () => {
  it('consumes llm budget correctly', () => {
    const budget = {
      totalMs: 10000,
      startedAt: Date.now(),
      llmRemainingMs: 5000,
      toolRemainingMs: 5000,
    };

    consumeStageBudget(budget, 'llm', 1000);
    expect(budget.llmRemainingMs).toBe(4000);
    expect(budget.toolRemainingMs).toBe(5000);
  });

  it('consumes tool budget correctly', () => {
    const budget = {
      totalMs: 10000,
      startedAt: Date.now(),
      llmRemainingMs: 5000,
      toolRemainingMs: 5000,
    };

    consumeStageBudget(budget, 'tool', 2000);
    expect(budget.llmRemainingMs).toBe(5000);
    expect(budget.toolRemainingMs).toBe(3000);
  });

  it('does not go below zero', () => {
    const budget = {
      totalMs: 10000,
      startedAt: Date.now(),
      llmRemainingMs: 1000,
      toolRemainingMs: 1000,
    };

    consumeStageBudget(budget, 'llm', 2000);
    expect(budget.llmRemainingMs).toBe(0);
  });

  it('handles negative elapsed time', () => {
    const budget = {
      totalMs: 10000,
      startedAt: Date.now(),
      llmRemainingMs: 5000,
      toolRemainingMs: 5000,
    };

    consumeStageBudget(budget, 'llm', -1000);
    expect(budget.llmRemainingMs).toBe(5000); // no change
  });
});

describe('createTimeoutBudgetReason', () => {
  it('creates reason for total stage', () => {
    const reason = createTimeoutBudgetReason('total', 5000);

    expect(reason.type).toBe('agent-timeout-budget');
    expect(reason.stage).toBe('total');
    expect(reason.message).toContain('execution');
    expect(reason.message).toContain('5000');
  });

  it('creates reason for llm stage', () => {
    const reason = createTimeoutBudgetReason('llm', 3000);

    expect(reason.type).toBe('agent-timeout-budget');
    expect(reason.stage).toBe('llm');
    expect(reason.message).toContain('llm');
    expect(reason.message).toContain('3000');
  });

  it('creates reason for tool stage', () => {
    const reason = createTimeoutBudgetReason('tool', 2000);

    expect(reason.type).toBe('agent-timeout-budget');
    expect(reason.stage).toBe('tool');
    expect(reason.message).toContain('tool');
    expect(reason.message).toContain('2000');
  });
});

describe('isTimeoutBudgetReason', () => {
  it('returns true for valid timeout budget reason', () => {
    const reason = {
      type: 'agent-timeout-budget',
      stage: 'total',
      message: 'Timeout budget exceeded',
    };

    expect(isTimeoutBudgetReason(reason)).toBe(true);
  });

  it('returns false for invalid objects', () => {
    expect(isTimeoutBudgetReason(null)).toBe(false);
    expect(isTimeoutBudgetReason(undefined)).toBe(false);
    expect(isTimeoutBudgetReason('string')).toBe(false);
    expect(isTimeoutBudgetReason(123)).toBe(false);
    expect(isTimeoutBudgetReason({})).toBe(false);
    expect(isTimeoutBudgetReason({ type: 'other' })).toBe(false);
    expect(isTimeoutBudgetReason({ type: 'agent-timeout-budget' })).toBe(false);
    expect(isTimeoutBudgetReason({ type: 'agent-timeout-budget', stage: 123 })).toBe(false);
  });
});

describe('getAbortReason', () => {
  it('returns reason from aborted signal', () => {
    const controller = new AbortController();
    const reason = { custom: 'reason' };
    controller.abort(reason);

    expect(getAbortReason(controller.signal)).toBe(reason);
  });

  it('returns undefined for non-aborted signal', () => {
    const controller = new AbortController();
    expect(getAbortReason(controller.signal)).toBeUndefined();
  });
});

describe('combineAbortSignals', () => {
  it('returns undefined signal when both are undefined', () => {
    const scope = combineAbortSignals(undefined, undefined);
    expect(scope.signal).toBeUndefined();
    expect(typeof scope.release).toBe('function');
  });

  it('returns primary signal when secondary is undefined', () => {
    const controller = new AbortController();
    const scope = combineAbortSignals(controller.signal, undefined);

    expect(scope.signal).toBe(controller.signal);
  });

  it('returns secondary signal when primary is undefined', () => {
    const controller = new AbortController();
    const scope = combineAbortSignals(undefined, controller.signal);

    expect(scope.signal).toBe(controller.signal);
  });

  it('combines two signals correctly', () => {
    const controller1 = new AbortController();
    const controller2 = new AbortController();
    const scope = combineAbortSignals(controller1.signal, controller2.signal);

    expect(scope.signal).toBeDefined();
    expect(scope.signal!.aborted).toBe(false);

    controller1.abort();
    expect(scope.signal!.aborted).toBe(true);
  });

  it('handles already aborted primary signal', () => {
    const controller1 = new AbortController();
    const controller2 = new AbortController();
    controller1.abort();

    const scope = combineAbortSignals(controller1.signal, controller2.signal);
    expect(scope.signal!.aborted).toBe(true);
  });

  it('handles already aborted secondary signal', () => {
    const controller1 = new AbortController();
    const controller2 = new AbortController();
    controller2.abort();

    const scope = combineAbortSignals(controller1.signal, controller2.signal);
    expect(scope.signal!.aborted).toBe(true);
  });

  it('release function removes event listeners', () => {
    const controller1 = new AbortController();
    const controller2 = new AbortController();
    const scope = combineAbortSignals(controller1.signal, controller2.signal);

    // Should not throw
    expect(() => scope.release()).not.toThrow();
  });
});

describe('timeoutBudgetReasonFromSignal', () => {
  it('returns reason for aborted signal with timeout budget reason', () => {
    const controller = new AbortController();
    const reason = createTimeoutBudgetReason('total', 5000);
    controller.abort(reason);

    const result = timeoutBudgetReasonFromSignal(controller.signal);
    expect(result).toBe(reason);
  });

  it('returns undefined for non-aborted signal', () => {
    const controller = new AbortController();
    expect(timeoutBudgetReasonFromSignal(controller.signal)).toBeUndefined();
  });

  it('returns undefined for aborted signal with non-timeout reason', () => {
    const controller = new AbortController();
    controller.abort('custom reason');

    expect(timeoutBudgetReasonFromSignal(controller.signal)).toBeUndefined();
  });

  it('returns undefined for undefined signal', () => {
    expect(timeoutBudgetReasonFromSignal(undefined)).toBeUndefined();
  });
});

describe('createExecutionAbortScope', () => {
  it('returns input signal when no timeout budget', () => {
    const controller = new AbortController();
    const scope = createExecutionAbortScope(controller.signal, undefined);

    expect(scope.signal).toBe(controller.signal);
  });

  it('creates combined scope with timeout budget', () => {
    const budget = {
      totalMs: 1000,
      startedAt: Date.now(),
      llmRemainingMs: 700,
      toolRemainingMs: 300,
    };

    const scope = createExecutionAbortScope(undefined, budget);

    expect(scope.signal).toBeDefined();
    expect(scope.signal!.aborted).toBe(false);

    // Should abort after timeout
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(scope.signal!.aborted).toBe(true);
        scope.release();
        resolve();
      }, 1100);
    });
  });

  it('combines input signal with timeout', () => {
    const controller = new AbortController();
    const budget = {
      totalMs: 1000,
      startedAt: Date.now(),
      llmRemainingMs: 700,
      toolRemainingMs: 300,
    };

    const scope = createExecutionAbortScope(controller.signal, budget);

    expect(scope.signal).toBeDefined();

    // Abort via input signal
    controller.abort();
    expect(scope.signal!.aborted).toBe(true);
  });
});

describe('createStageAbortScope', () => {
  it('returns base signal when no timeout budget', () => {
    const controller = new AbortController();
    const scope = createStageAbortScope(controller.signal, undefined, 'llm');

    expect(scope.signal).toBe(controller.signal);
  });

  it('creates scope for llm stage', () => {
    const budget = {
      totalMs: 10000,
      startedAt: Date.now(),
      llmRemainingMs: 5000,
      toolRemainingMs: 5000,
    };

    const scope = createStageAbortScope(undefined, budget, 'llm');

    expect(scope.signal).toBeDefined();
    expect(scope.signal!.aborted).toBe(false);
  });

  it('creates scope for tool stage', () => {
    const budget = {
      totalMs: 10000,
      startedAt: Date.now(),
      llmRemainingMs: 5000,
      toolRemainingMs: 5000,
    };

    const scope = createStageAbortScope(undefined, budget, 'tool');

    expect(scope.signal).toBeDefined();
    expect(scope.signal!.aborted).toBe(false);
  });

  it('handles exhausted stage budget', () => {
    const budget = {
      totalMs: 10000,
      startedAt: Date.now(),
      llmRemainingMs: 0,
      toolRemainingMs: 5000,
    };

    const scope = createStageAbortScope(undefined, budget, 'llm');

    expect(scope.signal).toBeDefined();
    expect(scope.signal!.aborted).toBe(true);
  });

  it('uses minimum of stage and total remaining', () => {
    const budget = {
      totalMs: 10000,
      startedAt: Date.now() - 8000, // 8 seconds ago
      llmRemainingMs: 5000,
      toolRemainingMs: 5000,
    };

    const scope = createStageAbortScope(undefined, budget, 'llm');

    expect(scope.signal).toBeDefined();
    // Should use total remaining (2000ms) instead of stage remaining (5000ms)
  });
});

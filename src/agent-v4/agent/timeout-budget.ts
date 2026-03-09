export type TimeoutStage = 'llm' | 'tool';

export interface TimeoutBudgetState {
  totalMs: number;
  startedAt: number;
  llmRemainingMs: number;
  toolRemainingMs: number;
}

export interface TimeoutBudgetReason {
  type: 'agent-timeout-budget';
  stage: 'total' | TimeoutStage;
  message: string;
}

export interface AbortScope {
  signal?: AbortSignal;
  release: () => void;
}

export function getAbortReason(signal: AbortSignal): unknown {
  return (signal as AbortSignal & { reason?: unknown }).reason;
}

export function combineAbortSignals(primary?: AbortSignal, secondary?: AbortSignal): AbortScope {
  if (!primary && !secondary) {
    return { signal: undefined, release: () => undefined };
  }
  if (!primary || primary === secondary) {
    return { signal: secondary || primary, release: () => undefined };
  }
  if (!secondary) {
    return { signal: primary, release: () => undefined };
  }

  const controller = new AbortController();
  const abortFromPrimary = () => {
    if (!controller.signal.aborted) {
      controller.abort(getAbortReason(primary));
    }
  };
  const abortFromSecondary = () => {
    if (!controller.signal.aborted) {
      controller.abort(getAbortReason(secondary));
    }
  };

  if (primary.aborted) {
    abortFromPrimary();
  } else {
    primary.addEventListener('abort', abortFromPrimary, { once: true });
  }

  if (secondary.aborted) {
    abortFromSecondary();
  } else {
    secondary.addEventListener('abort', abortFromSecondary, { once: true });
  }

  return {
    signal: controller.signal,
    release: () => {
      primary.removeEventListener('abort', abortFromPrimary);
      secondary.removeEventListener('abort', abortFromSecondary);
    },
  };
}

export function getTotalRemainingBudgetMs(timeoutBudget: TimeoutBudgetState): number {
  const elapsed = Date.now() - timeoutBudget.startedAt;
  return Math.max(0, timeoutBudget.totalMs - elapsed);
}

export function consumeStageBudget(
  timeoutBudget: TimeoutBudgetState,
  stage: TimeoutStage,
  elapsedMs: number
): void {
  const consumed = Math.max(0, Math.floor(elapsedMs));
  if (stage === 'llm') {
    timeoutBudget.llmRemainingMs = Math.max(0, timeoutBudget.llmRemainingMs - consumed);
    return;
  }
  timeoutBudget.toolRemainingMs = Math.max(0, timeoutBudget.toolRemainingMs - consumed);
}

export function createTimeoutBudgetReason(
  stage: 'total' | TimeoutStage,
  budgetMs: number
): TimeoutBudgetReason {
  const stageLabel = stage === 'total' ? 'execution' : stage;
  return {
    type: 'agent-timeout-budget',
    stage,
    message: `Timeout budget exceeded at ${stageLabel} stage (budgetMs=${budgetMs})`,
  };
}

export function isTimeoutBudgetReason(value: unknown): value is TimeoutBudgetReason {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const reason = value as { type?: string; stage?: string; message?: string };
  return (
    reason.type === 'agent-timeout-budget' &&
    typeof reason.stage === 'string' &&
    typeof reason.message === 'string'
  );
}

export function timeoutBudgetReasonFromSignal(signal: AbortSignal | undefined): TimeoutBudgetReason | undefined {
  if (!signal?.aborted) {
    return undefined;
  }
  const reason = getAbortReason(signal);
  if (!isTimeoutBudgetReason(reason)) {
    return undefined;
  }
  return reason;
}

export function createTimeoutBudgetState(options: {
  inputTimeoutBudgetMs?: number;
  configTimeoutBudgetMs?: number;
  inputLlmTimeoutRatio?: number;
  configLlmTimeoutRatio: number;
}): TimeoutBudgetState | undefined {
  const configuredTotal =
    options.inputTimeoutBudgetMs &&
    Number.isFinite(options.inputTimeoutBudgetMs) &&
    options.inputTimeoutBudgetMs > 0
      ? Math.floor(options.inputTimeoutBudgetMs)
      : options.configTimeoutBudgetMs;

  if (!configuredTotal || configuredTotal <= 0) {
    return undefined;
  }

  const ratioValue = Number.isFinite(options.inputLlmTimeoutRatio)
    ? Number(options.inputLlmTimeoutRatio)
    : options.configLlmTimeoutRatio;
  const ratio = Math.min(0.95, Math.max(0.05, ratioValue));
  const llmRemainingMs = Math.max(1, Math.floor(configuredTotal * ratio));
  const toolRemainingMs = Math.max(0, configuredTotal - llmRemainingMs);

  return {
    totalMs: configuredTotal,
    startedAt: Date.now(),
    llmRemainingMs,
    toolRemainingMs,
  };
}

export function createExecutionAbortScope(
  inputAbortSignal: AbortSignal | undefined,
  timeoutBudget: TimeoutBudgetState | undefined
): AbortScope {
  if (!timeoutBudget) {
    return {
      signal: inputAbortSignal,
      release: () => undefined,
    };
  }

  const timeoutController = new AbortController();
  const timer = setTimeout(() => {
    timeoutController.abort(createTimeoutBudgetReason('total', timeoutBudget.totalMs));
  }, timeoutBudget.totalMs);

  const combinedScope = combineAbortSignals(inputAbortSignal, timeoutController.signal);
  return {
    signal: combinedScope.signal,
    release: () => {
      clearTimeout(timer);
      combinedScope.release();
    },
  };
}

export function createStageAbortScope(
  baseSignal: AbortSignal | undefined,
  timeoutBudget: TimeoutBudgetState | undefined,
  stage: TimeoutStage
): AbortScope {
  if (!timeoutBudget) {
    return {
      signal: baseSignal,
      release: () => undefined,
    };
  }

  const remainingStageMs =
    stage === 'llm' ? timeoutBudget.llmRemainingMs : timeoutBudget.toolRemainingMs;
  const remainingTotalMs = getTotalRemainingBudgetMs(timeoutBudget);
  const allowedStageMs = Math.min(remainingStageMs, remainingTotalMs);
  const startedAt = Date.now();

  if (allowedStageMs <= 0) {
    const exhaustedController = new AbortController();
    exhaustedController.abort(createTimeoutBudgetReason(stage, 0));
    const exhaustedScope = combineAbortSignals(baseSignal, exhaustedController.signal);
    return {
      signal: exhaustedScope.signal,
      release: () => {
        exhaustedScope.release();
        consumeStageBudget(timeoutBudget, stage, Date.now() - startedAt);
      },
    };
  }

  const stageController = new AbortController();
  const timer = setTimeout(() => {
    stageController.abort(createTimeoutBudgetReason(stage, allowedStageMs));
  }, allowedStageMs);
  const mergedScope = combineAbortSignals(baseSignal, stageController.signal);

  return {
    signal: mergedScope.signal,
    release: () => {
      clearTimeout(timer);
      mergedScope.release();
      consumeStageBudget(timeoutBudget, stage, Date.now() - startedAt);
    },
  };
}

import { TimeoutBudgetExceededError } from './error';
import { timeoutBudgetReasonFromSignal } from './timeout-budget';

export function timeoutBudgetErrorFromSignal(
  signal: AbortSignal | undefined
): TimeoutBudgetExceededError | undefined {
  const reason = timeoutBudgetReasonFromSignal(signal);
  if (!reason) {
    return undefined;
  }
  return new TimeoutBudgetExceededError(reason.message);
}

export function normalizeTimeoutBudgetError(
  error: unknown,
  signal: AbortSignal | undefined
): TimeoutBudgetExceededError | undefined {
  if (error instanceof TimeoutBudgetExceededError) {
    return error;
  }
  return timeoutBudgetErrorFromSignal(signal);
}

export function throwIfAborted(signal: AbortSignal | undefined, abortedMessage: string): void {
  if (!signal?.aborted) {
    return;
  }
  const timeoutError = timeoutBudgetErrorFromSignal(signal);
  if (timeoutError) {
    throw timeoutError;
  }
  const error = new Error(abortedMessage);
  error.name = 'AbortError';
  throw error;
}

export async function sleepWithAbort(
  ms: number,
  signal?: AbortSignal,
  abortedMessage = 'Operation aborted'
): Promise<void> {
  if (ms <= 0) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      clearTimeout(timer);
      const err = new Error(abortedMessage);
      err.name = 'AbortError';
      reject(err);
    };

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

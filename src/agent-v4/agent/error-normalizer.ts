import { calculateBackoff, LLMRetryableError } from '../../providers';
import type { BackoffConfig } from '../../providers';
import {
  AgentAbortedError,
  AgentError,
  ConfirmationTimeoutError,
  UnknownError,
} from './error';

export function isAbortError(error: unknown, abortedMessage: string): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const abortError = error as { name?: string; message?: string };
  return abortError.name === 'AbortError' || abortError.message === abortedMessage;
}

export function normalizeError(error: unknown, abortedMessage: string): AgentError {
  if (error instanceof AgentError) {
    return error;
  }

  if (isAbortError(error, abortedMessage)) {
    return new AgentAbortedError(abortedMessage);
  }

  if (error instanceof Error) {
    if (error.name === 'ConfirmationTimeoutError' || error.message === 'Confirmation timeout') {
      return new ConfirmationTimeoutError(error.message);
    }
    return new UnknownError(error.message || new UnknownError().message);
  }

  return new UnknownError();
}

export function calculateRetryDelay(
  retryCount: number,
  error: Error,
  backoffConfig: BackoffConfig
): number {
  const retryAfterMs = error instanceof LLMRetryableError ? error.retryAfter : undefined;
  return calculateBackoff(retryCount - 1, retryAfterMs, backoffConfig);
}

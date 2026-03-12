import {
  calculateBackoff,
  LLMAbortedError,
  LLMAuthError,
  LLMBadRequestError,
  LLMError,
  LLMNotFoundError,
  LLMPermanentError,
  LLMRateLimitError,
  LLMRetryableError,
} from '../../providers';
import type { BackoffConfig } from '../../providers';
import {
  AgentUpstreamAuthError,
  AgentUpstreamBadRequestError,
  AgentUpstreamError,
  AgentUpstreamNetworkError,
  AgentUpstreamNotFoundError,
  AgentUpstreamPermanentError,
  AgentUpstreamRateLimitError,
  AgentUpstreamRetryableError,
  AgentUpstreamServerError,
  AgentUpstreamTimeoutError,
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

  if (error instanceof LLMAbortedError) {
    return new AgentAbortedError(error.message || abortedMessage);
  }

  if (error instanceof LLMRateLimitError) {
    return new AgentUpstreamRateLimitError(error.message);
  }

  if (error instanceof LLMAuthError) {
    return new AgentUpstreamAuthError(error.message);
  }

  if (error instanceof LLMNotFoundError) {
    return new AgentUpstreamNotFoundError(error.message);
  }

  if (error instanceof LLMBadRequestError) {
    return new AgentUpstreamBadRequestError(error.message);
  }

  if (error instanceof LLMRetryableError) {
    return mapRetryableProviderError(error);
  }

  if (error instanceof LLMPermanentError) {
    return new AgentUpstreamPermanentError(error.message);
  }

  if (error instanceof LLMError) {
    return mapGeneralProviderError(error, abortedMessage);
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

function mapRetryableProviderError(error: LLMRetryableError): AgentError {
  const providerCode = normalizeProviderCode(error.code);
  if (providerCode === 'RATE_LIMIT') {
    return new AgentUpstreamRateLimitError(error.message);
  }
  if (providerCode === 'TIMEOUT' || providerCode === 'BODY_TIMEOUT') {
    return new AgentUpstreamTimeoutError(error.message);
  }
  if (providerCode === 'NETWORK_ERROR') {
    return new AgentUpstreamNetworkError(error.message);
  }
  if (isServerCode(providerCode)) {
    return new AgentUpstreamServerError(error.message);
  }
  const inferredKind = inferRetryableKindFromMessage(error.message);
  if (inferredKind === 'timeout') {
    return new AgentUpstreamTimeoutError(error.message);
  }
  if (inferredKind === 'network') {
    return new AgentUpstreamNetworkError(error.message);
  }
  return new AgentUpstreamRetryableError(error.message);
}

function mapGeneralProviderError(error: LLMError, abortedMessage: string): AgentError {
  const providerCode = normalizeProviderCode(error.code);
  if (providerCode === 'ABORTED') {
    return new AgentAbortedError(error.message || abortedMessage);
  }
  if (providerCode === 'AUTH_FAILED') {
    return new AgentUpstreamAuthError(error.message);
  }
  if (providerCode === 'NOT_FOUND') {
    return new AgentUpstreamNotFoundError(error.message);
  }
  if (providerCode === 'BAD_REQUEST') {
    return new AgentUpstreamBadRequestError(error.message);
  }
  if (providerCode === 'RATE_LIMIT') {
    return new AgentUpstreamRateLimitError(error.message);
  }
  if (providerCode === 'TIMEOUT' || providerCode === 'BODY_TIMEOUT') {
    return new AgentUpstreamTimeoutError(error.message);
  }
  if (providerCode === 'NETWORK_ERROR') {
    return new AgentUpstreamNetworkError(error.message);
  }
  if (isServerCode(providerCode)) {
    return new AgentUpstreamServerError(error.message);
  }
  return new AgentUpstreamError(error.message || new AgentUpstreamError().message);
}

function normalizeProviderCode(code: string | undefined): string {
  if (typeof code !== 'string') {
    return '';
  }
  return code.trim().toUpperCase();
}

function isServerCode(code: string): boolean {
  return /^SERVER_\d{3}$/.test(code);
}

function inferRetryableKindFromMessage(
  message: string | undefined
): 'network' | 'timeout' | undefined {
  if (typeof message !== 'string') {
    return undefined;
  }
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (/\b(timeout|timed out|body timeout|request timeout|deadline exceeded)\b/.test(normalized)) {
    return 'timeout';
  }
  if (
    /\b(network|connection|socket|econnreset|econnrefused|enotfound|ehostunreach|etimedout|dns)\b/.test(
      normalized
    )
  ) {
    return 'network';
  }
  return undefined;
}

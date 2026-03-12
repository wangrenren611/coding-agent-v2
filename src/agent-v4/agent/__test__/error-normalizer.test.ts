import { describe, expect, it } from 'vitest';
import { isAbortError, normalizeError, calculateRetryDelay } from '../error-normalizer';
import {
  LLMAbortedError,
  LLMAuthError,
  LLMBadRequestError,
  LLMError,
  LLMNotFoundError,
  LLMPermanentError,
  LLMRateLimitError,
  LLMRetryableError,
} from '../../../providers';
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
} from '../error';

describe('isAbortError', () => {
  it('returns true for AbortError name', () => {
    const error = { name: 'AbortError', message: 'aborted' };
    expect(isAbortError(error, 'aborted')).toBe(true);
  });

  it('returns true for matching aborted message', () => {
    const error = { name: 'Error', message: 'Operation aborted' };
    expect(isAbortError(error, 'Operation aborted')).toBe(true);
  });

  it('returns false for non-abort errors', () => {
    expect(isAbortError(new Error('other'), 'aborted')).toBe(false);
    expect(isAbortError(null, 'aborted')).toBe(false);
    expect(isAbortError(undefined, 'aborted')).toBe(false);
    expect(isAbortError('string', 'aborted')).toBe(false);
    expect(isAbortError(123, 'aborted')).toBe(false);
  });

  it('returns false for object without name or message', () => {
    expect(isAbortError({}, 'aborted')).toBe(false);
  });
});

describe('normalizeError', () => {
  const abortedMessage = 'Operation aborted';

  it('returns AgentError unchanged', () => {
    const agentError = new AgentError('test');
    expect(normalizeError(agentError, abortedMessage)).toBe(agentError);
  });

  it('converts abort error to AgentAbortedError', () => {
    const error = { name: 'AbortError', message: 'aborted' };
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(AgentAbortedError);
    expect(result.message).toBe(abortedMessage);
  });

  it('converts LLMAbortedError to AgentAbortedError', () => {
    const error = new LLMAbortedError('llm aborted');
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(AgentAbortedError);
    expect(result.message).toBe('llm aborted');
  });

  it('converts LLMAbortedError with empty message to default', () => {
    const error = new LLMAbortedError('');
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(AgentAbortedError);
    expect(result.message).toBe(abortedMessage);
  });

  it('converts LLMRateLimitError to AgentUpstreamRateLimitError', () => {
    const error = new LLMRateLimitError('rate limited');
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(AgentUpstreamRateLimitError);
    expect(result.message).toBe('rate limited');
  });

  it('converts LLMAuthError to AgentUpstreamAuthError', () => {
    const error = new LLMAuthError('auth failed');
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(AgentUpstreamAuthError);
    expect(result.message).toBe('auth failed');
  });

  it('converts LLMNotFoundError to AgentUpstreamNotFoundError', () => {
    const error = new LLMNotFoundError('not found');
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(AgentUpstreamNotFoundError);
    expect(result.message).toBe('not found');
  });

  it('converts LLMBadRequestError to AgentUpstreamBadRequestError', () => {
    const error = new LLMBadRequestError('bad request');
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(AgentUpstreamBadRequestError);
    expect(result.message).toBe('bad request');
  });

  it('converts LLMRetryableError with RATE_LIMIT code', () => {
    const error = new LLMRetryableError('rate limit', undefined, 'RATE_LIMIT');
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(AgentUpstreamRateLimitError);
  });

  it('converts LLMRetryableError with TIMEOUT code', () => {
    const error = new LLMRetryableError('timeout', undefined, 'TIMEOUT');
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(AgentUpstreamTimeoutError);
  });

  it('converts LLMRetryableError with BODY_TIMEOUT code', () => {
    const error = new LLMRetryableError('body timeout', undefined, 'BODY_TIMEOUT');
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(AgentUpstreamTimeoutError);
  });

  it('converts LLMRetryableError with NETWORK_ERROR code', () => {
    const error = new LLMRetryableError('network error', undefined, 'NETWORK_ERROR');
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(AgentUpstreamNetworkError);
  });

  it('converts LLMRetryableError with SERVER_500 code', () => {
    const error = new LLMRetryableError('server error', undefined, 'SERVER_500');
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(AgentUpstreamServerError);
  });

  it('converts LLMRetryableError with unknown code to AgentUpstreamRetryableError', () => {
    const error = new LLMRetryableError('retryable', undefined, 'UNKNOWN');
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(AgentUpstreamRetryableError);
  });

  it('converts LLMPermanentError to AgentUpstreamPermanentError', () => {
    const error = new LLMPermanentError('permanent');
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(AgentUpstreamPermanentError);
    expect(result.message).toBe('permanent');
  });

  it('converts LLMError with ABORTED code', () => {
    const error = new LLMError('aborted', 'ABORTED');
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(AgentAbortedError);
  });

  it('converts LLMError with AUTH_FAILED code', () => {
    const error = new LLMError('auth failed', 'AUTH_FAILED');
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(AgentUpstreamAuthError);
  });

  it('converts LLMError with NOT_FOUND code', () => {
    const error = new LLMError('not found', 'NOT_FOUND');
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(AgentUpstreamNotFoundError);
  });

  it('converts LLMError with BAD_REQUEST code', () => {
    const error = new LLMError('bad request', 'BAD_REQUEST');
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(AgentUpstreamBadRequestError);
  });

  it('converts LLMError with RATE_LIMIT code', () => {
    const error = new LLMError('rate limit', 'RATE_LIMIT');
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(AgentUpstreamRateLimitError);
  });

  it('converts LLMError with TIMEOUT code', () => {
    const error = new LLMError('timeout', 'TIMEOUT');
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(AgentUpstreamTimeoutError);
  });

  it('converts LLMError with BODY_TIMEOUT code', () => {
    const error = new LLMError('body timeout', 'BODY_TIMEOUT');
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(AgentUpstreamTimeoutError);
  });

  it('converts LLMError with NETWORK_ERROR code', () => {
    const error = new LLMError('network error', 'NETWORK_ERROR');
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(AgentUpstreamNetworkError);
  });

  it('converts LLMError with SERVER_500 code', () => {
    const error = new LLMError('server error', 'SERVER_500');
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(AgentUpstreamServerError);
  });

  it('converts LLMError with unknown code to AgentUpstreamError', () => {
    const error = new LLMError('unknown', 'UNKNOWN');
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(AgentUpstreamError);
  });

  it('converts LLMError with empty message to default', () => {
    const error = new LLMError('', 'UNKNOWN');
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(AgentUpstreamError);
  });

  it('converts ConfirmationTimeoutError', () => {
    const error = new Error('Confirmation timeout');
    error.name = 'ConfirmationTimeoutError';
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(ConfirmationTimeoutError);
  });

  it('converts Error with Confirmation timeout message', () => {
    const error = new Error('Confirmation timeout');
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(ConfirmationTimeoutError);
  });

  it('converts generic Error to UnknownError', () => {
    const error = new Error('generic error');
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(UnknownError);
    expect(result.message).toBe('generic error');
  });

  it('converts Error with empty message to default UnknownError', () => {
    const error = new Error('');
    const result = normalizeError(error, abortedMessage);

    expect(result).toBeInstanceOf(UnknownError);
  });

  it('converts non-Error to UnknownError', () => {
    const result = normalizeError('string error', abortedMessage);

    expect(result).toBeInstanceOf(UnknownError);
  });

  it('converts null to UnknownError', () => {
    const result = normalizeError(null, abortedMessage);

    expect(result).toBeInstanceOf(UnknownError);
  });

  it('converts undefined to UnknownError', () => {
    const result = normalizeError(undefined, abortedMessage);

    expect(result).toBeInstanceOf(UnknownError);
  });
});

describe('calculateRetryDelay', () => {
  const backoffConfig = {
    initialDelayMs: 1000,
    maxDelayMs: 10000,
    base: 2,
    jitter: false, // Disable jitter for predictable tests
  };

  it('calculates delay for first retry', () => {
    const error = new Error('test');
    const delay = calculateRetryDelay(1, error, backoffConfig);

    expect(delay).toBe(1000);
  });

  it('calculates delay for second retry', () => {
    const error = new Error('test');
    const delay = calculateRetryDelay(2, error, backoffConfig);

    expect(delay).toBe(2000);
  });

  it('calculates delay for third retry', () => {
    const error = new Error('test');
    const delay = calculateRetryDelay(3, error, backoffConfig);

    expect(delay).toBe(4000);
  });

  it('respects max delay', () => {
    const error = new Error('test');
    const delay = calculateRetryDelay(10, error, backoffConfig);

    expect(delay).toBe(10000);
  });

  it('uses retryAfter from LLMRetryableError', () => {
    const error = new LLMRetryableError('rate limit', 5000);
    const delay = calculateRetryDelay(1, error, backoffConfig);

    expect(delay).toBe(5000);
  });

  it('ignores retryAfter from non-LLMRetryableError', () => {
    const error = new Error('test');
    // Add retryAfter property to test that it's ignored for non-LLMRetryableError
    Object.defineProperty(error, 'retryAfter', { value: 5000 });
    const delay = calculateRetryDelay(1, error, backoffConfig);

    expect(delay).toBe(1000);
  });
});

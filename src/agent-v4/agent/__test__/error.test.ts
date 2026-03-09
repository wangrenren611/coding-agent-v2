import { describe, expect, it } from 'vitest';
import {
  AgentAbortedError,
  AgentError,
  AgentQueryError,
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
  ConfirmationTimeoutError,
  MaxRetriesError,
  TimeoutBudgetExceededError,
  UnknownError,
} from '../error';

describe('agent/error', () => {
  it('builds AgentError with default and custom code', () => {
    const defaultErr = new AgentError('boom');
    const customErr = new AgentError('boom2', 2001);

    expect(defaultErr.name).toBe('AgentError');
    expect(defaultErr.code).toBe(1000);
    expect(defaultErr.message).toBe('boom');
    expect(defaultErr.errorCode).toBe('AGENT_ERROR');
    expect(defaultErr.category).toBe('internal');
    expect(defaultErr.retryable).toBe(false);
    expect(defaultErr.httpStatus).toBe(500);

    expect(customErr.code).toBe(2001);
  });

  it('builds AgentQueryError with defaults', () => {
    const err = new AgentQueryError();

    expect(err.name).toBe('AgentQueryError');
    expect(err.code).toBe(1001);
    expect(err.message).toBe('Query is empty');
    expect(err.errorCode).toBe('AGENT_QUERY_EMPTY');
    expect(err.category).toBe('validation');
    expect(err.retryable).toBe(false);
    expect(err.httpStatus).toBe(400);
  });

  it('builds AgentAbortedError', () => {
    const err = new AgentAbortedError();

    expect(err).toBeInstanceOf(AgentError);
    expect(err.name).toBe('AgentAbortedError');
    expect(err.code).toBe(1002);
    expect(err.message).toBe('Agent was aborted');
    expect(err.errorCode).toBe('AGENT_ABORTED');
    expect(err.category).toBe('abort');
    expect(err.retryable).toBe(false);
    expect(err.httpStatus).toBe(499);
  });

  it('builds MaxRetriesError', () => {
    const err = new MaxRetriesError();

    expect(err).toBeInstanceOf(AgentError);
    expect(err.name).toBe('MaxRetriesError');
    expect(err.code).toBe(1003);
    expect(err.message).toBe('Max retries reached');
    expect(err.errorCode).toBe('AGENT_MAX_RETRIES_REACHED');
    expect(err.category).toBe('timeout');
    expect(err.retryable).toBe(false);
    expect(err.httpStatus).toBe(504);
  });

  it('builds ConfirmationTimeoutError', () => {
    const err = new ConfirmationTimeoutError();

    expect(err).toBeInstanceOf(AgentError);
    expect(err.name).toBe('ConfirmationTimeoutError');
    expect(err.code).toBe(1004);
    expect(err.message).toBe('Confirmation timeout');
    expect(err.errorCode).toBe('AGENT_CONFIRMATION_TIMEOUT');
    expect(err.category).toBe('timeout');
    expect(err.retryable).toBe(true);
    expect(err.httpStatus).toBe(408);
  });

  it('builds UnknownError', () => {
    const err = new UnknownError();

    expect(err).toBeInstanceOf(AgentError);
    expect(err.name).toBe('UnknownError');
    expect(err.code).toBe(1005);
    expect(err.message).toBe('Unknown error');
    expect(err.errorCode).toBe('AGENT_UNKNOWN_ERROR');
    expect(err.category).toBe('internal');
    expect(err.retryable).toBe(false);
    expect(err.httpStatus).toBe(500);
  });

  it('builds TimeoutBudgetExceededError', () => {
    const err = new TimeoutBudgetExceededError();

    expect(err).toBeInstanceOf(AgentError);
    expect(err.name).toBe('TimeoutBudgetExceededError');
    expect(err.code).toBe(1006);
    expect(err.message).toBe('Timeout budget exceeded');
    expect(err.errorCode).toBe('AGENT_TIMEOUT_BUDGET_EXCEEDED');
    expect(err.category).toBe('timeout');
    expect(err.retryable).toBe(false);
    expect(err.httpStatus).toBe(504);
  });

  it('builds upstream retryable errors', () => {
    const rateLimit = new AgentUpstreamRateLimitError('rate limited');
    const timeout = new AgentUpstreamTimeoutError('timed out');
    const network = new AgentUpstreamNetworkError('network down');
    const server = new AgentUpstreamServerError('server 500');
    const retryable = new AgentUpstreamRetryableError('retry me');

    expect(rateLimit).toMatchObject({
      name: 'AgentUpstreamRateLimitError',
      code: 1007,
      errorCode: 'AGENT_UPSTREAM_RATE_LIMIT',
      category: 'rate_limit',
      retryable: true,
      httpStatus: 429,
    });
    expect(timeout).toMatchObject({
      name: 'AgentUpstreamTimeoutError',
      code: 1008,
      errorCode: 'AGENT_UPSTREAM_TIMEOUT',
      category: 'timeout',
      retryable: true,
      httpStatus: 504,
    });
    expect(network).toMatchObject({
      name: 'AgentUpstreamNetworkError',
      code: 1009,
      errorCode: 'AGENT_UPSTREAM_NETWORK',
      category: 'internal',
      retryable: true,
      httpStatus: 503,
    });
    expect(server).toMatchObject({
      name: 'AgentUpstreamServerError',
      code: 1010,
      errorCode: 'AGENT_UPSTREAM_SERVER',
      category: 'internal',
      retryable: true,
      httpStatus: 502,
    });
    expect(retryable).toMatchObject({
      name: 'AgentUpstreamRetryableError',
      code: 1015,
      errorCode: 'AGENT_UPSTREAM_RETRYABLE',
      category: 'internal',
      retryable: true,
      httpStatus: 503,
    });
  });

  it('builds upstream non-retryable errors', () => {
    const auth = new AgentUpstreamAuthError('bad key');
    const notFound = new AgentUpstreamNotFoundError('missing model');
    const badRequest = new AgentUpstreamBadRequestError('invalid payload');
    const permanent = new AgentUpstreamPermanentError('not implemented');
    const generic = new AgentUpstreamError('provider error');

    expect(auth).toMatchObject({
      name: 'AgentUpstreamAuthError',
      code: 1011,
      errorCode: 'AGENT_UPSTREAM_AUTH',
      category: 'permission',
      retryable: false,
      httpStatus: 401,
    });
    expect(notFound).toMatchObject({
      name: 'AgentUpstreamNotFoundError',
      code: 1012,
      errorCode: 'AGENT_UPSTREAM_NOT_FOUND',
      category: 'not_found',
      retryable: false,
      httpStatus: 404,
    });
    expect(badRequest).toMatchObject({
      name: 'AgentUpstreamBadRequestError',
      code: 1013,
      errorCode: 'AGENT_UPSTREAM_BAD_REQUEST',
      category: 'validation',
      retryable: false,
      httpStatus: 400,
    });
    expect(permanent).toMatchObject({
      name: 'AgentUpstreamPermanentError',
      code: 1014,
      errorCode: 'AGENT_UPSTREAM_PERMANENT',
      category: 'internal',
      retryable: false,
      httpStatus: 500,
    });
    expect(generic).toMatchObject({
      name: 'AgentUpstreamError',
      code: 1016,
      errorCode: 'AGENT_UPSTREAM_ERROR',
      category: 'internal',
      retryable: false,
      httpStatus: 500,
    });
  });
});

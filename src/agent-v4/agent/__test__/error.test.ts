import { describe, expect, it } from 'vitest';
import {
  AgentAbortedError,
  AgentError,
  AgentQueryError,
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
});

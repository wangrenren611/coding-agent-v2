import { describe, expect, it } from 'vitest';
import {
  AgentAbortedError,
  AgentError,
  AgentQueryError,
  ConfirmationTimeoutError,
  MaxRetriesError,
  UnknownError,
} from '../error';

describe('agent/error', () => {
  it('builds AgentError with default and custom code', () => {
    const defaultErr = new AgentError('boom');
    const customErr = new AgentError('boom2', 2001);

    expect(defaultErr.name).toBe('AgentError');
    expect(defaultErr.code).toBe(1000);
    expect(defaultErr.message).toBe('boom');

    expect(customErr.code).toBe(2001);
  });

  it('builds AgentQueryError with defaults', () => {
    const err = new AgentQueryError();

    expect(err.name).toBe('AgentQueryError');
    expect(err.code).toBe(1001);
    expect(err.message).toBe('Query is empty');
  });

  it('builds AgentAbortedError', () => {
    const err = new AgentAbortedError();

    expect(err).toBeInstanceOf(AgentError);
    expect(err.name).toBe('AgentAbortedError');
    expect(err.code).toBe(1002);
    expect(err.message).toBe('Agent was aborted');
  });

  it('builds MaxRetriesError', () => {
    const err = new MaxRetriesError();

    expect(err).toBeInstanceOf(AgentError);
    expect(err.name).toBe('MaxRetriesError');
    expect(err.code).toBe(1003);
    expect(err.message).toBe('Max retries reached');
  });

  it('builds ConfirmationTimeoutError', () => {
    const err = new ConfirmationTimeoutError();

    expect(err).toBeInstanceOf(AgentError);
    expect(err.name).toBe('ConfirmationTimeoutError');
    expect(err.code).toBe(1004);
    expect(err.message).toBe('Confirmation timeout');
  });

  it('builds UnknownError', () => {
    const err = new UnknownError();

    expect(err).toBeInstanceOf(AgentError);
    expect(err.name).toBe('UnknownError');
    expect(err.code).toBe(1005);
    expect(err.message).toBe('Unknown error');
  });
});

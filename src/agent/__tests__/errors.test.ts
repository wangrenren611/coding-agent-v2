/**
 * Agent 错误类测试
 */

import { describe, it, expect } from 'vitest';
import { AgentLoopExceededError, AgentAbortedError, AgentMaxRetriesExceededError } from '../errors';

describe('AgentLoopExceededError', () => {
  it('should create error with limit and actual values', () => {
    const error = new AgentLoopExceededError(100, 150);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AgentLoopExceededError);
    expect(error.name).toBe('AgentLoopExceededError');
    expect(error.message).toBe('Agent loop exceeded: 150 > 100');
    expect(error.limit).toBe(100);
    expect(error.actual).toBe(150);
  });

  it('should create error with zero values', () => {
    const error = new AgentLoopExceededError(0, 1);

    expect(error.message).toBe('Agent loop exceeded: 1 > 0');
    expect(error.limit).toBe(0);
    expect(error.actual).toBe(1);
  });

  it('should create error with same values', () => {
    const error = new AgentLoopExceededError(10, 10);

    expect(error.message).toBe('Agent loop exceeded: 10 > 10');
  });
});

describe('AgentAbortedError', () => {
  it('should create error with default message', () => {
    const error = new AgentAbortedError();

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AgentAbortedError);
    expect(error.name).toBe('AgentAbortedError');
    expect(error.message).toBe('Agent was aborted');
  });

  it('should create error with custom message', () => {
    const error = new AgentAbortedError('Custom abort message');

    expect(error.message).toBe('Custom abort message');
    expect(error.name).toBe('AgentAbortedError');
  });

  it('should create error with empty message', () => {
    const error = new AgentAbortedError('');

    expect(error.message).toBe('');
  });
});

describe('AgentMaxRetriesExceededError', () => {
  it('should create error with retries and lastError', () => {
    const lastError = new Error('Connection timeout');
    const error = new AgentMaxRetriesExceededError(5, lastError);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AgentMaxRetriesExceededError);
    expect(error.name).toBe('AgentMaxRetriesExceededError');
    expect(error.message).toBe('Max retries exceeded: 5. Last error: Connection timeout');
    expect(error.retries).toBe(5);
    expect(error.lastError).toBe(lastError);
  });

  it('should create error with zero retries', () => {
    const lastError = new Error('Unknown error');
    const error = new AgentMaxRetriesExceededError(0, lastError);

    expect(error.message).toBe('Max retries exceeded: 0. Last error: Unknown error');
    expect(error.retries).toBe(0);
  });

  it('should preserve lastError reference', () => {
    const lastError = new Error('Original error');
    const error = new AgentMaxRetriesExceededError(3, lastError);

    expect(error.lastError).toBe(lastError);
    expect(error.lastError.message).toBe('Original error');
  });
});

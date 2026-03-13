import { describe, expect, it } from 'vitest';
import { buildTaskFailure, buildTaskSuccess, parsePrefixedError } from '../task-errors';
import { ToolExecutionError } from '../error';

describe('buildTaskFailure', () => {
  it('builds failure result with code and message', () => {
    const result = buildTaskFailure('TASK_NOT_FOUND', 'Task not found');

    expect(result.success).toBe(false);
    expect(result.output).toBe('TASK_NOT_FOUND: Task not found');
    expect(result.error).toBeInstanceOf(ToolExecutionError);
    expect(result.error!.message).toBe('TASK_NOT_FOUND: Task not found');
    expect(result.metadata).toEqual({
      error: 'TASK_NOT_FOUND',
      message: 'Task not found',
    });
  });

  it('builds failure result with details', () => {
    const result = buildTaskFailure('TASK_FAILED', 'Task failed', {
      taskId: 'task_1',
      retryCount: 3,
    });

    expect(result.success).toBe(false);
    expect(result.output).toBe('TASK_FAILED: Task failed');
    expect(result.metadata).toEqual({
      error: 'TASK_FAILED',
      message: 'Task failed',
      taskId: 'task_1',
      retryCount: 3,
    });
  });

  it('builds failure result with empty details', () => {
    const result = buildTaskFailure('ERROR', 'Error message', {});

    expect(result.success).toBe(false);
    expect(result.metadata).toEqual({
      error: 'ERROR',
      message: 'Error message',
    });
  });

  it('builds failure result with undefined details', () => {
    const result = buildTaskFailure('ERROR', 'Error message', undefined);

    expect(result.success).toBe(false);
    expect(result.metadata).toEqual({
      error: 'ERROR',
      message: 'Error message',
    });
  });

  it('handles empty code', () => {
    const result = buildTaskFailure('', 'Error message');

    expect(result.success).toBe(false);
    expect(result.output).toBe(': Error message');
  });

  it('handles empty message', () => {
    const result = buildTaskFailure('ERROR', '');

    expect(result.success).toBe(false);
    expect(result.output).toBe('ERROR: ');
  });

  it('handles special characters in code and message', () => {
    const result = buildTaskFailure('ERROR_CODE', 'Error: "test" & <value>');

    expect(result.success).toBe(false);
    expect(result.output).toBe('ERROR_CODE: Error: "test" & <value>');
  });
});

describe('buildTaskSuccess', () => {
  it('builds success result with payload', () => {
    const payload = { taskId: 'task_1', status: 'completed' };
    const result = buildTaskSuccess(payload);

    expect(result.success).toBe(true);
    expect(result.output).toBe(JSON.stringify(payload));
    expect(result.metadata).toEqual(payload);
  });

  it('builds success result with empty payload', () => {
    const result = buildTaskSuccess({});

    expect(result.success).toBe(true);
    expect(result.output).toBe('{}');
    expect(result.metadata).toEqual({});
  });

  it('builds success result with nested payload', () => {
    const payload = {
      task: {
        id: 'task_1',
        status: 'completed',
        result: { value: 42 },
      },
    };
    const result = buildTaskSuccess(payload);

    expect(result.success).toBe(true);
    expect(result.output).toBe(JSON.stringify(payload));
    expect(result.metadata).toEqual(payload);
  });

  it('builds success result with array payload', () => {
    const payload = { items: [1, 2, 3] };
    const result = buildTaskSuccess(payload);

    expect(result.success).toBe(true);
    expect(result.output).toBe(JSON.stringify(payload));
    expect(result.metadata).toEqual(payload);
  });

  it('builds success result with null values', () => {
    const payload = { value: null, other: undefined };
    const result = buildTaskSuccess(payload);

    expect(result.success).toBe(true);
    // undefined values are omitted in JSON.stringify
    expect(result.output).toBe('{"value":null}');
  });

  it('builds success result with special characters', () => {
    const payload = { message: 'Success: "test" & <value>' };
    const result = buildTaskSuccess(payload);

    expect(result.success).toBe(true);
    expect(result.output).toBe(JSON.stringify(payload));
  });
});

describe('parsePrefixedError', () => {
  it('parses error with code prefix', () => {
    const result = parsePrefixedError('TASK_NOT_FOUND: Task not found');

    expect(result.code).toBe('TASK_NOT_FOUND');
    expect(result.detail).toBe('Task not found');
  });

  it('parses error with complex code', () => {
    const result = parsePrefixedError(
      'TASK_INVALID_NAMESPACE: namespace allows only [a-zA-Z0-9._-]'
    );

    expect(result.code).toBe('TASK_INVALID_NAMESPACE');
    expect(result.detail).toBe('namespace allows only [a-zA-Z0-9._-]');
  });

  it('parses error with numbers in code', () => {
    const result = parsePrefixedError('ERROR_404: Not found');

    expect(result.code).toBe('ERROR_404');
    expect(result.detail).toBe('Not found');
  });

  it('returns default for error without code prefix', () => {
    const result = parsePrefixedError('Task not found');

    expect(result.code).toBe('TASK_OPERATION_FAILED');
    expect(result.detail).toBe('Task not found');
  });

  it('returns default for error with lowercase prefix', () => {
    const result = parsePrefixedError('task_not_found: Task not found');

    expect(result.code).toBe('TASK_OPERATION_FAILED');
    expect(result.detail).toBe('task_not_found: Task not found');
  });

  it('returns default for error with short code', () => {
    const result = parsePrefixedError('AB: Short code');

    expect(result.code).toBe('TASK_OPERATION_FAILED');
    expect(result.detail).toBe('AB: Short code');
  });

  it('returns default for empty string', () => {
    const result = parsePrefixedError('');

    expect(result.code).toBe('TASK_OPERATION_FAILED');
    expect(result.detail).toBe('');
  });

  it('handles error with multiple colons', () => {
    const result = parsePrefixedError('ERROR_CODE: Message: with colons');

    expect(result.code).toBe('ERROR_CODE');
    expect(result.detail).toBe('Message: with colons');
  });

  it('handles error with whitespace after colon', () => {
    const result = parsePrefixedError('ERROR_CODE:   Message with spaces');

    expect(result.code).toBe('ERROR_CODE');
    // \s* in regex matches all whitespace, so leading spaces are trimmed
    expect(result.detail).toBe('Message with spaces');
  });

  it('handles error with no detail after colon', () => {
    const result = parsePrefixedError('ERROR_CODE:');

    expect(result.code).toBe('ERROR_CODE');
    expect(result.detail).toBe('');
  });

  it('handles error with special characters in detail', () => {
    const result = parsePrefixedError('ERROR_CODE: Error: "test" & <value>');

    expect(result.code).toBe('ERROR_CODE');
    expect(result.detail).toBe('Error: "test" & <value>');
  });

  it('handles error with newlines in detail', () => {
    // The regex doesn't match newlines, so it returns default
    const result = parsePrefixedError('ERROR_CODE: Line 1\nLine 2');

    expect(result.code).toBe('TASK_OPERATION_FAILED');
    expect(result.detail).toBe('ERROR_CODE: Line 1\nLine 2');
  });
});

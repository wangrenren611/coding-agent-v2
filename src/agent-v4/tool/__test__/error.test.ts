import { describe, expect, it } from 'vitest';
import {
  EmptyToolNameError,
  InvalidArgumentsError,
  ToolDeniedError,
  ToolExecutionError,
  ToolNotFoundError,
  ToolPolicyDeniedError,
  ToolValidationError,
} from '../error';

describe('tool/error', () => {
  it('builds ToolExecutionError', () => {
    const err = new ToolExecutionError('exec failed');
    expect(err.name).toBe('ToolExecutionError');
    expect(err.message).toBe('exec failed');
    expect(err.code).toBe(2000);
    expect(err.errorCode).toBe('TOOL_EXECUTION_ERROR');
    expect(err.category).toBe('internal');
    expect(err.retryable).toBe(true);
    expect(err.httpStatus).toBe(500);
  });

  it('builds EmptyToolNameError', () => {
    const err = new EmptyToolNameError();
    expect(err.name).toBe('EmptyToolNameError');
    expect(err.message).toBe('Tool name is empty');
    expect(err.code).toBe(2001);
    expect(err.errorCode).toBe('TOOL_NAME_EMPTY');
    expect(err.category).toBe('validation');
    expect(err.retryable).toBe(false);
    expect(err.httpStatus).toBe(400);
  });

  it('builds InvalidArgumentsError', () => {
    const err = new InvalidArgumentsError('bash', 'bad json');
    expect(err.name).toBe('InvalidArgumentsError');
    expect(err.code).toBe(2002);
    expect(err.errorCode).toBe('TOOL_INVALID_ARGUMENTS');
    expect(err.category).toBe('validation');
    expect(err.retryable).toBe(false);
    expect(err.httpStatus).toBe(400);
    expect(err.toolName).toBe('bash');
    expect(err.message).toContain('Invalid arguments format for tool bash');
    expect(err.message).toContain('bad json');
  });

  it('builds ToolNotFoundError', () => {
    const err = new ToolNotFoundError('missing_tool');
    expect(err.name).toBe('ToolNotFoundError');
    expect(err.code).toBe(2003);
    expect(err.errorCode).toBe('TOOL_NOT_FOUND');
    expect(err.category).toBe('not_found');
    expect(err.retryable).toBe(false);
    expect(err.httpStatus).toBe(404);
    expect(err.toolName).toBe('missing_tool');
    expect(err.message).toBe('Tool missing_tool not found');
  });

  it('builds ToolValidationError', () => {
    const issues = [{ message: 'x is required' }, { message: 'y must be int' }];
    const err = new ToolValidationError('demo_tool', issues);
    expect(err.name).toBe('ToolValidationError');
    expect(err.code).toBe(2004);
    expect(err.errorCode).toBe('TOOL_VALIDATION_FAILED');
    expect(err.category).toBe('validation');
    expect(err.retryable).toBe(false);
    expect(err.httpStatus).toBe(400);
    expect(err.toolName).toBe('demo_tool');
    expect(err.issues).toEqual(issues);
    expect(err.message).toBe('x is required, y must be int');
  });

  it('builds ToolDeniedError with default reason and custom reason', () => {
    const defaultErr = new ToolDeniedError('danger');
    const customErr = new ToolDeniedError('danger', 'policy denied');

    expect(defaultErr.name).toBe('ToolDeniedError');
    expect(defaultErr.code).toBe(2005);
    expect(defaultErr.errorCode).toBe('TOOL_DENIED');
    expect(defaultErr.category).toBe('permission');
    expect(defaultErr.retryable).toBe(false);
    expect(defaultErr.httpStatus).toBe(403);
    expect(defaultErr.toolName).toBe('danger');
    expect(defaultErr.reason).toBeUndefined();
    expect(defaultErr.message).toBe('Tool danger denied: User rejected');

    expect(customErr.reason).toBe('policy denied');
    expect(customErr.message).toBe('Tool danger denied: policy denied');
  });

  it('builds ToolPolicyDeniedError with standard reason code envelope', () => {
    const err = new ToolPolicyDeniedError('write_file', 'PATH_NOT_ALLOWED', 'outside workspace');

    expect(err.name).toBe('ToolPolicyDeniedError');
    expect(err.code).toBe(2006);
    expect(err.errorCode).toBe('TOOL_POLICY_DENIED');
    expect(err.category).toBe('permission');
    expect(err.retryable).toBe(false);
    expect(err.httpStatus).toBe(403);
    expect(err.toolName).toBe('write_file');
    expect(err.reasonCode).toBe('PATH_NOT_ALLOWED');
    expect(err.reason).toBe('outside workspace');
    expect(err.message).toBe(
      'Tool write_file blocked by policy [PATH_NOT_ALLOWED]: outside workspace'
    );
  });
});

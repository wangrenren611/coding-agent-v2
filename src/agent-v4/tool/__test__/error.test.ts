import { describe, expect, it } from 'vitest';
import {
  EmptyToolNameError,
  InvalidArgumentsError,
  ToolDeniedError,
  ToolExecutionError,
  ToolNotFoundError,
  ToolValidationError,
} from '../error';

describe('tool/error', () => {
  it('builds ToolExecutionError', () => {
    const err = new ToolExecutionError('exec failed');
    expect(err.name).toBe('ToolExecutionError');
    expect(err.message).toBe('exec failed');
  });

  it('builds EmptyToolNameError', () => {
    const err = new EmptyToolNameError();
    expect(err.name).toBe('EmptyToolNameError');
    expect(err.message).toBe('Tool name is empty');
  });

  it('builds InvalidArgumentsError', () => {
    const err = new InvalidArgumentsError('bash', 'bad json');
    expect(err.name).toBe('InvalidArgumentsError');
    expect(err.toolName).toBe('bash');
    expect(err.message).toContain('Invalid arguments format for tool bash');
    expect(err.message).toContain('bad json');
  });

  it('builds ToolNotFoundError', () => {
    const err = new ToolNotFoundError('missing_tool');
    expect(err.name).toBe('ToolNotFoundError');
    expect(err.toolName).toBe('missing_tool');
    expect(err.message).toBe('Tool missing_tool not found');
  });

  it('builds ToolValidationError', () => {
    const issues = [{ message: 'x is required' }, { message: 'y must be int' }];
    const err = new ToolValidationError('demo_tool', issues);
    expect(err.name).toBe('ToolValidationError');
    expect(err.toolName).toBe('demo_tool');
    expect(err.issues).toEqual(issues);
    expect(err.message).toBe('x is required, y must be int');
  });

  it('builds ToolDeniedError with default reason and custom reason', () => {
    const defaultErr = new ToolDeniedError('danger');
    const customErr = new ToolDeniedError('danger', 'policy denied');

    expect(defaultErr.name).toBe('ToolDeniedError');
    expect(defaultErr.toolName).toBe('danger');
    expect(defaultErr.reason).toBeUndefined();
    expect(defaultErr.message).toBe('Tool danger denied: User rejected');

    expect(customErr.reason).toBe('policy denied');
    expect(customErr.message).toBe('Tool danger denied: policy denied');
  });
});

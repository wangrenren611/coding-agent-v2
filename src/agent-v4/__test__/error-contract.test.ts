import { describe, expect, it } from 'vitest';
import {
  ContractError,
  isErrorContract,
  serializeErrorContract,
} from '../error-contract';

describe('error-contract', () => {
  it('serializes ContractError with stable envelope', () => {
    const error = new ContractError('boom', {
      module: 'agent',
      name: 'DemoError',
      code: 1999,
      errorCode: 'DEMO_ERROR',
      category: 'internal',
      retryable: false,
      httpStatus: 500,
      details: { source: 'unit-test' },
    });

    expect(error.toJSON()).toEqual({
      module: 'agent',
      name: 'DemoError',
      code: 1999,
      errorCode: 'DEMO_ERROR',
      message: 'boom',
      category: 'internal',
      retryable: false,
      httpStatus: 500,
      details: { source: 'unit-test' },
    });
  });

  it('detects valid and invalid contract payloads', () => {
    expect(
      isErrorContract({
        module: 'tool',
        name: 'ToolValidationError',
        code: 2004,
        errorCode: 'TOOL_VALIDATION_FAILED',
        message: 'invalid',
        category: 'validation',
        retryable: false,
        httpStatus: 400,
      })
    ).toBe(true);

    expect(isErrorContract({ message: 'x' })).toBe(false);
  });

  it('serializes unknown values with fallback contract fields', () => {
    const fromError = serializeErrorContract(new Error('x'), {
      module: 'tool',
      code: 2000,
      errorCode: 'TOOL_EXECUTION_ERROR',
      category: 'internal',
      retryable: true,
      httpStatus: 500,
    });
    expect(fromError).toMatchObject({
      module: 'tool',
      code: 2000,
      errorCode: 'TOOL_EXECUTION_ERROR',
      message: 'x',
      retryable: true,
    });

    const fromUnknown = serializeErrorContract('bad');
    expect(fromUnknown).toMatchObject({
      module: 'agent',
      code: 1005,
      errorCode: 'AGENT_UNKNOWN_ERROR',
      message: 'Unknown error',
    });
  });
});

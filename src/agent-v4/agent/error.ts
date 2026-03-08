import { ContractError, type ErrorContract } from '../error-contract';

export class AgentError extends ContractError {
  constructor(message: string, code = 1000) {
    super(message, {
      module: 'agent',
      name: 'AgentError',
      code,
      errorCode: 'AGENT_ERROR',
      category: 'internal',
      retryable: false,
      httpStatus: 500,
    });
  }
}

export class AgentQueryError extends ContractError {
  constructor(message = 'Query is empty', code = 1001) {
    super(message, {
      module: 'agent',
      name: 'AgentQueryError',
      code,
      errorCode: 'AGENT_QUERY_EMPTY',
      category: 'validation',
      retryable: false,
      httpStatus: 400,
    });
  }
}

export class AgentAbortedError extends AgentError {
  constructor(message = 'Agent was aborted', code = 1002) {
    super(message, code);
    this.name = 'AgentAbortedError';
    this.errorCode = 'AGENT_ABORTED';
    this.category = 'abort';
    this.retryable = false;
    this.httpStatus = 499;
  }
}

export class MaxRetriesError extends AgentError {
  constructor(message = 'Max retries reached', code = 1003) {
    super(message, code);
    this.name = 'MaxRetriesError';
    this.errorCode = 'AGENT_MAX_RETRIES_REACHED';
    this.category = 'timeout';
    this.retryable = false;
    this.httpStatus = 504;
  }
}

export class ConfirmationTimeoutError extends AgentError {
  constructor(message = 'Confirmation timeout', code = 1004) {
    super(message, code);
    this.name = 'ConfirmationTimeoutError';
    this.errorCode = 'AGENT_CONFIRMATION_TIMEOUT';
    this.category = 'timeout';
    this.retryable = true;
    this.httpStatus = 408;
  }
}

export class UnknownError extends AgentError {
  constructor(message = 'Unknown error', code = 1005) {
    super(message, code);
    this.name = 'UnknownError';
    this.errorCode = 'AGENT_UNKNOWN_ERROR';
    this.category = 'internal';
    this.retryable = false;
    this.httpStatus = 500;
  }
}

export function toAgentErrorContract(error: AgentError): ErrorContract {
  return error.toJSON();
}

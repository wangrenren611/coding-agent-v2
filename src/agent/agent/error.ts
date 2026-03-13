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

export class TimeoutBudgetExceededError extends AgentError {
  constructor(message = 'Timeout budget exceeded', code = 1006) {
    super(message, code);
    this.name = 'TimeoutBudgetExceededError';
    this.errorCode = 'AGENT_TIMEOUT_BUDGET_EXCEEDED';
    this.category = 'timeout';
    this.retryable = false;
    this.httpStatus = 504;
  }
}

export class AgentUpstreamRateLimitError extends AgentError {
  constructor(message = 'Upstream rate limit exceeded', code = 1007) {
    super(message, code);
    this.name = 'AgentUpstreamRateLimitError';
    this.errorCode = 'AGENT_UPSTREAM_RATE_LIMIT';
    this.category = 'rate_limit';
    this.retryable = true;
    this.httpStatus = 429;
  }
}

export class AgentUpstreamTimeoutError extends AgentError {
  constructor(message = 'Upstream request timed out', code = 1008) {
    super(message, code);
    this.name = 'AgentUpstreamTimeoutError';
    this.errorCode = 'AGENT_UPSTREAM_TIMEOUT';
    this.category = 'timeout';
    this.retryable = true;
    this.httpStatus = 504;
  }
}

export class AgentUpstreamNetworkError extends AgentError {
  constructor(message = 'Upstream network request failed', code = 1009) {
    super(message, code);
    this.name = 'AgentUpstreamNetworkError';
    this.errorCode = 'AGENT_UPSTREAM_NETWORK';
    this.category = 'internal';
    this.retryable = true;
    this.httpStatus = 503;
  }
}

export class AgentUpstreamServerError extends AgentError {
  constructor(message = 'Upstream server error', code = 1010) {
    super(message, code);
    this.name = 'AgentUpstreamServerError';
    this.errorCode = 'AGENT_UPSTREAM_SERVER';
    this.category = 'internal';
    this.retryable = true;
    this.httpStatus = 502;
  }
}

export class AgentUpstreamAuthError extends AgentError {
  constructor(message = 'Upstream authentication failed', code = 1011) {
    super(message, code);
    this.name = 'AgentUpstreamAuthError';
    this.errorCode = 'AGENT_UPSTREAM_AUTH';
    this.category = 'permission';
    this.retryable = false;
    this.httpStatus = 401;
  }
}

export class AgentUpstreamNotFoundError extends AgentError {
  constructor(message = 'Upstream resource not found', code = 1012) {
    super(message, code);
    this.name = 'AgentUpstreamNotFoundError';
    this.errorCode = 'AGENT_UPSTREAM_NOT_FOUND';
    this.category = 'not_found';
    this.retryable = false;
    this.httpStatus = 404;
  }
}

export class AgentUpstreamBadRequestError extends AgentError {
  constructor(message = 'Upstream request is invalid', code = 1013) {
    super(message, code);
    this.name = 'AgentUpstreamBadRequestError';
    this.errorCode = 'AGENT_UPSTREAM_BAD_REQUEST';
    this.category = 'validation';
    this.retryable = false;
    this.httpStatus = 400;
  }
}

export class AgentUpstreamPermanentError extends AgentError {
  constructor(message = 'Upstream permanent error', code = 1014) {
    super(message, code);
    this.name = 'AgentUpstreamPermanentError';
    this.errorCode = 'AGENT_UPSTREAM_PERMANENT';
    this.category = 'internal';
    this.retryable = false;
    this.httpStatus = 500;
  }
}

export class AgentUpstreamRetryableError extends AgentError {
  constructor(message = 'Upstream retryable error', code = 1015) {
    super(message, code);
    this.name = 'AgentUpstreamRetryableError';
    this.errorCode = 'AGENT_UPSTREAM_RETRYABLE';
    this.category = 'internal';
    this.retryable = true;
    this.httpStatus = 503;
  }
}

export class AgentUpstreamError extends AgentError {
  constructor(message = 'Upstream error', code = 1016) {
    super(message, code);
    this.name = 'AgentUpstreamError';
    this.errorCode = 'AGENT_UPSTREAM_ERROR';
    this.category = 'internal';
    this.retryable = false;
    this.httpStatus = 500;
  }
}

export function toAgentErrorContract(error: AgentError): ErrorContract {
  return error.toJSON();
}

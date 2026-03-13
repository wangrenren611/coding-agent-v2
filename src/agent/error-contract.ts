export type ErrorModule = 'agent' | 'tool';

export type ErrorCategory =
  | 'validation'
  | 'timeout'
  | 'abort'
  | 'permission'
  | 'not_found'
  | 'conflict'
  | 'rate_limit'
  | 'internal';

export interface ErrorContract {
  module: ErrorModule;
  name: string;
  code: number;
  errorCode: string;
  message: string;
  category: ErrorCategory;
  retryable: boolean;
  httpStatus: number;
  details?: Record<string, unknown>;
}

export interface ContractErrorInit {
  module: ErrorModule;
  name: string;
  code: number;
  errorCode: string;
  category: ErrorCategory;
  retryable: boolean;
  httpStatus: number;
  details?: Record<string, unknown>;
}

export class ContractError extends Error implements ErrorContract {
  module: ErrorModule;
  code: number;
  errorCode: string;
  category: ErrorCategory;
  retryable: boolean;
  httpStatus: number;
  details?: Record<string, unknown>;

  constructor(message: string, init: ContractErrorInit) {
    super(message);
    this.name = init.name;
    this.module = init.module;
    this.code = init.code;
    this.errorCode = init.errorCode;
    this.category = init.category;
    this.retryable = init.retryable;
    this.httpStatus = init.httpStatus;
    this.details = init.details;
  }

  toJSON(): ErrorContract {
    return {
      module: this.module,
      name: this.name,
      code: this.code,
      errorCode: this.errorCode,
      message: this.message,
      category: this.category,
      retryable: this.retryable,
      httpStatus: this.httpStatus,
      details: this.details,
    };
  }
}

function getRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as Record<string, unknown>;
}

export function isErrorContract(value: unknown): value is ErrorContract {
  const record = getRecord(value);
  if (!record) {
    return false;
  }
  return (
    typeof record.module === 'string' &&
    typeof record.name === 'string' &&
    typeof record.code === 'number' &&
    typeof record.errorCode === 'string' &&
    typeof record.message === 'string' &&
    typeof record.category === 'string' &&
    typeof record.retryable === 'boolean' &&
    typeof record.httpStatus === 'number'
  );
}

interface SerializeFallback {
  module: ErrorModule;
  code: number;
  errorCode: string;
  category: ErrorCategory;
  retryable: boolean;
  httpStatus: number;
}

const DEFAULT_FALLBACK: SerializeFallback = {
  module: 'agent',
  code: 1005,
  errorCode: 'AGENT_UNKNOWN_ERROR',
  category: 'internal',
  retryable: false,
  httpStatus: 500,
};

export function serializeErrorContract(
  error: unknown,
  fallback: Partial<SerializeFallback> = {}
): ErrorContract {
  if (error instanceof ContractError) {
    return error.toJSON();
  }

  const mergedFallback: SerializeFallback = {
    ...DEFAULT_FALLBACK,
    ...fallback,
  };

  if (isErrorContract(error)) {
    return error;
  }

  if (error instanceof Error) {
    return {
      module: mergedFallback.module,
      name: error.name || 'Error',
      code: mergedFallback.code,
      errorCode: mergedFallback.errorCode,
      message: error.message || 'Unknown error',
      category: mergedFallback.category,
      retryable: mergedFallback.retryable,
      httpStatus: mergedFallback.httpStatus,
    };
  }

  return {
    module: mergedFallback.module,
    name: 'UnknownError',
    code: mergedFallback.code,
    errorCode: mergedFallback.errorCode,
    message: 'Unknown error',
    category: mergedFallback.category,
    retryable: mergedFallback.retryable,
    httpStatus: mergedFallback.httpStatus,
  };
}

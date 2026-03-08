import { ContractError } from '../error-contract';

export class ToolExecutionError extends ContractError {
  constructor(message: string, code = 2000) {
    super(message, {
      module: 'tool',
      name: 'ToolExecutionError',
      code,
      errorCode: 'TOOL_EXECUTION_ERROR',
      category: 'internal',
      retryable: true,
      httpStatus: 500,
    });
  }
}

export class EmptyToolNameError extends ToolExecutionError {
  constructor() {
    super('Tool name is empty', 2001);
    this.name = 'EmptyToolNameError';
    this.errorCode = 'TOOL_NAME_EMPTY';
    this.category = 'validation';
    this.retryable = false;
    this.httpStatus = 400;
  }
}

export class InvalidArgumentsError extends ToolExecutionError {
  public toolName: string;

  constructor(toolName: string, message: string) {
    super(`Invalid arguments format for tool ${toolName}: ${message}`, 2002);
    this.name = 'InvalidArgumentsError';
    this.errorCode = 'TOOL_INVALID_ARGUMENTS';
    this.category = 'validation';
    this.retryable = false;
    this.httpStatus = 400;
    this.toolName = toolName;
    this.details = {
      toolName,
    };
  }
}

export class ToolNotFoundError extends ToolExecutionError {
  public toolName: string;

  constructor(toolName: string) {
    super(`Tool ${toolName} not found`, 2003);
    this.name = 'ToolNotFoundError';
    this.errorCode = 'TOOL_NOT_FOUND';
    this.category = 'not_found';
    this.retryable = false;
    this.httpStatus = 404;
    this.toolName = toolName;
    this.details = {
      toolName,
    };
  }
}

export class ToolValidationError extends ToolExecutionError {
  public toolName: string;
  public issues: { message: string }[];

  constructor(toolName: string, issues: { message: string }[]) {
    super(issues.map((issue) => issue.message).join(', '), 2004);
    this.name = 'ToolValidationError';
    this.errorCode = 'TOOL_VALIDATION_FAILED';
    this.category = 'validation';
    this.retryable = false;
    this.httpStatus = 400;
    this.toolName = toolName;
    this.issues = issues;
    this.details = {
      toolName,
      issues,
    };
  }
}

export class ToolDeniedError extends ToolExecutionError {
  public toolName: string;
  public reason?: string;

  constructor(toolName: string, reason?: string) {
    super(`Tool ${toolName} denied: ${reason || 'User rejected'}`, 2005);
    this.name = 'ToolDeniedError';
    this.errorCode = 'TOOL_DENIED';
    this.category = 'permission';
    this.retryable = false;
    this.httpStatus = 403;
    this.toolName = toolName;
    this.reason = reason;
    this.details = {
      toolName,
      reason,
    };
  }
}

export class ToolPolicyDeniedError extends ToolExecutionError {
  public toolName: string;
  public reasonCode: string;
  public reason?: string;

  constructor(toolName: string, reasonCode = 'POLICY_DENIED', reason?: string) {
    super(`Tool ${toolName} blocked by policy [${reasonCode}]: ${reason || 'Policy denied'}`, 2006);
    this.name = 'ToolPolicyDeniedError';
    this.errorCode = 'TOOL_POLICY_DENIED';
    this.category = 'permission';
    this.retryable = false;
    this.httpStatus = 403;
    this.toolName = toolName;
    this.reasonCode = reasonCode;
    this.reason = reason;
    this.details = {
      toolName,
      reasonCode,
      reason,
    };
  }
}

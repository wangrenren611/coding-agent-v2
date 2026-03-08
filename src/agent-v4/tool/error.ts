export class ToolExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolExecutionError';
  }
}

export class EmptyToolNameError extends ToolExecutionError {
  constructor() {
    super('Tool name is empty');
    this.name = 'EmptyToolNameError';
  }
}

export class InvalidArgumentsError extends ToolExecutionError {
  public toolName: string;

  constructor(toolName: string, message: string) {
    super(`Invalid arguments format for tool ${toolName}: ${message}`);
    this.name = 'InvalidArgumentsError';
    this.toolName = toolName;
  }
}

export class ToolNotFoundError extends ToolExecutionError {
  public toolName: string;

  constructor(toolName: string) {
    super(`Tool ${toolName} not found`);
    this.name = 'ToolNotFoundError';
    this.toolName = toolName;
  }
}

export class ToolValidationError extends ToolExecutionError {
  public toolName: string;
  public issues: { message: string }[];

  constructor(toolName: string, issues: { message: string }[]) {
    super(issues.map(issue => issue.message).join(', '));
    this.name = 'ToolValidationError';
    this.toolName = toolName;
    this.issues = issues;
  }
}

export class ToolDeniedError extends ToolExecutionError {
  public toolName: string;
  public reason?: string;

  constructor(toolName: string, reason?: string) {
    super(`Tool ${toolName} denied: ${reason || 'User rejected'}`);
    this.name = 'ToolDeniedError';
    this.toolName = toolName;
    this.reason = reason;
  }
}

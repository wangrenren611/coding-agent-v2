export class TaskV2Error extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'TaskV2Error';
    this.code = code;
    this.details = details;
  }
}

export function notFound(entity: 'task' | 'run', id: string): TaskV2Error {
  return new TaskV2Error('NOT_FOUND', `${entity} not found: ${id}`, { entity, id });
}

export function invalidTransition(from: string, to: string): TaskV2Error {
  return new TaskV2Error('INVALID_STATUS_TRANSITION', `invalid transition: ${from} -> ${to}`, {
    from,
    to,
  });
}

export function conflict(message: string, details?: Record<string, unknown>): TaskV2Error {
  return new TaskV2Error('CONFLICT', message, details);
}

export function invalidArgument(message: string, details?: Record<string, unknown>): TaskV2Error {
  return new TaskV2Error('INVALID_ARGUMENT', message, details);
}

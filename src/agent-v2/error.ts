export class AgentError extends Error {
  code: number;
  constructor(message: string, code: number = 1000) {
    super(message);
    this.name = 'AgentError';
    this.code = code;
  }
}

export class AgentQueryError extends Error {
  code: number;
  constructor(message: string = 'Query is empty', code: number = 1001) {
    super(message);
    this.name = 'AgentQueryError';
    this.code = code;
  }
}

export class AgentAbortedError extends AgentError {
  constructor(message: string = 'Agent was aborted', code: number = 1002) {
    super(message, code);
    this.name = 'AgentAbortedError';
  }
}

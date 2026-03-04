/**
 * Agent 错误类定义
 */

/**
 * Agent 循环次数超限错误
 */
export class AgentLoopExceededError extends Error {
  constructor(
    public readonly limit: number,
    public readonly actual: number
  ) {
    super(`Agent loop exceeded: ${actual} > ${limit}`);
    this.name = 'AgentLoopExceededError';
  }
}

/**
 * Agent 中止错误
 */
export class AgentAbortedError extends Error {
  constructor(message: string = 'Agent was aborted') {
    super(message);
    this.name = 'AgentAbortedError';
  }
}

/**
 * Agent 最大重试次数超限错误
 */
export class AgentMaxRetriesExceededError extends Error {
  constructor(
    public readonly retries: number,
    public readonly lastError: Error
  ) {
    super(`Max retries exceeded: ${retries}. Last error: ${lastError.message}`);
    this.name = 'AgentMaxRetriesExceededError';
  }
}

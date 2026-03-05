/**
 * Agent 错误类定义
 */

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

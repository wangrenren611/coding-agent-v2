/**
 * 存储层错误类
 */

/**
 * 存储错误基类
 */
export class StorageError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

/**
 * 会话不存在错误
 */
export class SessionNotFoundError extends StorageError {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`, 'SESSION_NOT_FOUND');
    this.name = 'SessionNotFoundError';
  }
}

/**
 * 上下文不存在错误
 */
export class ContextNotFoundError extends StorageError {
  constructor(sessionId: string) {
    super(`Context not found: ${sessionId}`, 'CONTEXT_NOT_FOUND');
    this.name = 'ContextNotFoundError';
  }
}

/**
 * 存储未初始化错误
 */
export class StorageNotInitializedError extends StorageError {
  constructor() {
    super('Storage not initialized. Call initialize() first.', 'NOT_INITIALIZED');
    this.name = 'StorageNotInitializedError';
  }
}

/**
 * 数据克隆错误
 */
export class CloneError extends StorageError {
  constructor(
    public readonly originalData: unknown,
    cause?: unknown
  ) {
    super('Failed to clone data', 'CLONE_ERROR', cause);
    this.name = 'CloneError';
  }
}

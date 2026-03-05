/**
 * 存储错误类测试
 */

import { describe, it, expect } from 'vitest';
import {
  StorageError,
  SessionNotFoundError,
  ContextNotFoundError,
  StorageNotInitializedError,
  CloneError,
} from '../errors';

describe('errors', () => {
  describe('StorageError', () => {
    it('should create error with message and code', () => {
      const error = new StorageError('Test error', 'TEST_CODE');
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('StorageError');
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.cause).toBeUndefined();
    });

    it('should create error with cause', () => {
      const cause = new Error('Original error');
      const error = new StorageError('Test error', 'TEST_CODE', cause);
      expect(error.cause).toBe(cause);
    });

    it('should be throwable and catchable', () => {
      expect(() => {
        throw new StorageError('Test error', 'TEST_CODE');
      }).toThrow(StorageError);
    });
  });

  describe('SessionNotFoundError', () => {
    it('should create error with session ID', () => {
      const error = new SessionNotFoundError('session-123');
      expect(error).toBeInstanceOf(StorageError);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('SessionNotFoundError');
      expect(error.message).toBe('Session not found: session-123');
      expect(error.code).toBe('SESSION_NOT_FOUND');
    });

    it('should be throwable and catchable', () => {
      expect(() => {
        throw new SessionNotFoundError('session-456');
      }).toThrow(SessionNotFoundError);
    });
  });

  describe('ContextNotFoundError', () => {
    it('should create error with session ID', () => {
      const error = new ContextNotFoundError('session-123');
      expect(error).toBeInstanceOf(StorageError);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('ContextNotFoundError');
      expect(error.message).toBe('Context not found: session-123');
      expect(error.code).toBe('CONTEXT_NOT_FOUND');
    });

    it('should be throwable and catchable', () => {
      expect(() => {
        throw new ContextNotFoundError('session-789');
      }).toThrow(ContextNotFoundError);
    });
  });

  describe('StorageNotInitializedError', () => {
    it('should create error with correct message', () => {
      const error = new StorageNotInitializedError();
      expect(error).toBeInstanceOf(StorageError);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('StorageNotInitializedError');
      expect(error.message).toBe('Storage not initialized. Call initialize() first.');
      expect(error.code).toBe('NOT_INITIALIZED');
    });

    it('should be throwable and catchable', () => {
      expect(() => {
        throw new StorageNotInitializedError();
      }).toThrow(StorageNotInitializedError);
    });
  });

  describe('CloneError', () => {
    it('should create error with original data', () => {
      const data = { foo: 'bar' };
      const error = new CloneError(data);
      expect(error).toBeInstanceOf(StorageError);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('CloneError');
      expect(error.message).toBe('Failed to clone data');
      expect(error.code).toBe('CLONE_ERROR');
      expect(error.originalData).toBe(data);
      expect(error.cause).toBeUndefined();
    });

    it('should create error with cause', () => {
      const data = { foo: 'bar' };
      const cause = new Error('Original error');
      const error = new CloneError(data, cause);
      expect(error.originalData).toBe(data);
      expect(error.cause).toBe(cause);
    });

    it('should be throwable and catchable', () => {
      const data = { test: 123 };
      expect(() => {
        throw new CloneError(data);
      }).toThrow(CloneError);
    });

    it('should handle various data types', () => {
      const testCases = [{ obj: 'data' }, ['array', 'data'], 'string', 123, true, null, undefined];

      for (const data of testCases) {
        const error = new CloneError(data);
        expect(error.originalData).toBe(data);
      }
    });
  });

  describe('error inheritance', () => {
    it('should maintain proper prototype chain', () => {
      const sessionError = new SessionNotFoundError('test');
      expect(sessionError instanceof SessionNotFoundError).toBe(true);
      expect(sessionError instanceof StorageError).toBe(true);
      expect(sessionError instanceof Error).toBe(true);

      const contextError = new ContextNotFoundError('test');
      expect(contextError instanceof ContextNotFoundError).toBe(true);
      expect(contextError instanceof StorageError).toBe(true);
      expect(contextError instanceof Error).toBe(true);

      const initError = new StorageNotInitializedError();
      expect(initError instanceof StorageNotInitializedError).toBe(true);
      expect(initError instanceof StorageError).toBe(true);
      expect(initError instanceof Error).toBe(true);

      const cloneError = new CloneError({});
      expect(cloneError instanceof CloneError).toBe(true);
      expect(cloneError instanceof StorageError).toBe(true);
      expect(cloneError instanceof Error).toBe(true);
    });
  });
});

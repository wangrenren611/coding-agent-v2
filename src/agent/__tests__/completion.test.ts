/**
 * Agent 完成检测器测试
 */

import { describe, it, expect } from 'vitest';
import { defaultCompletionDetector } from '../completion';
import type { AgentStepResult } from '../types';

describe('defaultCompletionDetector', () => {
  describe('when lastStep is undefined', () => {
    it('should return done: false', () => {
      const result = defaultCompletionDetector(undefined);

      expect(result.done).toBe(false);
      expect(result.reason).toBe('stop');
    });
  });

  describe('when lastStep has finishReason "stop" with no tool calls', () => {
    it('should return done: true with reason "stop"', () => {
      const lastStep: AgentStepResult = {
        text: 'Hello',
        toolCalls: [],
        toolResults: [],
        finishReason: 'stop',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        rawChunks: [],
      };

      const result = defaultCompletionDetector(lastStep);

      expect(result.done).toBe(true);
      expect(result.reason).toBe('stop');
    });

    it('should return done: false when tool calls exist', () => {
      const lastStep: AgentStepResult = {
        text: 'Hello',
        toolCalls: [
          { id: '1', type: 'function', index: 0, function: { name: 'test', arguments: '{}' } },
        ],
        toolResults: [],
        finishReason: 'stop',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        rawChunks: [],
      };

      const result = defaultCompletionDetector(lastStep);

      expect(result.done).toBe(false);
    });
  });

  describe('when lastStep has finishReason "length"', () => {
    it('should return done: true with reason "length" and message', () => {
      const lastStep: AgentStepResult = {
        text: 'Truncated text...',
        toolCalls: [],
        toolResults: [],
        finishReason: 'length',
        usage: { prompt_tokens: 10, completion_tokens: 100, total_tokens: 110 },
        rawChunks: [],
      };

      const result = defaultCompletionDetector(lastStep);

      expect(result.done).toBe(true);
      expect(result.reason).toBe('length');
      expect(result.message).toBe('Max tokens reached');
    });
  });

  describe('when lastStep has finishReason "tool_calls"', () => {
    it('should return done: false', () => {
      const lastStep: AgentStepResult = {
        text: '',
        toolCalls: [
          { id: '1', type: 'function', index: 0, function: { name: 'test', arguments: '{}' } },
        ],
        toolResults: [{ toolCallId: '1', result: { success: true, data: 'result' } }],
        finishReason: 'tool_calls',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        rawChunks: [],
      };

      const result = defaultCompletionDetector(lastStep);

      expect(result.done).toBe(false);
    });
  });

  describe('when lastStep has other finishReason', () => {
    it('should return done: false for "content_filter" finishReason', () => {
      const lastStep: AgentStepResult = {
        text: 'Hello',
        toolCalls: [],
        toolResults: [],
        finishReason: 'content_filter',
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        rawChunks: [],
      };

      const result = defaultCompletionDetector(lastStep);

      expect(result.done).toBe(false);
    });

    it('should return done: false for null finishReason', () => {
      const lastStep: AgentStepResult = {
        text: 'Hello',
        toolCalls: [],
        toolResults: [],
        finishReason: null,
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        rawChunks: [],
      };

      const result = defaultCompletionDetector(lastStep);

      expect(result.done).toBe(false);
    });
  });
});

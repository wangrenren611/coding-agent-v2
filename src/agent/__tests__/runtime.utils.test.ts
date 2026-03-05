import { describe, it, expect } from 'vitest';
import {
  LLMAbortedError,
  LLMError,
  LLMPermanentError,
  type Usage,
  type ToolCall,
} from '../../providers';
import {
  accumulateUsage,
  classifyLoopError,
  mergeToolCallDelta,
  type LoopErrorDisposition,
} from '../runtime/utils';

function createToolCall(overrides?: Partial<ToolCall>): ToolCall {
  return {
    id: 'call-1',
    type: 'function',
    index: 0,
    function: {
      name: 'bash',
      arguments: '{"command":"ls"}',
    },
    ...overrides,
  };
}

describe('runtime/utils', () => {
  describe('mergeToolCallDelta', () => {
    it('should create new tool call when no existing matches', () => {
      const next = mergeToolCallDelta([], createToolCall(), 3);
      expect(next).toHaveLength(1);
      expect(next[0]).toEqual(createToolCall());
    });

    it('should merge by id and append incoming arguments', () => {
      const current = [
        createToolCall({
          id: 'call-1',
          function: { name: 'bash', arguments: '{"command":"' },
        }),
      ];
      const delta = createToolCall({
        id: 'call-1',
        function: { name: '', arguments: 'ls -la"}' },
      });

      const next = mergeToolCallDelta(current, delta, 1);

      expect(next[0].function.name).toBe('bash');
      expect(next[0].function.arguments).toBe('{"command":"ls -la"}');
    });

    it('should merge by index when delta id is missing', () => {
      const current = [
        createToolCall({
          id: 'call-abc',
          index: 2,
          function: { name: 'bash', arguments: '{"command":"' },
        }),
      ];
      const delta = createToolCall({
        id: '',
        index: 2,
        function: { name: '', arguments: 'pwd"}' },
      });

      const next = mergeToolCallDelta(current, delta, 2);
      expect(next).toHaveLength(1);
      expect(next[0].id).toBe('call-abc');
      expect(next[0].function.arguments).toBe('{"command":"pwd"}');
    });

    it('should not mutate original input array', () => {
      const current = [createToolCall({ function: { name: 'bash', arguments: '{}' } })];
      const delta = createToolCall({
        id: 'call-1',
        function: { name: 'bash', arguments: '{"x":1}' },
      });

      const next = mergeToolCallDelta(current, delta, 1);
      expect(current[0].function.arguments).toBe('{}');
      expect(next[0].function.arguments).toBe('{}{"x":1}');
    });
  });

  describe('accumulateUsage', () => {
    it('should keep usage unchanged when chunk usage is undefined', () => {
      const stepUsage: Usage = { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 };
      const totalUsage: Usage = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 };
      const result = accumulateUsage(stepUsage, totalUsage, undefined);

      expect(result.stepUsage).toBe(stepUsage);
      expect(result.totalUsage).toBe(totalUsage);
    });

    it('should overwrite step usage and accumulate total usage', () => {
      const stepUsage: Usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      const totalUsage: Usage = { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 };
      const chunkUsage: Usage = { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 };
      const result = accumulateUsage(stepUsage, totalUsage, chunkUsage);

      expect(result.stepUsage).toEqual(chunkUsage);
      expect(result.totalUsage).toEqual({
        prompt_tokens: 13,
        completion_tokens: 24,
        total_tokens: 37,
      });
    });
  });

  describe('classifyLoopError', () => {
    it('should classify permanent error as throw_permanent', () => {
      const result: LoopErrorDisposition = classifyLoopError(
        new LLMPermanentError('permanent error'),
        false
      );
      expect(result).toBe('throw_permanent');
    });

    it('should classify abort error as abort', () => {
      const result: LoopErrorDisposition = classifyLoopError(new LLMAbortedError('aborted'), false);
      expect(result).toBe('abort');
    });

    it('should classify generic llm error as retry', () => {
      const result: LoopErrorDisposition = classifyLoopError(new LLMError('llm failed'), false);
      expect(result).toBe('retry');
    });

    it('should classify unknown error as throw_unknown', () => {
      const result: LoopErrorDisposition = classifyLoopError(new Error('unknown'), false);
      expect(result).toBe('throw_unknown');
    });

    it('should classify any error as abort when state is aborted', () => {
      const result: LoopErrorDisposition = classifyLoopError(new Error('unknown'), true);
      expect(result).toBe('abort');
    });
  });
});

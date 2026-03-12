import { describe, expect, it } from 'bun:test';

import {
  extractErrorMessage,
  buildHelpSegments,
  buildUnsupportedSegments,
} from './chat-local-replies';

describe('chat-local-replies', () => {
  describe('extractErrorMessage', () => {
    it('should extract message from Error object', () => {
      const error = new Error('Test error message');
      const result = extractErrorMessage(error);

      expect(result).toBe('Error: Test error message');
    });

    it('should extract message from Error with custom name', () => {
      const error = new TypeError('Type error occurred');
      const result = extractErrorMessage(error);

      expect(result).toBe('TypeError: Type error occurred');
    });

    it('should handle non-Error values', () => {
      expect(extractErrorMessage('string error')).toBe('string error');
      expect(extractErrorMessage(123)).toBe('123');
      expect(extractErrorMessage(null)).toBe('null');
      expect(extractErrorMessage(undefined)).toBe('undefined');
      expect(extractErrorMessage({ toString: () => 'custom object' })).toBe('custom object');
    });

    it('should handle objects without toString', () => {
      const obj = Object.create(null);
      const result = extractErrorMessage(obj);

      expect(result).toBe('[object Object]');
    });
  });

  describe('buildHelpSegments', () => {
    it('should build help segments with correct structure', () => {
      const turnId = 1;
      const segments = buildHelpSegments(turnId);

      expect(segments).toBeArray();
      expect(segments).toHaveLength(2);

      // 检查第一个segment（thinking）
      const thinkingSegment = segments[0];
      expect(thinkingSegment.id).toBe(`${turnId}:thinking`);
      expect(thinkingSegment.type).toBe('thinking');
      expect(thinkingSegment.content).toBeString();
      expect(thinkingSegment.content).toContain('OpenTUI Agent CLI');

      // 检查第二个segment（text）
      const textSegment = segments[1];
      expect(textSegment.id).toBe(`${turnId}:text`);
      expect(textSegment.type).toBe('text');
      expect(textSegment.content).toBeString();
      expect(textSegment.content).toContain('Available commands:');
      expect(textSegment.content).toContain('/help');
      expect(textSegment.content).toContain('/clear');
      expect(textSegment.content).toContain('/exit');
      expect(textSegment.content).toContain('/models');
      expect(textSegment.content).toContain('/files');
      expect(textSegment.content).toContain('Keyboard shortcuts:');
    });

    it('should generate unique IDs for different turn IDs', () => {
      const segments1 = buildHelpSegments(1);
      const segments2 = buildHelpSegments(2);

      expect(segments1[0].id).toBe('1:thinking');
      expect(segments1[1].id).toBe('1:text');
      expect(segments2[0].id).toBe('2:thinking');
      expect(segments2[1].id).toBe('2:text');
    });

    it('should include all command information', () => {
      const segments = buildHelpSegments(1);
      const textContent = segments[1].content;

      expect(textContent).toContain('/help (/commands) - show help');
      expect(textContent).toContain('/clear (/new) - clear all turns');
      expect(textContent).toContain('/exit (/quit /q) - exit app');
      expect(textContent).toContain('/models (/model) - open model selector');
      expect(textContent).toContain('/files (/file) - attach workspace files');
    });

    it('should include keyboard shortcuts', () => {
      const segments = buildHelpSegments(1);
      const textContent = segments[1].content;

      expect(textContent).toContain('Esc - stop current response when the agent is thinking');
      expect(textContent).toContain('Ctrl+L - clear conversation panel');
      expect(textContent).toContain('Use /files to attach local workspace files');
    });
  });

  describe('buildUnsupportedSegments', () => {
    it('should build unsupported segments with command name', () => {
      const turnId = 1;
      const commandName = 'export';
      const segments = buildUnsupportedSegments(turnId, commandName);

      expect(segments).toBeArray();
      expect(segments).toHaveLength(2);

      // 检查thinking segment
      const thinkingSegment = segments[0];
      expect(thinkingSegment.id).toBe(`${turnId}:thinking`);
      expect(thinkingSegment.type).toBe('thinking');
      expect(thinkingSegment.content).toBeString();
      expect(thinkingSegment.content).toContain(commandName);
      expect(thinkingSegment.content).toContain('not implemented');

      // 检查text segment
      const textSegment = segments[1];
      expect(textSegment.id).toBe(`${turnId}:text`);
      expect(textSegment.type).toBe('text');
      expect(textSegment.content).toBeString();
      expect(textSegment.content).toContain(`/${commandName}`);
      expect(textSegment.content).toContain('not implemented yet');
    });

    it('should handle different command names', () => {
      const testCases = [
        { command: 'fork', expected: 'fork' },
        { command: 'init', expected: 'init' },
        { command: 'sessions', expected: 'sessions' },
        { command: 'review', expected: 'review' },
      ];

      for (const testCase of testCases) {
        const segments = buildUnsupportedSegments(1, testCase.command);
        const textContent = segments[1].content;

        expect(textContent).toContain(`/${testCase.command}`);
      }
    });

    it('should generate unique IDs for different turn IDs', () => {
      const segments1 = buildUnsupportedSegments(1, 'export');
      const segments2 = buildUnsupportedSegments(2, 'export');

      expect(segments1[0].id).toBe('1:thinking');
      expect(segments1[1].id).toBe('1:text');
      expect(segments2[0].id).toBe('2:thinking');
      expect(segments2[1].id).toBe('2:text');
    });
  });
});

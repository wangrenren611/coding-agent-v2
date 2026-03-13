/**
 * estimateTokens 测试
 */

import { describe, it, expect } from 'vitest';
import { estimateTokens } from '../token';

describe('estimateTokens', () => {
  it('should return 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('should return 1 for whitespace-only short text', () => {
    expect(estimateTokens('   ')).toBe(1);
  });

  it('should estimate English text correctly', () => {
    const text = 'Hello world this is a test';
    expect(estimateTokens(text)).toBe(7);
  });

  it('should estimate Chinese text correctly', () => {
    const text = '你好世界这是一个测试';
    expect(estimateTokens(text)).toBe(15);
  });

  it('should estimate mixed text within reasonable range', () => {
    const text = 'Hello 你好 World 世界';
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThanOrEqual(9);
    expect(tokens).toBeLessThanOrEqual(10);
  });

  it('should handle special characters', () => {
    const text = '!@#$%^&*()';
    expect(estimateTokens(text)).toBe(3);
  });

  it('should round up fractional token counts', () => {
    expect(estimateTokens('abcde')).toBe(2);
  });
});

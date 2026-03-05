/**
 * 文件名编解码测试
 */

import { describe, it, expect } from 'vitest';
import { encodeEntityFileName, safeDecodeEntityFileName } from '../filename-codec';

describe('filename-codec', () => {
  describe('encodeEntityFileName', () => {
    it('should encode simple strings', () => {
      expect(encodeEntityFileName('test')).toBe('test.json');
      expect(encodeEntityFileName('session-123')).toBe('session-123.json');
    });

    it('should encode special characters', () => {
      expect(encodeEntityFileName('test/path')).toBe('test!s!path.json');
      expect(encodeEntityFileName('test\\path')).toBe('test!b!path.json');
      expect(encodeEntityFileName('test:path')).toBe('test!c!path.json');
      expect(encodeEntityFileName('test*path')).toBe('test!a!path.json');
      expect(encodeEntityFileName('test?path')).toBe('test!q!path.json');
      expect(encodeEntityFileName('test"path')).toBe('test!d!path.json');
      expect(encodeEntityFileName('test<path')).toBe('test!l!path.json');
      expect(encodeEntityFileName('test>path')).toBe('test!g!path.json');
      expect(encodeEntityFileName('test|path')).toBe('test!p!path.json');
    });

    it('should encode exclamation mark', () => {
      expect(encodeEntityFileName('test!path')).toBe('test!!path.json');
    });

    it('should encode null character', () => {
      expect(encodeEntityFileName('test\0path')).toBe('test!n!path.json');
    });

    it('should encode multiple special characters', () => {
      expect(encodeEntityFileName('a/b:c*d')).toBe('a!s!b!c!c!a!d.json');
    });

    it('should handle UUIDs', () => {
      const uuid = '123e4567-e89b-12d3-a456-426614174000';
      expect(encodeEntityFileName(uuid)).toBe(`${uuid}.json`);
    });

    it('should handle empty string', () => {
      expect(encodeEntityFileName('')).toBe('.json');
    });

    it('should handle strings with only special characters', () => {
      expect(encodeEntityFileName('/:\\*?')).toBe('!s!!c!!b!!a!!q!.json');
    });
  });

  describe('safeDecodeEntityFileName', () => {
    it('should decode simple strings', () => {
      expect(safeDecodeEntityFileName('test.json')).toBe('test');
      expect(safeDecodeEntityFileName('session-123.json')).toBe('session-123');
    });

    it('should decode encoded special characters', () => {
      expect(safeDecodeEntityFileName('test!s!path.json')).toBe('test/path');
      expect(safeDecodeEntityFileName('test!b!path.json')).toBe('test\\path');
      expect(safeDecodeEntityFileName('test!c!path.json')).toBe('test:path');
      expect(safeDecodeEntityFileName('test!a!path.json')).toBe('test*path');
      expect(safeDecodeEntityFileName('test!q!path.json')).toBe('test?path');
      expect(safeDecodeEntityFileName('test!d!path.json')).toBe('test"path');
      expect(safeDecodeEntityFileName('test!l!path.json')).toBe('test<path');
      expect(safeDecodeEntityFileName('test!g!path.json')).toBe('test>path');
      expect(safeDecodeEntityFileName('test!p!path.json')).toBe('test|path');
    });

    it('should decode exclamation mark', () => {
      expect(safeDecodeEntityFileName('test!!path.json')).toBe('test!path');
    });

    it('should decode null character', () => {
      expect(safeDecodeEntityFileName('test!n!path.json')).toBe('test\0path');
    });

    it('should decode multiple special characters', () => {
      expect(safeDecodeEntityFileName('a!s!b!c!c!a!d.json')).toBe('a/b:c*d');
    });

    it('should handle strings without .json extension', () => {
      expect(safeDecodeEntityFileName('test')).toBe('test');
    });

    it('should return null for invalid escape sequences', () => {
      expect(safeDecodeEntityFileName('test!x!path.json')).toBeNull();
      expect(safeDecodeEntityFileName('test!z.json')).toBeNull();
    });

    it('should handle incomplete escape sequences', () => {
      // '!' at end without sequence
      expect(safeDecodeEntityFileName('test!.json')).toBeNull();
    });

    it('should handle empty string', () => {
      expect(safeDecodeEntityFileName('.json')).toBe('');
      expect(safeDecodeEntityFileName('')).toBe('');
    });
  });

  describe('round-trip encoding', () => {
    it('should round-trip simple strings', () => {
      const testCases = ['test', 'session-123', 'abc_def', 'CamelCase'];
      for (const testCase of testCases) {
        const encoded = encodeEntityFileName(testCase);
        const decoded = safeDecodeEntityFileName(encoded);
        expect(decoded).toBe(testCase);
      }
    });

    it('should round-trip strings with special characters', () => {
      const testCases = [
        'test/path',
        'test\\path',
        'test:path',
        'test*path',
        'test?path',
        'test"path',
        'test<path',
        'test>path',
        'test|path',
        'test!path',
      ];
      for (const testCase of testCases) {
        const encoded = encodeEntityFileName(testCase);
        const decoded = safeDecodeEntityFileName(encoded);
        expect(decoded).toBe(testCase);
      }
    });

    it('should round-trip complex strings', () => {
      const testCases = [
        'C:\\Users\\test\\file.txt',
        '/usr/local/bin/node',
        'https://example.com/path?query=value',
        'file*name?test<>|"\\',
      ];
      for (const testCase of testCases) {
        const encoded = encodeEntityFileName(testCase);
        const decoded = safeDecodeEntityFileName(encoded);
        expect(decoded).toBe(testCase);
      }
    });

    it('should round-trip UUIDs', () => {
      const uuid = '123e4567-e89b-12d3-a456-426614174000';
      const encoded = encodeEntityFileName(uuid);
      const decoded = safeDecodeEntityFileName(encoded);
      expect(decoded).toBe(uuid);
    });
  });
});

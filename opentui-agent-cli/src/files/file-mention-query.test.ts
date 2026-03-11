import { describe, expect, it } from 'bun:test';

import { findTrailingFileMention, removeTrailingFileMention } from './file-mention-query';

describe('file-mention-query', () => {
  it('finds trailing @/ mention at input start', () => {
    expect(findTrailingFileMention('@/src')).toEqual({
      token: '@/src',
      query: 'src',
      start: 0,
      end: 5,
    });
  });

  it('finds trailing @/ mention after text', () => {
    expect(findTrailingFileMention('check @/src/app')).toEqual({
      token: '@/src/app',
      query: 'src/app',
      start: 6,
      end: 15,
    });
  });

  it('returns null when mention is not trailing token', () => {
    expect(findTrailingFileMention('use @/src and continue')).toBeNull();
    expect(findTrailingFileMention('plain text')).toBeNull();
  });

  it('removes trailing mention token and keeps prior text', () => {
    expect(removeTrailingFileMention('@/src')).toBe('');
    expect(removeTrailingFileMention('check @/src/app')).toBe('check ');
    expect(removeTrailingFileMention('plain text')).toBe('plain text');
  });
});

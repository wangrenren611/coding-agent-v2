import { describe, expect, it } from 'vitest';

import { extractOsc11Color, modeFromColor, parseTerminalColor } from './terminal-theme';

describe('parseTerminalColor', () => {
  it('parses rgb:RRRR/GGGG/BBBB format', () => {
    expect(parseTerminalColor('rgb:ffff/8080/0000')).toEqual({
      r: 255,
      g: 128,
      b: 0,
    });
  });

  it('parses #RRGGBB format', () => {
    expect(parseTerminalColor('#1a2b3c')).toEqual({
      r: 26,
      g: 43,
      b: 60,
    });
  });

  it('parses rgb(R,G,B) format', () => {
    expect(parseTerminalColor('rgb(12, 34, 56)')).toEqual({
      r: 12,
      g: 34,
      b: 56,
    });
  });

  it('returns null for unsupported values', () => {
    expect(parseTerminalColor('rgba(1,2,3,0.5)')).toBeNull();
    expect(parseTerminalColor('#12345')).toBeNull();
  });
});

describe('extractOsc11Color', () => {
  it('extracts OSC 11 color payload', () => {
    const input = '\u001b]11;rgb:ffff/eeee/dddd\u0007';
    expect(extractOsc11Color(input)).toBe('rgb:ffff/eeee/dddd');
  });

  it('returns null when payload is absent', () => {
    expect(extractOsc11Color('plain text')).toBeNull();
  });
});

describe('modeFromColor', () => {
  it('detects dark backgrounds', () => {
    expect(modeFromColor({ r: 5, g: 6, b: 8 })).toBe('dark');
  });

  it('detects light backgrounds', () => {
    expect(modeFromColor({ r: 245, g: 246, b: 248 })).toBe('light');
  });
});

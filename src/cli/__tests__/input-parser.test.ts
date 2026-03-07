import { describe, expect, it } from 'vitest';
import { createRawInputParseState, parseRawInputChunk } from '../input-parser';

describe('raw input parser', () => {
  it('keeps multiline bracketed paste and submits only on explicit enter', () => {
    let state = createRawInputParseState();
    let result = parseRawInputChunk(state, '\u001B[200~line1\nline2\u001B[201~');
    state = result;

    expect(result.submitted).toBe(false);
    expect(result.aborted).toBe(false);
    expect(result.buffer).toBe('line1\nline2');

    result = parseRawInputChunk(state, '\r');
    expect(result.submitted).toBe(true);
    expect(result.buffer).toBe('line1\nline2');
  });

  it('treats sufficiently long unwrapped multiline chunk as paste content', () => {
    let state = createRawInputParseState();
    let result = parseRawInputChunk(state, 'line1\nline2');
    state = result;

    expect(result.submitted).toBe(false);
    expect(result.buffer).toBe('line1\nline2');

    result = parseRawInputChunk(state, '\r');
    expect(result.submitted).toBe(true);
    expect(result.buffer).toBe('line1\nline2');
  });

  it('handles bracketed paste markers split across chunks', () => {
    let state = createRawInputParseState();
    let result = parseRawInputChunk(state, '\u001B[20');
    state = result;
    expect(result.buffer).toBe('');
    expect(result.pending).toBe('\u001B[20');

    result = parseRawInputChunk(state, '0~hello\nworld');
    state = result;
    expect(result.submitted).toBe(false);
    expect(result.buffer).toBe('hello\nworld');
    expect(result.inBracketedPaste).toBe(true);

    result = parseRawInputChunk(state, '\u001B[201~');
    state = result;
    expect(result.inBracketedPaste).toBe(false);
    expect(result.buffer).toBe('hello\nworld');

    result = parseRawInputChunk(state, '\r');
    expect(result.submitted).toBe(true);
    expect(result.buffer).toBe('hello\nworld');
  });
});

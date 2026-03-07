import { describe, expect, it } from 'vitest';
import { createRawInputParseState, parseRawInputChunk } from '../input-parser';
import { LiveRegionManager } from '../live-region';

// ============================================================================
// P1 Issues Test Cases
// ============================================================================

describe('P1: Ctrl+C (abort) handling', () => {
  it('should handle Ctrl+C (\\u0003) as abort signal', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, 'hello\u0003');

    expect(result.aborted).toBe(true);
    expect(result.buffer).toBe('hello');
    expect(result.submitted).toBe(false);
  });

  it('should handle Ctrl+C at the beginning', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, '\u0003');

    expect(result.aborted).toBe(true);
    expect(result.buffer).toBe('');
  });

  // BUG REPRODUCTION: Ctrl+C followed by newline is not handled correctly
  // The looksLikeUnwrappedPaste heuristic bypasses normal processing
  it('[BUG] should abort immediately on Ctrl+C, ignoring subsequent characters', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, 'test\u0003\n');

    // Expected: aborted=true, submitted=false
    // Actual: aborted=false (because paste heuristic kicks in)
    expect(result.aborted).toBe(true);
    expect(result.submitted).toBe(false);
  });
});

describe('P1: pending buffer unbounded growth', () => {
  // BUG REPRODUCTION: pending buffer can grow unboundedly
  it('[BUG] should limit pending buffer size for incomplete sequences', () => {
    let state = createRawInputParseState();

    // Send incomplete marker prefix repeatedly - simulates malicious input
    for (let i = 0; i < 100; i++) {
      state = parseRawInputChunk(state, '\u001B[20');
    }

    // Expected: pending should have a reasonable upper bound (< 100 chars)
    // Actual: pending grows unboundedly (currently 600+ chars)
    expect(state.pending.length).toBeLessThan(100);
  });
});

describe('P1: LiveRegionManager state management', () => {
  function createMockStream() {
    let output = '';
    return {
      write(chunk: string) {
        output += chunk;
        return true;
      },
      getOutput() {
        return output;
      },
      columns: 80,
      rows: 24,
    };
  }

  it('should clear buffered lines after rendering when suspended', () => {
    const mock = createMockStream();
    const manager = new LiveRegionManager(mock as unknown as NodeJS.WriteStream);

    manager.render(['status-1']);

    manager.withHidden(() => {
      manager.render(['status-2']);
    });

    const output = mock.getOutput();
    expect(output).toContain('status-2');
  });

  it('should handle deeply nested withHidden calls', () => {
    const mock = createMockStream();
    const manager = new LiveRegionManager(mock as unknown as NodeJS.WriteStream);

    manager.render(['initial']);

    manager.withHidden(() => {
      manager.render(['level-1']);

      manager.withHidden(() => {
        manager.render(['level-2']);

        manager.withHidden(() => {
          manager.render(['level-3']);
        });
      });
    });

    const output = mock.getOutput();
    expect(output).toContain('level-3');
  });
});

// ============================================================================
// P2 Issues Test Cases
// ============================================================================

describe('P2: Backspace handling', () => {
  it('should handle backspace (\\u007F)', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, 'abc\u007F');

    expect(result.buffer).toBe('ab');
    expect(result.submitted).toBe(false);
    expect(result.aborted).toBe(false);
  });

  it('should handle backspace (\\b)', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, 'abc\b');

    expect(result.buffer).toBe('ab');
  });

  it('should handle multiple backspaces', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, 'hello\b\b\b');

    expect(result.buffer).toBe('he');
  });

  it('should not crash on backspace with empty buffer', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, '\u007F\u007F\u007F');

    expect(result.buffer).toBe('');
    expect(result.aborted).toBe(false);
  });
});

describe('P2: Special key sequences', () => {
  it('should consume Delete key sequence (\\u001B[3~) without affecting buffer', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, 'abc\u001B[3~def');

    // Delete key sends ESC[3~ sequence, should be consumed as escape sequence
    expect(result.buffer).toBe('abcdef');
  });

  it('should consume arrow keys without affecting buffer', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, 'abc\u001B[A\u001B[B\u001B[C\u001B[Ddef');

    expect(result.buffer).toBe('abcdef');
  });

  it('should consume Home/End keys without affecting buffer', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, 'abc\u001B[H\u001B[Fdef');

    expect(result.buffer).toBe('abcdef');
  });
});

describe('P2: Submit handling with newline', () => {
  // BUG REPRODUCTION: Single newline in input triggers paste heuristic
  it('[BUG] should submit on single newline character', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, '\n');

    // Expected: submitted=true
    // Actual: submitted=false (empty input with newline doesn't trigger heuristic, this passes)
    expect(result.submitted).toBe(true);
  });

  // BUG REPRODUCTION: Content followed by newline triggers paste heuristic
  it('[BUG] should submit when content ends with newline (not treated as paste)', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, 'hello\n');

    // Expected: submitted=true, buffer='hello' (newline consumed)
    // Actual: submitted=false, buffer='hello\n' (treated as paste)
    expect(result.submitted).toBe(true);
    expect(result.buffer).toBe('hello');
  });

  // BUG REPRODUCTION: CR should also trigger submit
  it('[BUG] should submit on carriage return', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, 'hello\r');

    // Expected: submitted=true
    // Actual: submitted=false (paste heuristic)
    expect(result.submitted).toBe(true);
    expect(result.buffer).toBe('hello');
  });

  // BUG REPRODUCTION: CRLF should trigger submit
  it('[BUG] should submit on CRLF', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, 'hello\r\n');

    // Expected: submitted=true
    // Actual: submitted=false (paste heuristic)
    expect(result.submitted).toBe(true);
    expect(result.buffer).toBe('hello');
  });
});

describe('P2: Multi-chunk submit handling', () => {
  // BUG REPRODUCTION: Second chunk with newline triggers paste heuristic
  it('[BUG] should submit when second chunk ends with newline', () => {
    let state = parseRawInputChunk(createRawInputParseState(), 'hel');
    expect(state.buffer).toBe('hel');
    expect(state.submitted).toBe(false);

    // Second chunk contains newline, should trigger submit
    // But currently triggers paste heuristic instead
    state = parseRawInputChunk(state, 'lo\n');

    // Expected: submitted=true, buffer='hello'
    // Actual: submitted=false, buffer='hello\n'
    expect(state.buffer).toBe('hello');
    expect(state.submitted).toBe(true);
  });

  it('should accumulate buffer across multiple chunks without newline', () => {
    let state = parseRawInputChunk(createRawInputParseState(), 'hel');
    expect(state.buffer).toBe('hel');

    state = parseRawInputChunk(state, 'lo');
    expect(state.buffer).toBe('hello');
    expect(state.submitted).toBe(false);
  });
});

describe('P2: Unicode and Emoji handling', () => {
  it('should handle basic Unicode characters', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, '你好世界');

    expect(result.buffer).toBe('你好世界');
  });

  it('should handle emoji', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, 'hello 👋 world');

    expect(result.buffer).toBe('hello 👋 world');
  });

  // KNOWN LIMITATION: ZWJ sequences are split by spread operator
  it('should handle backspace on emoji (known ZWJ limitation)', () => {
    const state = createRawInputParseState();
    // 👨‍👩‍👧‍👦 is a ZWJ sequence consisting of multiple code points
    const family = '👨‍👩‍👧‍👦';
    const result = parseRawInputChunk(state, family + '\u007F');

    // Current: spread splits ZWJ, one backspace removes only one code point
    // This is a known limitation - buffer will still have some characters
    expect(result.buffer.length).toBeLessThan(family.length);
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it('should handle combining characters', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, 'e\u0301');

    expect(result.buffer).toBe('e\u0301');
  });

  it('should handle backspace on combining characters', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, 'e\u0301\u007F');

    // Backspace removes one code point (the combining char)
    expect(result.buffer).toBe('e');
  });
});

describe('P2: Edge cases', () => {
  it('should handle empty input', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, '');

    expect(result.buffer).toBe('');
    expect(result.submitted).toBe(false);
    expect(result.aborted).toBe(false);
  });

  it('should handle very long single line input', () => {
    const state = createRawInputParseState();
    const longInput = 'a'.repeat(10000);
    const result = parseRawInputChunk(state, longInput);

    expect(result.buffer).toBe(longInput);
  });

  it('should handle tab character', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, 'hello\tworld');

    expect(result.buffer).toBe('hello\tworld');
  });
});

describe('P2: Escape sequence handling', () => {
  it('should handle split escape sequences across chunks', () => {
    let state = createRawInputParseState();

    state = parseRawInputChunk(state, 'abc\u001B');
    expect(state.buffer).toBe('abc');
    expect(state.pending).toBe('\u001B');

    state = parseRawInputChunk(state, '[Adef');
    expect(state.buffer).toBe('abcdef');
  });

  it('should handle incomplete escape sequence at end of input', () => {
    let state = createRawInputParseState();

    state = parseRawInputChunk(state, 'abc\u001B[');
    expect(state.buffer).toBe('abc');
    expect(state.pending.length).toBeGreaterThan(0);
  });
});

describe('P2: Bracketed paste handling', () => {
  it('should keep multiline bracketed paste and submit only on explicit enter', () => {
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

  it('should normalize CRLF to LF in bracketed paste', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, '\u001B[200~line1\r\nline2\u001B[201~');

    expect(result.buffer).toBe('line1\nline2');
  });

  it('should handle bracketed paste markers split across chunks', () => {
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

// ============================================================================
// P3 Issues Test Cases
// ============================================================================

describe('P3: Input state immutability', () => {
  it('should not mutate input state object', () => {
    const originalState = createRawInputParseState();
    const stateCopy = { ...originalState };

    parseRawInputChunk(originalState, 'hello');

    expect(originalState.buffer).toBe(stateCopy.buffer);
    expect(originalState.pending).toBe(stateCopy.pending);
    expect(originalState.inBracketedPaste).toBe(stateCopy.inBracketedPaste);
  });
});

describe('P3: Concurrent input handling simulation', () => {
  it('should handle rapid consecutive chunks', () => {
    let state = createRawInputParseState();

    for (let i = 0; i < 100; i++) {
      state = parseRawInputChunk(state, String.fromCharCode(97 + (i % 26)));
    }

    expect(state.buffer.length).toBe(100);
  });

  it('should handle alternating input and backspace', () => {
    let state = createRawInputParseState();

    for (let i = 0; i < 50; i++) {
      state = parseRawInputChunk(state, 'a');
      state = parseRawInputChunk(state, '\u007F');
    }

    expect(state.buffer).toBe('');
  });
});

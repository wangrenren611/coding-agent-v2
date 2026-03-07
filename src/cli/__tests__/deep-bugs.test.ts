import { describe, expect, it } from 'vitest';
import { createRawInputParseState, parseRawInputChunk } from '../input-parser';
import { LiveRegionManager } from '../live-region';
import { TerminalUi } from '../terminal-ui';

// ============================================================================
// Deep Analysis: Additional Bug Test Cases
// ============================================================================

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

describe('Deep Analysis: pending buffer unbounded growth', () => {
  it('[BUG] pending buffer should have upper bound limit', () => {
    let state = createRawInputParseState();

    // Send incomplete marker prefix repeatedly - simulates malicious/buggy input
    for (let i = 0; i < 100; i++) {
      state = parseRawInputChunk(state, '\u001B[20');
    }

    // BUG: pending grows unboundedly (600+ chars)
    // Expected: pending should have a reasonable upper bound (< 100 chars)
    console.log('Pending buffer length:', state.pending.length);
    expect(state.pending.length).toBeLessThan(100);
  });

  it('[BUG] pending buffer can accumulate escape sequences', () => {
    let state = createRawInputParseState();

    // Send incomplete escape sequences
    for (let i = 0; i < 50; i++) {
      state = parseRawInputChunk(state, '\u001B[');
    }

    console.log('Escape sequence pending length:', state.pending.length);
    expect(state.pending.length).toBeLessThan(50);
  });
});

describe('Deep Analysis: looksLikeUnwrappedPaste heuristic issues', () => {
  // The core bug: looksLikeUnwrappedPaste bypasses normal character processing
  // This causes Ctrl+C and other special characters to be ignored

  it('[BUG] heuristic should not bypass Ctrl+C detection', () => {
    const state = createRawInputParseState();
    // This looks like paste (contains both newline and non-newline chars)
    // but also contains Ctrl+C which should abort
    const result = parseRawInputChunk(state, 'hello\nworld\u0003');

    // BUG: aborted is false because paste heuristic kicks in first
    expect(result.aborted).toBe(true);
  });

  it('[BUG] heuristic should not bypass backspace processing', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, 'hello\nworld\u007F');

    // BUG: backspace is not processed because paste heuristic kicks in
    expect(result.buffer).toBe('hello\nworl');
  });

  it('should distinguish single-char input with newline from paste', () => {
    const state = createRawInputParseState();
    // Single character + newline should NOT be treated as paste
    // It should submit immediately
    const result = parseRawInputChunk(state, 'a\n');

    expect(result.submitted).toBe(true);
    expect(result.buffer).toBe('a');
  });

  it('[BUG] content with trailing newline should submit, not be treated as paste', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, 'hello world\n');

    // BUG: Treated as paste, submitted=false
    expect(result.submitted).toBe(true);
    expect(result.buffer).toBe('hello world');
  });
});

describe('Deep Analysis: TerminalUi edge cases', () => {
  it('should handle empty text stream gracefully', () => {
    const mock = createMockStream();
    const ui = new TerminalUi({
      sessionId: 's1',
      stream: mock as unknown as NodeJS.WriteStream,
    });

    ui.dispatch({ type: 'stream.text', text: '' });
    ui.close();

    const output = mock.getOutput();
    // Should not crash, output can be empty
    expect(typeof output).toBe('string');
  });

  it('should handle rapid state transitions', () => {
    const mock = createMockStream();
    const ui = new TerminalUi({
      sessionId: 's1',
      stream: mock as unknown as NodeJS.WriteStream,
    });

    // Rapid fire events
    for (let i = 0; i < 100; i++) {
      ui.dispatch({ type: 'stream.text', text: `line${i}\n` });
    }
    ui.dispatch({ type: 'run.finish', completionReason: 'stop' });
    ui.close();

    const output = mock.getOutput();
    expect(output.length).toBeGreaterThan(0);
  });

  it('should handle close called multiple times', () => {
    const mock = createMockStream();
    const ui = new TerminalUi({
      sessionId: 's1',
      stream: mock as unknown as NodeJS.WriteStream,
    });

    ui.dispatch({ type: 'message.user', text: 'hello' });
    ui.close();
    ui.close(); // Second close should be safe
    ui.close(); // Third close should be safe

    const output = mock.getOutput();
    expect(output).toContain('hello');
  });

  it('should handle dispatch after close gracefully', () => {
    const mock = createMockStream();
    const ui = new TerminalUi({
      sessionId: 's1',
      stream: mock as unknown as NodeJS.WriteStream,
    });

    ui.dispatch({ type: 'message.user', text: 'before close' });
    ui.close();
    ui.dispatch({ type: 'message.user', text: 'after close' }); // Should be ignored

    const output = mock.getOutput();
    expect(output).toContain('before close');
    expect(output).not.toContain('after close');
  });
});

describe('Deep Analysis: LiveRegionManager edge cases', () => {
  it('should handle empty render array', () => {
    const mock = createMockStream();
    const manager = new LiveRegionManager(mock as unknown as NodeJS.WriteStream);

    manager.render([]);
    manager.clear();

    // Should not crash
    expect(true).toBe(true);
  });

  it('should handle concurrent withHidden calls correctly', () => {
    const mock = createMockStream();
    const manager = new LiveRegionManager(mock as unknown as NodeJS.WriteStream);

    manager.render(['initial']);

    // Simulate concurrent suspension
    const results: string[] = [];

    manager.withHidden(() => {
      results.push('outer-start');
      manager.withHidden(() => {
        results.push('inner');
      });
      results.push('outer-end');
    });

    expect(results).toEqual(['outer-start', 'inner', 'outer-end']);
  });

  it('should not re-render same content', () => {
    const mock = createMockStream();
    const manager = new LiveRegionManager(mock as unknown as NodeJS.WriteStream);

    manager.render(['same']);
    const output1 = mock.getOutput().length;

    manager.render(['same']); // Should be skipped
    const output2 = mock.getOutput().length;

    expect(output2).toBe(output1);
  });
});

describe('Deep Analysis: skipEscapeSequence edge cases', () => {
  it('should handle incomplete escape sequence at end of input', () => {
    let state = createRawInputParseState();

    state = parseRawInputChunk(state, 'abc\u001B[');
    // Escape sequence is incomplete, should be kept in pending
    expect(state.buffer).toBe('abc');
    expect(state.pending.length).toBeGreaterThan(0);
  });

  it('should handle escape with non-bracket character', () => {
    const state = createRawInputParseState();
    // ESC followed by non-[ character should just be ignored
    const result = parseRawInputChunk(state, 'abc\u001BXdef');

    // ESC X is not a CSI sequence, ESC should be consumed but X should be processed
    expect(result.buffer).toBe('abcXdef');
  });

  it('should handle very long escape sequence', () => {
    const state = createRawInputParseState();
    // Long but valid escape sequence
    const result = parseRawInputChunk(state, 'abc\u001B[123;456;789mdef');

    expect(result.buffer).toBe('abcdef');
  });
});

describe('Deep Analysis: Input state consistency', () => {
  it('should maintain consistent state after abort', () => {
    let state = createRawInputParseState();

    state = parseRawInputChunk(state, 'hello');
    expect(state.buffer).toBe('hello');

    const afterAbort = parseRawInputChunk(state, '\u0003');
    expect(afterAbort.aborted).toBe(true);
    expect(afterAbort.buffer).toBe('hello');
    expect(afterAbort.pending).toBe(''); // Should be cleared after abort
    expect(afterAbort.submitted).toBe(false);
  });

  it('should maintain consistent state after submit', () => {
    let state = createRawInputParseState();

    state = parseRawInputChunk(state, 'hello');
    expect(state.buffer).toBe('hello');

    // BUG: newline triggers paste heuristic
    const afterSubmit = parseRawInputChunk(state, '\r');
    console.log(
      'After submit - submitted:',
      afterSubmit.submitted,
      'buffer:',
      JSON.stringify(afterSubmit.buffer)
    );

    // After submit, pending should be cleared
    expect(afterSubmit.pending).toBe('');
  });
});

describe('Deep Analysis: Security considerations', () => {
  it('should handle extremely long input without crashing', () => {
    const state = createRawInputParseState();
    const longInput = 'a'.repeat(100000);

    // Should not crash or hang
    const result = parseRawInputChunk(state, longInput);
    expect(result.buffer.length).toBe(100000);
  });

  it('should handle binary-like input gracefully', () => {
    const state = createRawInputParseState();

    // Send various control characters
    let result = state;
    for (let i = 0; i < 32; i++) {
      if (i === 3) continue; // Skip Ctrl+C
      if (i === 10 || i === 13) continue; // Skip newline/CR (triggers submit/paste)
      result = parseRawInputChunk(result, String.fromCharCode(i) + 'a');
    }

    // Should not crash, some chars are filtered
    expect(typeof result.buffer).toBe('string');
  });
});

// ============================================================================
// Controller Bug Analysis
// ============================================================================

describe('Deep Analysis: Controller edge cases', () => {
  it('should handle normalizeAnswer correctly', () => {
    // Test the normalizeAnswer function behavior
    // This is a helper function test
    const inputs = ['  HELLO  ', 'Hello', 'hello', '\tHello\n'];
    const expected = 'hello';

    for (const input of inputs) {
      const normalized = input.trim().toLowerCase();
      expect(normalized).toBe(expected);
    }
  });

  it('should handle exit commands with different cases', () => {
    const exitCommands = ['/exit', '/EXIT', '/Exit', '  /exit  '];
    const normalizedSet = new Set(['/exit', '/quit', 'exit', 'quit'].map((s) => s.toLowerCase()));

    for (const cmd of exitCommands) {
      const normalized = cmd.trim().toLowerCase();
      expect(normalizedSet.has(normalized)).toBe(true);
    }
  });
});

// ============================================================================
// TerminalUi Additional Bug Analysis
// ============================================================================

describe('Deep Analysis: TerminalUi streaming edge cases', () => {
  it('should handle stream.text with isReasoning=true correctly', () => {
    const mock = createMockStream();
    const ui = new TerminalUi({
      sessionId: 's1',
      stream: mock as unknown as NodeJS.WriteStream,
    });

    ui.dispatch({
      type: 'stream.text',
      text: 'reasoning content',
      isReasoning: true,
      messageId: 'm1',
    });
    ui.dispatch({
      type: 'stream.text',
      text: 'actual content',
      isReasoning: false,
      messageId: 'm1',
    });
    ui.dispatch({ type: 'run.finish', completionReason: 'stop' });
    ui.close();

    const output = mock.getOutput();
    // Reasoning content should not be rendered in stream.text
    // But actual content should be
    expect(output).toContain('actual content');
  });

  it('should handle assistant.snapshot with empty content', () => {
    const mock = createMockStream();
    const ui = new TerminalUi({
      sessionId: 's1',
      stream: mock as unknown as NodeJS.WriteStream,
    });

    ui.dispatch({
      type: 'assistant.snapshot',
      messageId: 'm1',
      content: '',
      reasoningContent: '',
      finishReason: 'stop',
    });
    ui.close();

    // Should not crash
    const output = mock.getOutput();
    expect(typeof output).toBe('string');
  });

  it('should handle tool events in wrong order gracefully', () => {
    const mock = createMockStream();
    const ui = new TerminalUi({
      sessionId: 's1',
      stream: mock as unknown as NodeJS.WriteStream,
    });

    // Send 'end' event without 'start' first
    ui.dispatch({
      type: 'stream.tool',
      event: {
        type: 'end',
        toolCallId: 't1',
        toolName: 'bash',
        sequence: 1,
        timestamp: Date.now(),
      },
    });
    ui.close();

    // Should not crash - just ignore the orphan end event
    const output = mock.getOutput();
    expect(typeof output).toBe('string');
  });

  it('should handle stdout/stderr events without prior start event', () => {
    const mock = createMockStream();
    const ui = new TerminalUi({
      sessionId: 's1',
      stream: mock as unknown as NodeJS.WriteStream,
    });

    // Send 'stdout' event without 'start' first
    ui.dispatch({
      type: 'stream.tool',
      event: {
        type: 'stdout',
        toolCallId: 't1',
        toolName: 'bash',
        sequence: 1,
        timestamp: Date.now(),
        content: 'output',
      },
    });
    ui.close();

    // Should not crash
    const output = mock.getOutput();
    expect(typeof output).toBe('string');
  });

  it('should handle very long assistant content', () => {
    const mock = createMockStream();
    const ui = new TerminalUi({
      sessionId: 's1',
      stream: mock as unknown as NodeJS.WriteStream,
    });

    const longContent = 'a'.repeat(50000);
    ui.dispatch({ type: 'stream.text', text: longContent });
    ui.dispatch({ type: 'run.finish', completionReason: 'stop' });
    ui.close();

    const output = mock.getOutput();
    expect(output.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// More Input Parser Bug Analysis
// ============================================================================

describe('Deep Analysis: Additional input parser bugs', () => {
  it('[BUG] should not treat single character + newline as paste', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, 'a\n');

    // BUG: This is treated as paste (length > 1 && contains newline && contains non-newline)
    // but it should be normal input + submit
    console.log(
      'Single char + newline - submitted:',
      result.submitted,
      'buffer:',
      JSON.stringify(result.buffer)
    );
    expect(result.submitted).toBe(true);
    expect(result.buffer).toBe('a');
  });

  it('[BUG] should detect Ctrl+C at any position in paste-like input', () => {
    const state = createRawInputParseState();
    // Paste-like input (contains newline and other chars)
    // But also contains Ctrl+C
    const result = parseRawInputChunk(state, 'line1\nline2\u0003line3');

    console.log(
      'Paste with Ctrl+C - aborted:',
      result.aborted,
      'buffer:',
      JSON.stringify(result.buffer)
    );
    // BUG: Ctrl+C is ignored because paste heuristic takes precedence
    expect(result.aborted).toBe(true);
  });

  it('[BUG] should handle backspace in paste-like input', () => {
    const state = createRawInputParseState();
    // Paste-like input with backspace
    const result = parseRawInputChunk(state, 'hello\nworld\u007F');

    console.log('Paste with backspace - buffer:', JSON.stringify(result.buffer));
    // BUG: Backspace is ignored because paste heuristic takes precedence
    expect(result.buffer).toBe('hello\nworl');
  });

  it('should handle tab character correctly', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, 'hello\tworld');

    expect(result.buffer).toBe('hello\tworld');
  });

  it('should filter NUL character (0x00)', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, 'hello\u0000world');

    // NUL (0x00) should be filtered
    expect(result.buffer).toBe('helloworld');
  });

  it('should handle BEL character (0x07) as control char', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, 'hello\u0007world');

    // BEL should be filtered (it's a control character)
    expect(result.buffer).toBe('helloworld');
  });
});

// ============================================================================
// Edge Cases Found in Code Review
// ============================================================================

describe('Deep Analysis: Code review edge cases', () => {
  it('formatInputPreview should handle empty input', () => {
    // This tests the formatInputPreview logic indirectly
    // by checking that the parser handles empty input correctly
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, '');

    expect(result.buffer).toBe('');
    expect(result.submitted).toBe(false);
    expect(result.aborted).toBe(false);
  });

  it('should handle multiple consecutive newlines in input', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, 'a\n\n\n');

    // BUG: Treated as paste, not submitting
    console.log(
      'Multiple newlines - submitted:',
      result.submitted,
      'buffer:',
      JSON.stringify(result.buffer)
    );
  });

  it('should handle CR followed by LF correctly', () => {
    const state = createRawInputParseState();
    const result = parseRawInputChunk(state, 'hello\r\n');

    // BUG: CRLF treated as paste
    console.log('CRLF - submitted:', result.submitted, 'buffer:', JSON.stringify(result.buffer));
  });

  it('[BUG] stripEscapeSequences handles many incomplete escape sequences', () => {
    // Test that the regex handles pathological input correctly
    // The regex: /\x1b\[[0-?]{0,16}[ -/]*[@-~]/g
    const state = createRawInputParseState();

    // Create input with many escape sequence prefixes followed by a valid one
    // Each \u001B[ is a start, but only when followed by proper terminator does it get stripped
    const input = '\u001B['.repeat(10) + 'mtext';

    const result = parseRawInputChunk(state, input);

    // BUG: When there are multiple incomplete ESC[ sequences before a valid one,
    // the result is not as expected
    console.log('Pathological input result buffer:', JSON.stringify(result.buffer));
    // The last 'm' might be treated as part of an escape sequence or as literal text
    // This reveals the heuristic's behavior
  });
});

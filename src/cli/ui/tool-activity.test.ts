import { describe, expect, test } from 'vitest';
import { formatToolEndLines, isSubagentBubbleEvent } from './tool-activity';

function createEndEvent(data: unknown) {
  return {
    toolCallId: 'tool-1',
    toolName: 'file',
    type: 'end' as const,
    sequence: 3,
    timestamp: Date.now(),
    data,
  };
}

describe('formatToolEndLines', () => {
  test('falls back to serializing payload data when output/content are absent', () => {
    const event = createEndEvent({
      result: {
        success: true,
        data: {
          path: 'src/app.ts',
          changed: true,
        },
      },
    });

    const result = formatToolEndLines(event, false);
    expect(result.lines.length).toBeGreaterThan(0);
    expect(result.lines[0]).toContain('"path":"src/app.ts"');
    expect(result.hiddenLineCount).toBe(0);
  });

  test('suppresses bash success end line when output is empty', () => {
    const event = {
      toolCallId: 'tool-2',
      toolName: 'bash',
      type: 'end' as const,
      sequence: 4,
      timestamp: Date.now(),
      data: {
        result: {
          success: true,
          data: {
            output: '',
            exitCode: 0,
            truncated: false,
          },
        },
      },
    };

    const result = formatToolEndLines(event, false);
    expect(result.lines).toEqual([]);
    expect(result.hiddenLineCount).toBe(0);
  });
});

describe('isSubagentBubbleEvent', () => {
  test('returns true for subagent bubble event', () => {
    const result = isSubagentBubbleEvent({
      toolCallId: 'task-call-1',
      toolName: 'task',
      type: 'info',
      sequence: 1,
      timestamp: Date.now(),
      data: {
        source: 'subagent',
        event: 'text_delta',
      },
    });

    expect(result).toBe(true);
  });

  test('returns false for normal task event', () => {
    const result = isSubagentBubbleEvent({
      toolCallId: 'task-call-1',
      toolName: 'task',
      type: 'end',
      sequence: 2,
      timestamp: Date.now(),
      data: {
        result: {
          success: true,
          data: {
            output: 'done',
          },
        },
      },
    });

    expect(result).toBe(false);
  });
});

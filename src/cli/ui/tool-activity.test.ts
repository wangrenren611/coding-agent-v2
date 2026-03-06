import { describe, expect, test } from 'vitest';
import {
  formatToolCallLine,
  formatToolEndLines,
  formatToolOutputTailLines,
  isSubagentBubbleEvent,
} from './tool-activity';

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
  test('formats task result into a concise summary', () => {
    const event = {
      toolCallId: 'tool-task-1',
      toolName: 'task',
      type: 'end' as const,
      sequence: 3,
      timestamp: Date.now(),
      data: {
        result: {
          success: true,
          data: {
            task_id: 'task_1727',
            status: 'running',
            child_session_id: 'session-1::subtask::task_1727',
          },
        },
      },
    };

    const result = formatToolEndLines(event, false);
    expect(result.lines).toEqual(['task_id=task_1727', 'status=running']);
    expect(result.hiddenLineCount).toBe(0);
  });

  test('formats file list results into a readable summary', () => {
    const event = createEndEvent({
      result: {
        success: true,
        data: {
          path: '/Users/wrr/work/coding-agent-v2',
          entries: [
            {
              path: '/Users/wrr/work/coding-agent-v2/.agent-cli',
              isDirectory: true,
            },
            {
              path: '/Users/wrr/work/coding-agent-v2/package.json',
              isDirectory: false,
            },
          ],
          total: 2,
        },
        metadata: {
          message: 'Directory listed successfully',
        },
      },
    });

    const result = formatToolEndLines(event, false);
    expect(result.lines).toEqual([
      '/Users/wrr/work/coding-agent-v2 (2 entries)',
      '- .agent-cli/',
      '- package.json',
    ]);
    expect(result.hiddenLineCount).toBe(0);
  });

  test('formats file list results when payload is exposed without nested output text', () => {
    const event = createEndEvent({
      success: true,
      result: {
        success: true,
        data: {
          path: '.',
          entries: [
            { path: '/tmp/a', isDirectory: false },
            { path: '/tmp/b', isDirectory: true },
            { path: '/tmp/c', isDirectory: false },
            { path: '/tmp/d', isDirectory: false },
            { path: '/tmp/e', isDirectory: false },
            { path: '/tmp/f', isDirectory: false },
            { path: '/tmp/g', isDirectory: false },
            { path: '/tmp/h', isDirectory: false },
            { path: '/tmp/i', isDirectory: false },
          ],
        },
      },
    });

    const result = formatToolEndLines(event, false);
    expect(result.lines).toEqual([
      '. (9 entries)',
      '- a',
      '- b/',
      '- c',
      '- d',
      '- e',
      '- f',
      '- g',
      '- h',
    ]);
    expect(result.hiddenLineCount).toBe(1);
  });

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

describe('formatToolCallLine', () => {
  test('formats task start line without exposing long prompt json', () => {
    const result = formatToolCallLine({
      toolCallId: 'tool-call-1',
      toolName: 'task',
      type: 'start',
      sequence: 1,
      timestamp: Date.now(),
      data: {
        arguments: JSON.stringify({
          description: 'Analyze src/agent and summarize architecture',
          prompt: 'very long prompt body',
        }),
      },
    });

    expect(result).toBe('Task(Analyze src/agent and summarize architecture)');
    expect(result.includes('prompt')).toBe(false);
  });
});

describe('formatToolOutputTailLines', () => {
  test('keeps the latest lines and truncates front lines in non-transcript mode', () => {
    const content = ['line-1', 'line-2', 'line-3', 'line-4', 'line-5'].join('\n');
    const result = formatToolOutputTailLines(content, false, 2);
    expect(result.lines).toEqual(['line-4', 'line-5']);
    expect(result.hiddenLineCount).toBe(3);
  });
});

import { describe, expect, it } from 'vitest';

import type {
  AgentToolResultEvent,
  AgentToolStreamEvent,
  AgentToolUseEvent,
} from '../agent/runtime/types';
import { buildAgentEventHandlers } from './agent-event-handlers';
import { appendToSegment } from './turn-updater';
import type { ReplySegment } from '../types/chat';

const buildHarness = () => {
  const turnId = 1;
  let segments: ReplySegment[] = [];
  const notes: string[] = [];

  const handlers = buildAgentEventHandlers({
    turnId,
    isCurrentRequest: () => true,
    appendSegment: (_turnId, segmentId, type, chunk, data) => {
      segments = appendToSegment(segments, segmentId, type, chunk, data);
    },
    appendEventLine: (_turnId, text) => {
      notes.push(text);
    },
  });

  return {
    turnId,
    handlers,
    readSegments: () => segments,
    notes,
  };
};

const createToolUseEvent = (): AgentToolUseEvent => ({
  id: 'call_1',
  function: {
    name: 'bash',
    arguments: JSON.stringify({ command: 'ls -la' }),
  },
});

const createStdoutStreamEvent = (): AgentToolStreamEvent => ({
  toolCallId: 'call_1',
  toolName: 'bash',
  type: 'stdout',
  sequence: 1,
  timestamp: Date.now(),
  content: 'total 80',
});

const createToolResultEvent = (): AgentToolResultEvent => ({
  toolCall: {
    id: 'call_1',
    function: {
      name: 'bash',
      arguments: JSON.stringify({ command: 'ls -la' }),
    },
  },
  result: {
    success: true,
    data: {
      output: 'total 80',
    },
  },
});

const createEmptyToolResultEvent = (): AgentToolResultEvent => ({
  toolCall: {
    id: 'call_2',
    function: {
      name: 'bash',
      arguments: JSON.stringify({ command: 'find /tmp -name missing' }),
    },
  },
  result: {
    success: true,
    data: {
      summary: 'Command completed successfully with no output.',
    },
  },
});

describe('buildAgentEventHandlers', () => {
  it('keeps ordered stream segments as thinking -> text -> thinking -> tool -> tool result', () => {
    const { handlers, readSegments, turnId } = buildHarness();

    handlers.onTextDelta?.({
      text: '先想一下要做什么。',
      isReasoning: true,
    });
    handlers.onTextDelta?.({
      text: '当前目录看起来是一个 TypeScript 项目。',
      isReasoning: false,
    });
    handlers.onTextDelta?.({
      text: '我会先执行 ls -la 看目录结构。',
      isReasoning: true,
    });
    handlers.onToolUse?.(createToolUseEvent());
    handlers.onToolStream?.(createStdoutStreamEvent());
    handlers.onToolResult?.(createToolResultEvent());
    handlers.onTextDelta?.({
      text: '当前目录包含以下内容。',
      isReasoning: false,
    });
    handlers.onTextComplete?.('');

    const segments = readSegments();
    expect(segments.map(segment => segment.id)).toEqual([
      `${turnId}:thinking:1`,
      `${turnId}:text:2`,
      `${turnId}:thinking:3`,
      `${turnId}:tool-use:call_1`,
      `${turnId}:tool:call_1:stdout`,
      `${turnId}:tool-result:call_1`,
      `${turnId}:text:4`,
    ]);

    const firstThinkingIndex = segments.findIndex(segment => segment.id === `${turnId}:thinking:1`);
    const toolUseIndex = segments.findIndex(segment => segment.id === `${turnId}:tool-use:call_1`);
    const toolResultIndex = segments.findIndex(
      segment => segment.id === `${turnId}:tool-result:call_1`
    );
    expect(firstThinkingIndex).toBeGreaterThanOrEqual(0);
    expect(toolUseIndex).toBeGreaterThan(firstThinkingIndex);
    expect(toolResultIndex).toBeGreaterThan(toolUseIndex);
  });

  it('suppresses duplicated tool output in tool-result when stdout/stderr stream already exists', () => {
    const { handlers, readSegments, turnId } = buildHarness();

    handlers.onToolUse?.(createToolUseEvent());
    handlers.onToolStream?.(createStdoutStreamEvent());
    handlers.onToolResult?.(createToolResultEvent());

    const toolResult = readSegments().find(
      segment => segment.id === `${turnId}:tool-result:call_1`
    );
    expect(toolResult?.content).toContain('# Result: bash (call_1) success');
    expect(toolResult?.content).not.toContain('total 80');
  });

  it('keeps tool-result output when no stdout/stderr stream was emitted', () => {
    const { handlers, readSegments, turnId } = buildHarness();

    handlers.onToolUse?.(createToolUseEvent());
    handlers.onToolResult?.(createToolResultEvent());

    const toolResult = readSegments().find(
      segment => segment.id === `${turnId}:tool-result:call_1`
    );
    expect(toolResult?.content).toContain('# Result: bash (call_1) success');
    expect(toolResult?.content).toContain('total 80');
  });

  it('renders a summary instead of an output wrapper when tool succeeds without output', () => {
    const { handlers, readSegments, turnId } = buildHarness();

    handlers.onToolUse?.({
      id: 'call_2',
      function: {
        name: 'bash',
        arguments: JSON.stringify({ command: 'find /tmp -name missing' }),
      },
    });
    handlers.onToolResult?.(createEmptyToolResultEvent());

    const toolResult = readSegments().find(
      segment => segment.id === `${turnId}:tool-result:call_2`
    );
    expect(toolResult?.content).toContain('# Result: bash (call_2) success');
    expect(toolResult?.content).toContain('Command completed successfully with no output.');
    expect(toolResult?.content).not.toContain('{"output":""}');
  });

  it('stores structured tool event data on tool-use and tool-result segments', () => {
    const { handlers, readSegments, turnId } = buildHarness();

    const toolUseEvent = createToolUseEvent();
    const toolResultEvent = createToolResultEvent();
    handlers.onToolUse?.(toolUseEvent);
    handlers.onToolResult?.(toolResultEvent);

    const toolUse = readSegments().find(segment => segment.id === `${turnId}:tool-use:call_1`);
    const toolResult = readSegments().find(
      segment => segment.id === `${turnId}:tool-result:call_1`
    );

    expect(toolUse?.data).toEqual(toolUseEvent);
    expect(toolResult?.data).toEqual(toolResultEvent);
  });

  it('deduplicates repeated tool-use events for the same toolCallId', () => {
    const { handlers, readSegments, turnId } = buildHarness();

    handlers.onToolUse?.(createToolUseEvent());
    handlers.onToolUse?.(createToolUseEvent());
    handlers.onToolUse?.(createToolUseEvent());

    const toolUseSegments = readSegments().filter(
      segment => segment.id === `${turnId}:tool-use:call_1`
    );
    expect(toolUseSegments.length).toBe(1);
  });
});

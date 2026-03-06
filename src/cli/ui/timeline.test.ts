import { describe, expect, test } from 'vitest';
import {
  clipTimeline,
  mergeTimeline,
  splitTimelineByPendingTools,
  splitTimelineForRendering,
} from './timeline';
import type { ActivityEvent, ChatLine } from './types';

function msg(seq: number, id: string): ChatLine {
  return {
    id,
    seq,
    role: 'assistant',
    text: id,
  };
}

function activity(
  seq: number,
  id: string,
  toolCallId: string,
  phase: ActivityEvent['phase'],
  kind: ActivityEvent['kind'] = 'tool_output'
): ActivityEvent {
  return {
    id,
    seq,
    level: 'tool',
    text: id,
    time: '00:00:00',
    toolCallId,
    kind,
    phase,
  };
}

describe('mergeTimeline', () => {
  test('keeps sequence order across message and activity', () => {
    const merged = mergeTimeline([msg(2, 'm2'), msg(4, 'm4')], [activity(3, 'a3', 't1', 'stream')]);
    expect(merged.map((item) => item.seq)).toEqual([2, 3, 4]);
  });
});

describe('splitTimelineByPendingTools', () => {
  test('returns all completed when no pending tool call exists', () => {
    const items = mergeTimeline(
      [msg(1, 'm1')],
      [activity(2, 'a1', 'tool-1', 'start', 'tool_call'), activity(3, 'a2', 'tool-1', 'end')]
    );
    const result = splitTimelineByPendingTools(items);
    expect(result.pendingItems).toHaveLength(0);
    expect(result.completedItems).toHaveLength(3);
  });

  test('splits from the first unresolved tool call', () => {
    const items = mergeTimeline(
      [msg(1, 'm1'), msg(5, 'm5')],
      [activity(2, 'a1', 'tool-1', 'start', 'tool_call'), activity(3, 'a2', 'tool-1', 'stream')]
    );
    const result = splitTimelineByPendingTools(items);
    expect(result.completedItems.map((item) => item.seq)).toEqual([1]);
    expect(result.pendingItems.map((item) => item.seq)).toEqual([2, 3, 5]);
  });
});

describe('clipTimeline', () => {
  test('clips only after merge order is established', () => {
    const items = mergeTimeline(
      [msg(1, 'm1'), msg(3, 'm3'), msg(5, 'm5')],
      [activity(2, 'a2', 'tool-1', 'start', 'tool_call'), activity(4, 'a4', 'tool-1', 'end')]
    );
    const clipped = clipTimeline(items, 3);
    expect(clipped.map((item) => item.seq)).toEqual([3, 4, 5]);
  });
});

describe('splitTimelineForRendering', () => {
  test('keeps the last item dynamic while running without pending tools', () => {
    const items = mergeTimeline([msg(1, 'm1'), msg(2, 'm2')], []);
    const result = splitTimelineForRendering(items, true);
    expect(result.completedItems.map((item) => item.seq)).toEqual([1]);
    expect(result.pendingItems.map((item) => item.seq)).toEqual([2]);
  });

  test('keeps normal split when not running', () => {
    const items = mergeTimeline([msg(1, 'm1'), msg(2, 'm2')], []);
    const result = splitTimelineForRendering(items, false);
    expect(result.completedItems.map((item) => item.seq)).toEqual([1, 2]);
    expect(result.pendingItems).toHaveLength(0);
  });
});

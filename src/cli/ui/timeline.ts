import type { ActivityEvent, ChatLine, TimelineItem } from './types';

function bySeq(left: TimelineItem, right: TimelineItem): number {
  if (left.seq !== right.seq) {
    return left.seq - right.seq;
  }
  if (left.kind === right.kind) {
    return 0;
  }
  return left.kind === 'message' ? -1 : 1;
}

export function mergeTimeline(messages: ChatLine[], activities: ActivityEvent[]): TimelineItem[] {
  const merged: TimelineItem[] = [
    ...messages.map((message) => ({
      kind: 'message' as const,
      seq: message.seq,
      message,
    })),
    ...activities.map((activity) => ({
      kind: 'activity' as const,
      seq: activity.seq,
      activity,
    })),
  ];

  merged.sort(bySeq);
  return merged;
}

export function splitTimelineByPendingTools(items: TimelineItem[]): {
  completedItems: TimelineItem[];
  pendingItems: TimelineItem[];
} {
  const pendingStarts = new Map<string, number>();

  items.forEach((item, index) => {
    if (item.kind !== 'activity') {
      return;
    }

    const activity = item.activity;
    if (!activity.toolCallId) {
      return;
    }

    if (activity.kind === 'tool_call' || activity.phase === 'start') {
      pendingStarts.set(activity.toolCallId, index);
      return;
    }

    const isTerminal = activity.phase === 'end' || activity.phase === 'error';
    if (isTerminal) {
      pendingStarts.delete(activity.toolCallId);
    }
  });

  if (pendingStarts.size === 0) {
    return {
      completedItems: items,
      pendingItems: [],
    };
  }

  const pendingStartIndex = Math.min(...pendingStarts.values());
  return {
    completedItems: items.slice(0, pendingStartIndex),
    pendingItems: items.slice(pendingStartIndex),
  };
}

export function splitTimelineForRendering(
  items: TimelineItem[],
  running: boolean
): {
  completedItems: TimelineItem[];
  pendingItems: TimelineItem[];
} {
  const split = splitTimelineByPendingTools(items);

  if (!running || split.pendingItems.length > 0 || split.completedItems.length === 0) {
    return split;
  }

  return {
    completedItems: split.completedItems.slice(0, -1),
    pendingItems: split.completedItems.slice(-1),
  };
}

export function clipTimeline(items: TimelineItem[], maxItems: number): TimelineItem[] {
  if (maxItems <= 0 || items.length <= maxItems) {
    return items;
  }
  return items.slice(-maxItems);
}

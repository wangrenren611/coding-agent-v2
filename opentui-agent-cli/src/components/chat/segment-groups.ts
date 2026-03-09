import type { ReplySegment } from "../../types/chat";

type ToolSegmentKind = "use" | "stream" | "result";

export type ToolSegmentMeta = {
  kind: ToolSegmentKind;
  toolCallId: string;
  channel?: "stdout" | "stderr";
};

export type ToolSegmentGroup = {
  toolCallId: string;
  use?: ReplySegment;
  streams: ReplySegment[];
  result?: ReplySegment;
};

export type ReplyRenderItem =
  | {
      type: "segment";
      segment: ReplySegment;
    }
  | {
      type: "tool";
      group: ToolSegmentGroup;
    };

export const parseToolSegmentMeta = (segmentId: string): ToolSegmentMeta | null => {
  const toolUseMatch = segmentId.match(/^\d+:tool-use:(.+)$/);
  if (toolUseMatch && toolUseMatch[1]) {
    return {
      kind: "use",
      toolCallId: toolUseMatch[1],
    };
  }

  const toolResultMatch = segmentId.match(/^\d+:tool-result:(.+)$/);
  if (toolResultMatch && toolResultMatch[1]) {
    return {
      kind: "result",
      toolCallId: toolResultMatch[1],
    };
  }

  const toolStreamMatch = segmentId.match(/^\d+:tool:([^:]+):(stdout|stderr)$/);
  if (toolStreamMatch && toolStreamMatch[1] && toolStreamMatch[2]) {
    return {
      kind: "stream",
      toolCallId: toolStreamMatch[1],
      channel: toolStreamMatch[2] as "stdout" | "stderr",
    };
  }

  return null;
};

export const buildReplyRenderItems = (segments: ReplySegment[]): ReplyRenderItem[] => {
  const items: ReplyRenderItem[] = [];
  let activeGroup: ToolSegmentGroup | null = null;

  const flushActiveGroup = () => {
    if (!activeGroup) {
      return;
    }
    items.push({
      type: "tool",
      group: activeGroup,
    });
    activeGroup = null;
  };

  for (const segment of segments) {
    const meta = parseToolSegmentMeta(segment.id);
    if (!meta) {
      flushActiveGroup();
      items.push({
        type: "segment",
        segment,
      });
      continue;
    }

    if (!activeGroup || activeGroup.toolCallId !== meta.toolCallId) {
      flushActiveGroup();
      activeGroup = {
        toolCallId: meta.toolCallId,
        streams: [],
      };
    }

    if (meta.kind === "use") {
      activeGroup.use = segment;
      continue;
    }

    if (meta.kind === "result") {
      activeGroup.result = segment;
      continue;
    }

    activeGroup.streams.push(segment);
  }

  flushActiveGroup();
  return items;
};

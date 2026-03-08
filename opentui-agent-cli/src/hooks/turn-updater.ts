import type { AssistantReply, ChatTurn, ReplySegment, ReplySegmentType, ReplyStatus } from "../types/chat";

const DEFAULT_AGENT_LABEL = "";

export const createStreamingReply = (modelLabel: string): AssistantReply => ({
  agentLabel: DEFAULT_AGENT_LABEL,
  modelLabel,
  durationSeconds: 0,
  segments: [],
  status: "streaming",
});

export const patchTurn = (
  turns: ChatTurn[],
  turnId: number,
  patch: (turn: ChatTurn) => ChatTurn,
): ChatTurn[] => {
  return turns.map((turn) => (turn.id === turnId ? patch(turn) : turn));
};

export const ensureSegment = (
  segments: ReplySegment[],
  segmentId: string,
  type: ReplySegmentType,
): ReplySegment[] => {
  if (segments.some((segment) => segment.id === segmentId)) {
    return segments;
  }
  return [...segments, { id: segmentId, type, content: "" }];
};

export const appendToSegment = (
  segments: ReplySegment[],
  segmentId: string,
  type: ReplySegmentType,
  chunk: string,
): ReplySegment[] => {
  const base = ensureSegment(segments, segmentId, type);
  return base.map((segment) =>
    segment.id === segmentId
      ? {
          ...segment,
          content: `${segment.content}${chunk}`,
        }
      : segment,
  );
};

export const appendNoteLine = (segments: ReplySegment[], segmentId: string, text: string): ReplySegment[] => {
  const line = text.endsWith("\n") ? text : `${text}\n`;
  return appendToSegment(segments, segmentId, "note", line);
};

export const setReplyStatus = (
  turns: ChatTurn[],
  turnId: number,
  status: ReplyStatus,
  extras?: Partial<AssistantReply>,
): ChatTurn[] => {
  return patchTurn(turns, turnId, (turn) => {
    const reply = turn.reply;
    if (!reply) {
      return turn;
    }
    return {
      ...turn,
      reply: {
        ...reply,
        ...extras,
        status,
      },
    };
  });
};

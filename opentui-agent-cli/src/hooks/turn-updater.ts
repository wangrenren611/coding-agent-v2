import type {
  AssistantReply,
  ChatTurn,
  ReplySegment,
  ReplySegmentType,
  ReplyStatus,
} from '../types/chat';

const DEFAULT_AGENT_LABEL = '';

export const createStreamingReply = (modelLabel: string): AssistantReply => ({
  agentLabel: DEFAULT_AGENT_LABEL,
  modelLabel,
  startedAtMs: Date.now(),
  durationSeconds: 0,
  segments: [],
  status: 'streaming',
});

export const patchTurn = (
  turns: ChatTurn[],
  turnId: number,
  patch: (turn: ChatTurn) => ChatTurn
): ChatTurn[] => {
  return turns.map(turn => (turn.id === turnId ? patch(turn) : turn));
};

export const ensureSegment = (
  segments: ReplySegment[],
  segmentId: string,
  type: ReplySegmentType,
  data?: unknown
): ReplySegment[] => {
  if (segments.some(segment => segment.id === segmentId)) {
    return segments;
  }
  return [
    ...segments,
    { id: segmentId, type, content: '', ...(data !== undefined ? { data } : {}) },
  ];
};

export const appendToSegment = (
  segments: ReplySegment[],
  segmentId: string,
  type: ReplySegmentType,
  chunk: string,
  data?: unknown
): ReplySegment[] => {
  const base = ensureSegment(segments, segmentId, type, data);
  return base.map(segment =>
    segment.id === segmentId
      ? {
          ...segment,
          content: `${segment.content}${chunk}`,
          ...(data !== undefined ? { data } : {}),
        }
      : segment
  );
};

type ToolSegmentKind = 'use' | 'stream' | 'result';

const parseToolSegment = (
  segmentId: string
): {
  toolCallId: string;
  kind: ToolSegmentKind;
} | null => {
  const toolUseMatch = segmentId.match(/^\d+:tool-use:(.+)$/);
  if (toolUseMatch && toolUseMatch[1]) {
    return { toolCallId: toolUseMatch[1], kind: 'use' };
  }

  const toolResultMatch = segmentId.match(/^\d+:tool-result:(.+)$/);
  if (toolResultMatch && toolResultMatch[1]) {
    return { toolCallId: toolResultMatch[1], kind: 'result' };
  }

  const toolStreamMatch = segmentId.match(/^\d+:tool:([^:]+):/);
  if (toolStreamMatch && toolStreamMatch[1]) {
    return { toolCallId: toolStreamMatch[1], kind: 'stream' };
  }

  return null;
};

export const orderReplySegments = (segments: ReplySegment[]): ReplySegment[] => {
  type ToolGroup = {
    use: ReplySegment[];
    stream: ReplySegment[];
    result: ReplySegment[];
  };

  const groups = new Map<string, ToolGroup>();
  const emittedGroupIds = new Set<string>();
  const ordered: Array<ReplySegment | { groupId: string }> = [];

  for (const segment of segments) {
    const parsed = parseToolSegment(segment.id);
    if (!parsed) {
      ordered.push(segment);
      continue;
    }

    const existing = groups.get(parsed.toolCallId) ?? {
      use: [],
      stream: [],
      result: [],
    };
    existing[parsed.kind].push(segment);
    groups.set(parsed.toolCallId, existing);

    if (!emittedGroupIds.has(parsed.toolCallId)) {
      emittedGroupIds.add(parsed.toolCallId);
      ordered.push({ groupId: parsed.toolCallId });
    }
  }

  const normalized: ReplySegment[] = [];
  for (const item of ordered) {
    if ('id' in item) {
      normalized.push(item);
      continue;
    }

    const group = groups.get(item.groupId);
    if (!group) {
      continue;
    }
    normalized.push(...group.use, ...group.stream, ...group.result);
  }

  return normalized;
};

export const appendNoteLine = (
  segments: ReplySegment[],
  segmentId: string,
  text: string
): ReplySegment[] => {
  const line = text.endsWith('\n') ? text : `${text}\n`;
  return appendToSegment(segments, segmentId, 'note', line);
};

export const setReplyStatus = (
  turns: ChatTurn[],
  turnId: number,
  status: ReplyStatus,
  extras?: Partial<AssistantReply>
): ChatTurn[] => {
  return patchTurn(turns, turnId, turn => {
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

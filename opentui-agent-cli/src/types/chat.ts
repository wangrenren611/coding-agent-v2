export type ReplySegmentType = "thinking" | "text" | "code" | "note";

export type ReplySegment = {
  id: string;
  type: ReplySegmentType;
  content: string;
};

export type ReplyStatus = "streaming" | "done" | "error";

export type AssistantReply = {
  segments: ReplySegment[];
  modelLabel: string;
  agentLabel: string;
  durationSeconds: number;
  status: ReplyStatus;
  completionReason?: string;
  completionMessage?: string;
};

export type ChatTurn = {
  id: number;
  prompt: string;
  reply?: AssistantReply;
};

export type ReplySegmentType = "thinking" | "text" | "code" | "note";

export type ReplySegment = {
  id: string;
  type: ReplySegmentType;
  content: string;
  data?: unknown;
};

export type ReplyStatus = "streaming" | "done" | "error";

export type AssistantReply = {
  segments: ReplySegment[];
  modelLabel: string;
  agentLabel: string;
  startedAtMs?: number;
  durationSeconds: number;
  usagePromptTokens?: number;
  usageCompletionTokens?: number;
  usageTotalTokens?: number;
  status: ReplyStatus;
  completionReason?: string;
  completionMessage?: string;
};

export type ChatTurn = {
  id: number;
  prompt: string;
  createdAtMs: number;
  reply?: AssistantReply;
};

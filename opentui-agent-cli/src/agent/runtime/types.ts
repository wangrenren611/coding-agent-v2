export type AgentTextDeltaEvent = {
  text: string;
  isReasoning?: boolean;
};

export type AgentToolStreamEvent = {
  toolCallId: string;
  toolName: string;
  type: string;
  sequence: number;
  timestamp: number;
  content?: string;
  data?: unknown;
};

export type AgentToolConfirmEvent = {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  rawArgs: Record<string, unknown>;
  reason?: string;
  metadata?: Record<string, unknown>;
};

export type AgentToolConfirmDecision = {
  approved: boolean;
  message?: string;
};

export type AgentStepEvent = {
  stepIndex: number;
  finishReason?: string;
  toolCallsCount: number;
};

export type AgentToolUseEvent = {
  [key: string]: unknown;
};

export type AgentToolResultEvent = {
  toolCall: unknown;
  result: unknown;
};

export type AgentLoopEvent = {
  loopIndex: number;
  steps: number;
};

export type AgentStopEvent = {
  reason: string;
  message?: string;
};

export type AgentUsageEvent = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cumulativePromptTokens?: number;
  cumulativeCompletionTokens?: number;
  cumulativeTotalTokens?: number;
  contextTokens?: number;
  contextLimit?: number;
  contextUsagePercent?: number;
};

export type AgentContextUsageEvent = {
  stepIndex: number;
  messageCount: number;
  contextTokens: number;
  contextLimit: number;
  contextUsagePercent: number;
};

export type AgentEventHandlers = {
  onTextDelta?: (event: AgentTextDeltaEvent) => void;
  onTextComplete?: (text: string) => void;
  onToolStream?: (event: AgentToolStreamEvent) => void;
  onToolConfirm?: (event: AgentToolConfirmEvent) => void;
  onToolConfirmRequest?: (
    event: AgentToolConfirmEvent
  ) => AgentToolConfirmDecision | Promise<AgentToolConfirmDecision>;
  onToolUse?: (event: AgentToolUseEvent) => void;
  onToolResult?: (event: AgentToolResultEvent) => void;
  onStep?: (event: AgentStepEvent) => void;
  onLoop?: (event: AgentLoopEvent) => void;
  onStop?: (event: AgentStopEvent) => void;
  onContextUsage?: (event: AgentContextUsageEvent) => void;
  onUsage?: (event: AgentUsageEvent) => void;
};

export type AgentRunResult = {
  text: string;
  completionReason: string;
  completionMessage?: string;
  durationSeconds: number;
  modelLabel: string;
  usage?: AgentUsageEvent;
};

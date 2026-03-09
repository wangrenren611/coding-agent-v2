import type { StreamEvent } from '../types';

export type RunStatus = 'CREATED' | 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type TerminalReason =
  | 'stop'
  | 'max_steps'
  | 'error'
  | 'aborted'
  | 'timeout'
  | 'rate_limit'
  | 'max_retries';

export interface RunRecord {
  executionId: string;
  runId: string;
  conversationId: string;
  status: RunStatus;
  createdAt: number;
  updatedAt: number;
  stepIndex: number;
  startedAt?: number;
  completedAt?: number;
  lastCheckpointSeq?: number;
  terminalReason?: TerminalReason;
  errorCode?: string;
  errorCategory?: string;
  errorMessage?: string;
}

export interface ExecutionStepRecord {
  executionId: string;
  stepIndex: number;
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'skipped';
  stage?: 'llm' | 'tool' | 'checkpoint';
  errorCode?: string;
  startedAt?: number;
  completedAt?: number;
}

export type CliEventType = StreamEvent['type'] | 'user_message' | 'assistant_message';

export interface CliEvent {
  type: CliEventType;
  data: unknown;
}

export interface CliEventEnvelope {
  conversationId: string;
  executionId: string;
  seq: number;
  eventType: CliEventType;
  data: unknown;
  createdAt: number;
}

export interface ListRunsOptions {
  statuses?: RunStatus[];
  limit?: number;
  cursor?: string;
}

export interface ListRunsResult {
  items: RunRecord[];
  nextCursor?: string;
}

export interface ListConversationEventsOptions {
  fromSeq?: number;
  limit?: number;
}

export interface CompactionDroppedMessageRecord {
  conversationId: string;
  executionId: string;
  stepIndex: number;
  removedMessageId: string;
  createdAt: number;
}

export const AGENT_V4_APP_CONTRACTS_MODULE = 'agent-v4-app-contracts';

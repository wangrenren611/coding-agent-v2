import type { Tool } from '../../providers';
import type { ToolExecutionLedger } from '../agent';
import type { Message } from '../types';
import type {
  CliEvent,
  CliEventEnvelope,
  CompactionDroppedMessageRecord,
  ListConversationEventsOptions,
  ListRunLogsOptions,
  ListRunsOptions,
  ListRunsResult,
  RunRecord,
  RunLogRecord,
} from './contracts';

export interface ExecutionStorePort {
  create(run: RunRecord): Promise<void>;
  patch(executionId: string, patch: Partial<RunRecord>): Promise<void>;
  get(executionId: string): Promise<RunRecord | null>;
  listByConversation(conversationId: string, opts?: ListRunsOptions): Promise<ListRunsResult>;
}

export interface EventStorePort {
  appendAutoSeq(event: Omit<CliEventEnvelope, 'seq'>): Promise<CliEventEnvelope>;
  append(event: CliEventEnvelope): Promise<void>;
  listByRun(executionId: string): Promise<CliEventEnvelope[]>;
  listEventsByConversation(
    conversationId: string,
    opts?: ListConversationEventsOptions
  ): Promise<CliEventEnvelope[]>;
}

export interface MessageProjectionStorePort {
  upsertFromEvent(event: CliEventEnvelope): Promise<void>;
  list(conversationId: string): Promise<Message[]>;
}

export interface ContextProjectionStorePort extends MessageProjectionStorePort {
  listContext(conversationId: string): Promise<Message[]>;
  applyCompaction(input: {
    conversationId: string;
    executionId: string;
    stepIndex: number;
    removedMessageIds: string[];
    createdAt: number;
  }): Promise<void>;
  listDroppedMessages(
    executionId: string,
    opts?: { stepIndex?: number; limit?: number }
  ): Promise<CompactionDroppedMessageRecord[]>;
}

export interface RunLogStorePort {
  appendRunLog(record: RunLogRecord): Promise<void>;
  listRunLogs(executionId: string, opts?: ListRunLogsOptions): Promise<RunLogRecord[]>;
}

export interface ContextProviderPort {
  load(
    conversationId: string
  ): Promise<{ messages: Message[]; systemPrompt?: string; tools?: Tool[] }>;
}

export interface EventSinkPort {
  publish(executionId: string, event: CliEvent): Promise<void>;
}

export interface LedgerProviderPort {
  getLedger(conversationId: string): ToolExecutionLedger;
}

export const AGENT_V4_APP_PORTS_MODULE = 'agent-v4-app-ports';

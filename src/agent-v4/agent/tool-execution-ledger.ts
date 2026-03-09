import type { Message } from '../types';

export interface ToolExecutionLedgerRecord {
  success: boolean;
  output: string;
  errorName?: string;
  errorMessage?: string;
  recordedAt: number;
}

export interface ToolExecutionLedger {
  get(executionId: string, toolCallId: string): Promise<ToolExecutionLedgerRecord | undefined>;
  set(executionId: string, toolCallId: string, record: ToolExecutionLedgerRecord): Promise<void>;
}

export class InMemoryToolExecutionLedger implements ToolExecutionLedger {
  private readonly store = new Map<string, ToolExecutionLedgerRecord>();

  async get(
    executionId: string,
    toolCallId: string
  ): Promise<ToolExecutionLedgerRecord | undefined> {
    return this.store.get(this.buildKey(executionId, toolCallId));
  }

  async set(executionId: string, toolCallId: string, record: ToolExecutionLedgerRecord): Promise<void> {
    this.store.set(this.buildKey(executionId, toolCallId), record);
  }

  private buildKey(executionId: string, toolCallId: string): string {
    return `${executionId}:${toolCallId}`;
  }
}

export function createToolResultMessage(params: {
  toolCallId: string;
  content: string;
  createMessageId: () => string;
}): Message {
  const { toolCallId, content, createMessageId } = params;
  return {
    messageId: createMessageId(),
    type: 'tool-result',
    role: 'tool',
    content,
    tool_call_id: toolCallId,
    timestamp: Date.now(),
  };
}

export async function getLedgerRecord(params: {
  ledger: ToolExecutionLedger;
  executionId: string | undefined;
  toolCallId: string;
  onError?: (error: unknown) => void;
}): Promise<ToolExecutionLedgerRecord | undefined> {
  const { ledger, executionId, toolCallId, onError } = params;
  if (!executionId) {
    return undefined;
  }
  try {
    return await ledger.get(executionId, toolCallId);
  } catch (error) {
    onError?.(error);
    return undefined;
  }
}

export async function recordLedgerResult(params: {
  ledger: ToolExecutionLedger;
  executionId: string | undefined;
  toolCallId: string;
  toolExecResult: {
    success: boolean;
    output?: string;
    error?: {
      name?: string;
      message?: string;
    };
  };
  output: string;
  onError?: (error: unknown) => void;
}): Promise<void> {
  const { ledger, executionId, toolCallId, toolExecResult, output, onError } = params;
  if (!executionId) {
    return;
  }
  try {
    await ledger.set(executionId, toolCallId, {
      success: toolExecResult.success,
      output,
      errorName: toolExecResult.error?.name,
      errorMessage: toolExecResult.error?.message,
      recordedAt: Date.now(),
    });
  } catch (error) {
    onError?.(error);
  }
}

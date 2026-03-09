import type { Message } from '../types';

export interface ToolExecutionLedgerRecord {
  success: boolean;
  output: string;
  errorName?: string;
  errorMessage?: string;
  errorCode?: string;
  recordedAt: number;
}

export interface ToolExecutionOnceResult {
  record: ToolExecutionLedgerRecord;
  fromCache: boolean;
}

export interface ToolExecutionLedger {
  get(executionId: string, toolCallId: string): Promise<ToolExecutionLedgerRecord | undefined>;
  set(executionId: string, toolCallId: string, record: ToolExecutionLedgerRecord): Promise<void>;
  executeOnce(
    executionId: string,
    toolCallId: string,
    execute: () => Promise<ToolExecutionLedgerRecord>
  ): Promise<ToolExecutionOnceResult>;
}

export class NoopToolExecutionLedger implements ToolExecutionLedger {
  async get(
    _executionId: string,
    _toolCallId: string
  ): Promise<ToolExecutionLedgerRecord | undefined> {
    return undefined;
  }

  async set(
    _executionId: string,
    _toolCallId: string,
    _record: ToolExecutionLedgerRecord
  ): Promise<void> {
    return;
  }

  async executeOnce(
    _executionId: string,
    _toolCallId: string,
    execute: () => Promise<ToolExecutionLedgerRecord>
  ): Promise<ToolExecutionOnceResult> {
    const record = await execute();
    return {
      record,
      fromCache: false,
    };
  }
}

export class InMemoryToolExecutionLedger implements ToolExecutionLedger {
  private readonly store = new Map<string, ToolExecutionLedgerRecord>();
  private readonly inflight = new Map<string, Promise<ToolExecutionLedgerRecord>>();

  async get(
    executionId: string,
    toolCallId: string
  ): Promise<ToolExecutionLedgerRecord | undefined> {
    return this.store.get(this.buildKey(executionId, toolCallId));
  }

  async set(
    executionId: string,
    toolCallId: string,
    record: ToolExecutionLedgerRecord
  ): Promise<void> {
    this.store.set(this.buildKey(executionId, toolCallId), record);
  }

  async executeOnce(
    executionId: string,
    toolCallId: string,
    execute: () => Promise<ToolExecutionLedgerRecord>
  ): Promise<ToolExecutionOnceResult> {
    const key = this.buildKey(executionId, toolCallId);
    const cached = this.store.get(key);
    if (cached) {
      return {
        record: cached,
        fromCache: true,
      };
    }

    const inflight = this.inflight.get(key);
    if (inflight) {
      const record = await inflight;
      return {
        record,
        fromCache: true,
      };
    }

    const pending = (async () => {
      const record = await execute();
      this.store.set(key, record);
      return record;
    })();
    this.inflight.set(key, pending);

    try {
      const record = await pending;
      return {
        record,
        fromCache: false,
      };
    } finally {
      this.inflight.delete(key);
    }
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

export async function executeToolCallWithLedger(params: {
  ledger: ToolExecutionLedger;
  executionId: string | undefined;
  toolCallId: string;
  execute: () => Promise<ToolExecutionLedgerRecord>;
  onError?: (error: unknown) => void;
}): Promise<ToolExecutionOnceResult> {
  const { ledger, executionId, toolCallId, execute, onError } = params;
  try {
    if (!executionId) {
      const record = await execute();
      return {
        record,
        fromCache: false,
      };
    }

    return await ledger.executeOnce(executionId, toolCallId, execute);
  } catch (error) {
    onError?.(error);
    throw error;
  }
}

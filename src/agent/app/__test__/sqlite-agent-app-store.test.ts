import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Message } from '../../types';
import { SqliteAgentAppStore } from '../sqlite-agent-app-store';

describe('SqliteAgentAppStore', () => {
  let store: SqliteAgentAppStore | null = null;
  let tempDir: string | null = null;

  afterEach(async () => {
    if (store) {
      await store.close();
      store = null;
    }
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('allocates per-conversation seq atomically and supports run pagination', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-app-sqlite-'));
    const dbPath = path.join(tempDir, 'agent.db');
    store = new SqliteAgentAppStore(dbPath);

    const now = Date.now();
    await store.create({
      executionId: 'exec_1',
      runId: 'exec_1',
      conversationId: 'conv_1',
      status: 'RUNNING',
      createdAt: now,
      updatedAt: now,
      stepIndex: 1,
    });
    await store.create({
      executionId: 'exec_2',
      runId: 'exec_2',
      conversationId: 'conv_1',
      status: 'COMPLETED',
      createdAt: now + 1,
      updatedAt: now + 2,
      stepIndex: 2,
      terminalReason: 'stop',
    });

    const page1 = await store.listByConversation('conv_1', { limit: 1 });
    expect(page1.items).toHaveLength(1);
    expect(page1.items[0].executionId).toBe('exec_2');
    expect(page1.nextCursor).toBeTruthy();

    const page2 = await store.listByConversation('conv_1', { limit: 1, cursor: page1.nextCursor });
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0].executionId).toBe('exec_1');

    const event1 = await store.appendAutoSeq({
      conversationId: 'conv_1',
      executionId: 'exec_1',
      eventType: 'progress',
      data: { stepIndex: 1 },
      createdAt: now,
    });
    const event2 = await store.appendAutoSeq({
      conversationId: 'conv_1',
      executionId: 'exec_2',
      eventType: 'done',
      data: { finishReason: 'stop', steps: 2 },
      createdAt: now + 3,
    });
    const otherConversationEvent = await store.appendAutoSeq({
      conversationId: 'conv_2',
      executionId: 'exec_x',
      eventType: 'progress',
      data: { stepIndex: 1 },
      createdAt: now + 4,
    });

    expect(event1.seq).toBe(1);
    expect(event2.seq).toBe(2);
    expect(otherConversationEvent.seq).toBe(1);

    const conv1Events = await store.listEventsByConversation('conv_1');
    expect(conv1Events).toHaveLength(2);
    expect(conv1Events.map((event) => event.seq)).toEqual([1, 2]);
  });

  it('handles concurrent appendAutoSeq on the same store instance', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-app-sqlite-concurrent-seq-'));
    const dbPath = path.join(tempDir, 'agent.db');
    store = new SqliteAgentAppStore(dbPath);

    const now = Date.now();
    await store.create({
      executionId: 'exec_concurrent',
      runId: 'exec_concurrent',
      conversationId: 'conv_concurrent',
      status: 'RUNNING',
      createdAt: now,
      updatedAt: now,
      stepIndex: 0,
    });

    const appended = await Promise.all(
      Array.from({ length: 30 }, (_value, index) =>
        store!.appendAutoSeq({
          conversationId: 'conv_concurrent',
          executionId: 'exec_concurrent',
          eventType: 'progress',
          data: { stepIndex: index + 1, label: `p_${index}` },
          createdAt: now + index + 1,
        })
      )
    );

    expect(appended).toHaveLength(30);

    const events = await store.listEventsByConversation('conv_concurrent');
    expect(events).toHaveLength(30);
    expect(events.map((event) => event.seq)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it('projects assistant/user message events into message read model', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-app-sqlite-msg-'));
    const dbPath = path.join(tempDir, 'agent.db');
    store = new SqliteAgentAppStore(dbPath);

    const now = Date.now();
    await store.create({
      executionId: 'exec_message',
      runId: 'exec_message',
      conversationId: 'conv_message',
      status: 'RUNNING',
      createdAt: now,
      updatedAt: now,
      stepIndex: 0,
    });

    const message: Message = {
      messageId: 'msg_1',
      type: 'assistant-text',
      role: 'assistant',
      content: 'hello world',
      timestamp: now + 1,
    };

    const envelope = await store.appendAutoSeq({
      conversationId: 'conv_message',
      executionId: 'exec_message',
      eventType: 'assistant_message',
      data: { message, stepIndex: 1 },
      createdAt: now + 1,
    });
    await store.upsertFromEvent(envelope);

    const messages = await store.list('conv_message');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      messageId: 'msg_1',
      role: 'assistant',
      type: 'assistant-text',
      content: 'hello world',
    });
  });

  it('stores and lists run logs in created order', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-app-sqlite-run-logs-'));
    const dbPath = path.join(tempDir, 'agent.db');
    store = new SqliteAgentAppStore(dbPath);

    const now = Date.now();
    await store.create({
      executionId: 'exec_logs',
      runId: 'exec_logs',
      conversationId: 'conv_logs',
      status: 'RUNNING',
      createdAt: now,
      updatedAt: now,
      stepIndex: 0,
    });

    await store.appendRunLog({
      executionId: 'exec_logs',
      conversationId: 'conv_logs',
      level: 'info',
      source: 'agent',
      message: 'run.start',
      createdAt: now + 1,
    });
    await store.appendRunLog({
      executionId: 'exec_logs',
      conversationId: 'conv_logs',
      stepIndex: 2,
      level: 'error',
      code: 'TOOL_EXECUTION_FAILED',
      source: 'tool',
      message: 'tool execution failed',
      error: { name: 'Error', message: 'boom' },
      context: { toolName: 'bash' },
      createdAt: now + 2,
    });

    const logs = await store.listRunLogs('exec_logs');
    expect(logs).toHaveLength(2);
    expect(logs.map((log) => log.message)).toEqual(['run.start', 'tool execution failed']);
    expect(logs[1]).toMatchObject({
      level: 'error',
      code: 'TOOL_EXECUTION_FAILED',
      source: 'tool',
      stepIndex: 2,
      error: { message: 'boom' },
      context: { toolName: 'bash' },
    });
  });

  it('filters and limits run logs without mixing execution history', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-app-sqlite-run-log-filter-'));
    const dbPath = path.join(tempDir, 'agent.db');
    store = new SqliteAgentAppStore(dbPath);

    const now = Date.now();
    await store.create({
      executionId: 'exec_filter',
      runId: 'exec_filter',
      conversationId: 'conv_filter',
      status: 'RUNNING',
      createdAt: now,
      updatedAt: now,
      stepIndex: 0,
    });
    await store.create({
      executionId: 'exec_other',
      runId: 'exec_other',
      conversationId: 'conv_filter',
      status: 'RUNNING',
      createdAt: now + 1,
      updatedAt: now + 1,
      stepIndex: 0,
    });

    await store.appendRunLog({
      executionId: 'exec_filter',
      conversationId: 'conv_filter',
      level: 'info',
      source: 'agent',
      message: 'run.start',
      createdAt: now + 2,
    });
    await store.appendRunLog({
      executionId: 'exec_filter',
      conversationId: 'conv_filter',
      level: 'warn',
      source: 'agent',
      message: 'retry.scheduled',
      createdAt: now + 3,
    });
    await store.appendRunLog({
      executionId: 'exec_filter',
      conversationId: 'conv_filter',
      level: 'error',
      source: 'agent',
      message: 'run.error',
      createdAt: now + 4,
    });
    await store.appendRunLog({
      executionId: 'exec_other',
      conversationId: 'conv_filter',
      level: 'error',
      source: 'agent',
      message: 'other.error',
      createdAt: now + 5,
    });

    const errorsOnly = await store.listRunLogs('exec_filter', { level: 'error' });
    expect(errorsOnly).toHaveLength(1);
    expect(errorsOnly[0]).toMatchObject({
      executionId: 'exec_filter',
      level: 'error',
      message: 'run.error',
    });

    const limited = await store.listRunLogs('exec_filter', { limit: 2 });
    expect(limited).toHaveLength(2);
    expect(limited.map((log) => log.message)).toEqual(['run.start', 'retry.scheduled']);
  });

  it('keeps full history while context is updated by compaction and dropped ids are recorded', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-app-sqlite-context-'));
    const dbPath = path.join(tempDir, 'agent.db');
    store = new SqliteAgentAppStore(dbPath);

    const now = Date.now();
    await store.create({
      executionId: 'exec_ctx',
      runId: 'exec_ctx',
      conversationId: 'conv_ctx',
      status: 'RUNNING',
      createdAt: now,
      updatedAt: now,
      stepIndex: 0,
    });

    const messages: Message[] = [
      {
        messageId: 'msg_u_1',
        type: 'user',
        role: 'user',
        content: 'Question',
        timestamp: now + 1,
      },
      {
        messageId: 'msg_a_1',
        type: 'assistant-text',
        role: 'assistant',
        content: 'Answer part 1',
        timestamp: now + 2,
      },
      {
        messageId: 'msg_a_2',
        type: 'assistant-text',
        role: 'assistant',
        content: 'Answer part 2',
        timestamp: now + 3,
      },
    ];

    for (const [index, message] of messages.entries()) {
      const envelope = await store.appendAutoSeq({
        conversationId: 'conv_ctx',
        executionId: 'exec_ctx',
        eventType: message.role === 'user' ? 'user_message' : 'assistant_message',
        data: { message, stepIndex: index + 1 },
        createdAt: now + index + 1,
      });
      await store.upsertFromEvent(envelope);
    }

    const historyBefore = await store.list('conv_ctx');
    const contextBefore = await store.listContext('conv_ctx');
    expect(historyBefore).toHaveLength(3);
    expect(contextBefore).toHaveLength(3);

    await store.applyCompaction({
      conversationId: 'conv_ctx',
      executionId: 'exec_ctx',
      stepIndex: 2,
      removedMessageIds: ['msg_u_1', 'msg_a_1'],
      createdAt: now + 10,
    });

    const historyAfter = await store.list('conv_ctx');
    const contextAfter = await store.listContext('conv_ctx');
    const dropped = await store.listDroppedMessages('exec_ctx');

    expect(historyAfter).toHaveLength(3);
    expect(contextAfter).toHaveLength(1);
    expect(contextAfter[0]?.messageId).toBe('msg_a_2');
    expect(dropped.map((record) => record.removedMessageId)).toEqual(['msg_u_1', 'msg_a_1']);
    expect(dropped.every((record) => record.stepIndex === 2)).toBe(true);
  });

  it('handles concurrent applyCompaction idempotently', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-app-sqlite-concurrent-compact-'));
    const dbPath = path.join(tempDir, 'agent.db');
    store = new SqliteAgentAppStore(dbPath);

    const now = Date.now();
    await store.create({
      executionId: 'exec_compact_conc',
      runId: 'exec_compact_conc',
      conversationId: 'conv_compact_conc',
      status: 'RUNNING',
      createdAt: now,
      updatedAt: now,
      stepIndex: 0,
    });

    const messages: Message[] = [
      {
        messageId: 'msg_drop_1',
        type: 'user',
        role: 'user',
        content: 'A',
        timestamp: now + 1,
      },
      {
        messageId: 'msg_drop_2',
        type: 'assistant-text',
        role: 'assistant',
        content: 'B',
        timestamp: now + 2,
      },
      {
        messageId: 'msg_keep',
        type: 'assistant-text',
        role: 'assistant',
        content: 'C',
        timestamp: now + 3,
      },
    ];

    for (const [index, message] of messages.entries()) {
      const envelope = await store.appendAutoSeq({
        conversationId: 'conv_compact_conc',
        executionId: 'exec_compact_conc',
        eventType: message.role === 'user' ? 'user_message' : 'assistant_message',
        data: { message, stepIndex: index + 1 },
        createdAt: now + index + 1,
      });
      await store.upsertFromEvent(envelope);
    }

    await Promise.all([
      store.applyCompaction({
        conversationId: 'conv_compact_conc',
        executionId: 'exec_compact_conc',
        stepIndex: 9,
        removedMessageIds: ['msg_drop_1', 'msg_drop_2'],
        createdAt: now + 10,
      }),
      store.applyCompaction({
        conversationId: 'conv_compact_conc',
        executionId: 'exec_compact_conc',
        stepIndex: 9,
        removedMessageIds: ['msg_drop_1', 'msg_drop_2', 'msg_drop_2'],
        createdAt: now + 11,
      }),
    ]);

    const contextMessages = await store.listContext('conv_compact_conc');
    expect(contextMessages.map((message) => message.messageId)).toEqual(['msg_keep']);

    const dropped = await store.listDroppedMessages('exec_compact_conc');
    expect(dropped.map((record) => record.removedMessageId)).toEqual(['msg_drop_1', 'msg_drop_2']);
  });
});

import crypto from 'crypto';
import type { Message, ToolCall, Usage } from '../core/types';
import type { MemoryManager } from '../storage';
import type { Logger } from '../logger';

const STREAM_PERSIST_INTERVAL_MS = 1000;

export interface AgentPersistenceState {
  persistCursor: number;
  inProgressAssistantMessageId?: string;
  inProgressAssistantPersisted: boolean;
  lastInProgressAssistantPersistAt: number;
}

export function createPersistenceState(initialCursor = 0): AgentPersistenceState {
  return {
    persistCursor: initialCursor,
    inProgressAssistantMessageId: undefined,
    inProgressAssistantPersisted: false,
    lastInProgressAssistantPersistAt: 0,
  };
}

export function resetStreamPersistence(state: AgentPersistenceState): void {
  state.inProgressAssistantMessageId = undefined;
  state.inProgressAssistantPersisted = false;
  state.lastInProgressAssistantPersistAt = 0;
}

export function getInProgressAssistantMessage(
  messages: Message[],
  state: AgentPersistenceState
): Message | undefined {
  if (!state.inProgressAssistantMessageId) {
    return undefined;
  }
  return messages.find((message) => message.messageId === state.inProgressAssistantMessageId);
}

export async function flushPendingMessages(options: {
  state: AgentPersistenceState;
  messagesLength: number;
  saveMessages: (startIndex: number) => Promise<void>;
}): Promise<void> {
  const { state, messagesLength, saveMessages } = options;
  const startIndex = state.persistCursor;
  await saveMessages(startIndex);
  state.persistCursor = messagesLength;
}

export async function ensureInProgressAssistantMessage(options: {
  state: AgentPersistenceState;
  messages: Message[];
  memoryManager?: MemoryManager;
  sessionId: string;
  currentText: string;
  currentReasoningContent: string;
  currentToolCalls: ToolCall[];
  stepUsage: Usage;
  flushPending: () => Promise<void>;
  logger?: Logger;
  stepIndex: number;
}): Promise<Message | undefined> {
  const {
    state,
    messages,
    memoryManager,
    sessionId,
    currentText,
    currentReasoningContent,
    currentToolCalls,
    stepUsage,
    flushPending,
    logger,
    stepIndex,
  } = options;

  if (!memoryManager) {
    return undefined;
  }

  const existing = getInProgressAssistantMessage(messages, state);
  if (existing) {
    return existing;
  }

  if (state.persistCursor < messages.length) {
    await flushPending();
  }

  const assistantMessage: Message = {
    messageId: crypto.randomUUID(),
    role: 'assistant',
    content: currentText,
    reasoning_content: currentReasoningContent || undefined,
    tool_calls: currentToolCalls.length > 0 ? [...currentToolCalls] : undefined,
    usage: { ...stepUsage },
  };

  messages.push(assistantMessage);
  state.inProgressAssistantMessageId = assistantMessage.messageId;
  state.inProgressAssistantPersisted = false;

  try {
    await memoryManager.addMessages(sessionId, [assistantMessage]);
    state.inProgressAssistantPersisted = true;
    state.persistCursor = messages.length;
    // 允许首个 chunk 在同一轮立刻触发一次 update，避免失败路径只落空壳 assistant
    state.lastInProgressAssistantPersistAt = 0;
  } catch (error) {
    logger?.error('[Agent] Failed to persist initial assistant stream message', error, {
      sessionId,
      stepIndex,
    });
  }

  return assistantMessage;
}

export async function persistInProgressAssistantMessage(options: {
  state: AgentPersistenceState;
  messages: Message[];
  memoryManager?: MemoryManager;
  sessionId: string;
  force?: boolean;
}): Promise<void> {
  const { state, messages, memoryManager, sessionId, force = false } = options;
  if (!memoryManager) {
    return;
  }

  const streamMessage = getInProgressAssistantMessage(messages, state);
  if (!streamMessage) {
    return;
  }

  const now = Date.now();
  if (!force && now - state.lastInProgressAssistantPersistAt < STREAM_PERSIST_INTERVAL_MS) {
    return;
  }

  if (!state.inProgressAssistantPersisted) {
    await memoryManager.addMessages(sessionId, [streamMessage]);
    state.inProgressAssistantPersisted = true;
    state.persistCursor = messages.length;
    state.lastInProgressAssistantPersistAt = now;
    return;
  }

  await memoryManager.updateMessageInContext(sessionId, streamMessage.messageId!, {
    content: streamMessage.content,
    reasoning_content: streamMessage.reasoning_content,
    tool_calls: streamMessage.tool_calls,
    usage: streamMessage.usage,
    finish_reason: streamMessage.finish_reason,
  });
  state.lastInProgressAssistantPersistAt = now;
}

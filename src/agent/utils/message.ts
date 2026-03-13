/**
 * Message utility helpers for renx.
 */

import type { InputContentPart, MessageContent } from '../../providers';
import type { Message } from '../types';

type ToolCallLike = { id?: string };

export function contentToText(content: MessageContent | undefined): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((part) => stringifyContentPart(part))
    .filter(Boolean)
    .join('\n');
}

export function stringifyContentPart(part: InputContentPart): string {
  switch (part.type) {
    case 'text':
      return part.text || '';
    case 'image_url':
      return `[image] ${part.image_url?.url || ''}`.trim();
    case 'file':
      return `[file] ${part.file?.filename || part.file?.file_id || ''}`.trim();
    case 'input_audio':
      return '[audio]';
    case 'input_video':
      return `[video] ${part.input_video?.url || part.input_video?.file_id || ''}`.trim();
    default:
      return '';
  }
}

export function getAssistantToolCalls(message: Message): ToolCallLike[] {
  if (message.role !== 'assistant') return [];
  const rawToolCalls = message.tool_calls;
  if (!Array.isArray(rawToolCalls)) return [];
  return rawToolCalls.map((call) => ({ id: call.id }));
}

export function getToolCallId(message: Message): string | undefined {
  if (message.role !== 'tool') return undefined;
  const toolCallId = message.tool_call_id;
  return typeof toolCallId === 'string' ? toolCallId : undefined;
}

export function isSummaryMessage(message: Message): boolean {
  const text = contentToText(message.content);
  return text.startsWith('[Conversation Summary]') || text.startsWith('[对话摘要]');
}

export function splitMessages(
  messages: Message[],
  keepMessagesNum: number
): {
  systemMessage: Message | undefined;
  pending: Message[];
  active: Message[];
} {
  const systemMessage = messages.find((m) => m.role === 'system');
  const nonSystemMessages = messages.filter((m) => m.role !== 'system');

  let lastUserIndex = -1;
  for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
    if (nonSystemMessages[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }

  let splitPoint = nonSystemMessages.length - keepMessagesNum;
  if (lastUserIndex !== -1 && lastUserIndex < splitPoint) {
    splitPoint = lastUserIndex;
  }
  splitPoint = Math.max(0, splitPoint);

  return {
    systemMessage,
    pending: nonSystemMessages.slice(0, splitPoint),
    active: nonSystemMessages.slice(splitPoint),
  };
}

export function processToolCallPairs(
  pending: Message[],
  active: Message[]
): { pending: Message[]; active: Message[] } {
  const toolCallToAssistant = new Map<string, Message>();

  for (const msg of [...pending, ...active]) {
    for (const call of getAssistantToolCalls(msg)) {
      if (call.id) {
        toolCallToAssistant.set(call.id, msg);
      }
    }
  }

  const toolsNeedingPair = active.filter((msg) => {
    if (msg.role !== 'tool') return false;
    const toolCallId = getToolCallId(msg);
    return typeof toolCallId === 'string' && toolCallToAssistant.has(toolCallId);
  });

  if (toolsNeedingPair.length === 0) {
    return { pending, active };
  }

  const assistantsToMove = new Set<Message>();
  const toolCallIdsToMove = new Set<string>();

  for (const toolMsg of toolsNeedingPair) {
    const toolCallId = getToolCallId(toolMsg);
    if (!toolCallId) continue;
    const assistantMsg = toolCallToAssistant.get(toolCallId);
    if (assistantMsg) {
      assistantsToMove.add(assistantMsg);
      toolCallIdsToMove.add(toolCallId);
    }
  }

  const newPending = pending.filter((msg) => {
    if (assistantsToMove.has(msg)) return false;
    if (msg.role === 'tool') {
      const toolCallId = getToolCallId(msg);
      if (toolCallId && toolCallIdsToMove.has(toolCallId)) return false;
    }
    return true;
  });

  const newActive: Message[] = [];
  const addedMessages = new Set<Message>();

  for (const assistantMsg of assistantsToMove) {
    newActive.push(assistantMsg);
    addedMessages.add(assistantMsg);

    for (const call of getAssistantToolCalls(assistantMsg)) {
      if (call.id) {
        const toolMsg = active.find((m) => m.role === 'tool' && getToolCallId(m) === call.id);
        if (toolMsg && !addedMessages.has(toolMsg)) {
          newActive.push(toolMsg);
          addedMessages.add(toolMsg);
        }
      }
    }
  }

  for (const msg of active) {
    if (!addedMessages.has(msg)) {
      newActive.push(msg);
    }
  }

  return { pending: newPending, active: newActive };
}

export function rebuildMessages(
  systemMessage: Message | undefined,
  summaryMessage: Message | null,
  active: Message[]
): Message[] {
  const messages: Message[] = [];
  if (systemMessage) messages.push(systemMessage);
  if (summaryMessage) messages.push(summaryMessage);
  messages.push(...active);
  return messages;
}

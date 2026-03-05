/**
 * 消息相关工具函数
 */

import type { InputContentPart, MessageContent } from '../providers';
import type { Message } from '../agent/types';

// =============================================================================
// 内容转换
// =============================================================================

/**
 * 将消息内容转换为文本
 */
export function contentToText(content: MessageContent | undefined): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  return content
    .map((part) => stringifyContentPart(part))
    .filter(Boolean)
    .join('\n');
}

/**
 * 将内容部分转换为字符串
 */
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

// =============================================================================
// 消息类型判断
// =============================================================================

type ToolCallLike = { id?: string };

/**
 * 获取 assistant 消息中的工具调用
 */
export function getAssistantToolCalls(message: Message): ToolCallLike[] {
  if (message.role !== 'assistant') return [];
  const rawToolCalls = message.tool_calls;
  if (!Array.isArray(rawToolCalls)) return [];
  return rawToolCalls.filter(
    (call): call is ToolCallLike => typeof call === 'object' && call !== null
  );
}

/**
 * 获取 tool 消息中的工具调用 ID
 */
export function getToolCallId(message: Message): string | undefined {
  if (message.role !== 'tool') return undefined;
  const toolCallId = message.tool_call_id;
  return typeof toolCallId === 'string' ? toolCallId : undefined;
}

/**
 * 检查是否为摘要消息
 */
export function isSummaryMessage(message: Message): boolean {
  const text = contentToText(message.content);
  return text.startsWith('[Conversation Summary]') || text.startsWith('[对话摘要]');
}

// =============================================================================
// 消息操作
// =============================================================================

/**
 * 分离消息为 system、pending、active 三个区域
 *
 * @param messages 消息列表
 * @param keepMessagesNum 保留的最近消息数
 */
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

  // 找到最后一条 user 消息的索引
  let lastUserIndex = -1;
  for (let i = nonSystemMessages.length - 1; i >= 0; i--) {
    if (nonSystemMessages[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }

  // 默认的切分点
  let splitPoint = nonSystemMessages.length - keepMessagesNum;

  // 如果最后一条 user 消息在 pending 区域，调整切分点
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

/**
 * 处理工具调用配对，确保 active 区域的 tool 消息有对应的 assistant 消息
 */
export function processToolCallPairs(
  pending: Message[],
  active: Message[]
): { pending: Message[]; active: Message[] } {
  // 构建工具调用 ID -> assistant 消息的映射
  const toolCallToAssistant = new Map<string, Message>();

  for (const msg of [...pending, ...active]) {
    for (const call of getAssistantToolCalls(msg)) {
      if (call.id) {
        toolCallToAssistant.set(call.id, msg);
      }
    }
  }

  // 找出 active 区域中需要配对的 tool 消息
  const toolsNeedingPair = active.filter((msg) => {
    if (msg.role !== 'tool') return false;
    const toolCallId = getToolCallId(msg);
    return typeof toolCallId === 'string' && toolCallToAssistant.has(toolCallId);
  });

  if (toolsNeedingPair.length === 0) {
    return { pending, active };
  }

  // 收集需要移动的 assistant 消息
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

  // 从 pending 中移除
  const newPending = pending.filter((msg) => {
    if (assistantsToMove.has(msg)) return false;
    if (msg.role === 'tool') {
      const toolCallId = getToolCallId(msg);
      if (toolCallId && toolCallIdsToMove.has(toolCallId)) return false;
    }
    return true;
  });

  // 构建新的 active 区域
  const newActive: Message[] = [];
  const addedMessages = new Set<Message>();

  // 先添加需要移动的 assistant + 对应的 tool
  for (const assistantMsg of assistantsToMove) {
    newActive.push(assistantMsg);
    addedMessages.add(assistantMsg);

    for (const call of getAssistantToolCalls(assistantMsg)) {
      if (call?.id) {
        const toolMsg = active.find((m) => m.role === 'tool' && getToolCallId(m) === call.id);
        if (toolMsg && !addedMessages.has(toolMsg)) {
          newActive.push(toolMsg);
          addedMessages.add(toolMsg);
        }
      }
    }
  }

  // 添加剩余的 active 消息
  for (const msg of active) {
    if (!addedMessages.has(msg)) {
      newActive.push(msg);
    }
  }

  return { pending: newPending, active: newActive };
}

/**
 * 重组消息列表
 */
export function rebuildMessages(
  systemMessage: Message | undefined,
  summaryMessage: Message | null,
  active: Message[]
): Message[] {
  const messages: Message[] = [];
  if (systemMessage) {
    messages.push(systemMessage);
  }

  if (summaryMessage) {
    messages.push(summaryMessage);
  }

  messages.push(...active);
  return messages;
}

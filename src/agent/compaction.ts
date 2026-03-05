/**
 * 上下文压缩模块
 *
 * 使用 LLM 生成摘要来压缩对话历史，减少 token 消耗
 */

import type { LLMProvider, LLMResponse, Tool } from '../providers';
import type { Logger } from '../logger';
import type { Message } from './types';
import {
  contentToText,
  splitMessages,
  processToolCallPairs,
  rebuildMessages,
} from '../utils/message';
import { estimateTokens } from '../utils/token';

// =============================================================================
// 类型定义
// =============================================================================

/**
 * 压缩选项
 */
export interface CompactOptions {
  /** LLM Provider（用于生成摘要） */
  provider: LLMProvider;
  /** 保留最近消息数 */
  keepMessagesNum: number;
  /** 日志器（可选） */
  logger?: Logger;
  /** 摘要语言（默认 'English'） */
  language?: string;
}

/**
 * 压缩结果
 */
export interface CompactResult {
  /** 压缩后的消息列表 */
  messages: Message[];
  /** 摘要消息 */
  summaryMessage: Message;
  /** 被丢弃的消息 ID 列表 */
  removedMessageIds: string[];
}

// =============================================================================
// Token 估算工具函数
// =============================================================================

export { estimateTokens };

/**
 * 估算消息列表的 Token 数
 *
 * @param messages 消息列表
 * @param tools 可选的工具定义列表
 * @returns 估算的总 token 数
 */
export function estimateMessagesTokens(messages: Message[], tools?: Tool[]): number {
  const messagesTotal = messages.reduce((acc, m) => {
    return acc + estimateTokens(JSON.stringify(m)) + 4;
  }, 0);

  const toolsTotal = tools ? estimateTokens(JSON.stringify(tools)) : 0;

  return messagesTotal + toolsTotal;
}

// =============================================================================
// 内部辅助函数
// =============================================================================

function isSummaryMessage(message: Message): boolean {
  const text = contentToText(message.content);
  return text.startsWith('[Conversation Summary]') || text.startsWith('[对话摘要]');
}

function buildSummaryPrompt(language = 'English'): string {
  return `You are an expert conversation compressor. Compress conversation history into a structured summary organized in following 8 sections:
1. **Primary Request and Intent**: What is user's core goal?
2. **Key Technical Concepts**: Frameworks, libraries, tech stacks, etc.
3. **Files and Code Sections**: All file paths mentioned or modified.
4. **Errors and Fixes**: Record error messages and solutions.
5. **Problem Solving**: The thought process and decision path.
6. **All User Messages**: Preserve key instructions and feedback.
7. **Pending Tasks**: Work items that remain unfinished.
8. **Current Work**: The progress at the point conversation was interrupted.

## Requirements:
- Maintain high density and accuracy of information
- Highlight key technical decisions and solutions
- Ensure continuity of context
- Retain all important file paths
- Use concise ${language} expression`;
}

// =============================================================================
// 核心压缩函数
// =============================================================================

/**
 * 压缩对话历史
 *
 * @param messages 原始消息列表
 * @param options 压缩选项
 * @returns 压缩结果
 */
export async function compact(
  messages: Message[],
  options: CompactOptions
): Promise<CompactResult> {
  const { provider, keepMessagesNum, logger, language = 'English' } = options;

  // 分离消息区域
  const { systemMessage, pending, active } = splitMessages(messages, keepMessagesNum);

  // 处理工具调用配对
  const { pending: finalPending, active: finalActive } = processToolCallPairs(pending, active);

  // 收集被丢弃的消息 ID
  const removedMessageIds = collectRemovedMessageIds(messages, new Set(finalActive), systemMessage);

  // 生成摘要
  const summaryContent = await generateSummary({
    provider,
    pendingMessages: finalPending,
    sourceMessages: messages,
    activeMessages: finalActive,
    language,
    logger,
  });

  const summaryMessage: Message = {
    messageId: crypto.randomUUID(),
    role: 'assistant',
    type: 'summary',
    content: `[Conversation Summary]\n${summaryContent}`,
  };

  // 重组消息
  const newMessages = rebuildMessages(systemMessage, summaryMessage, finalActive);

  logger?.info(`[Compaction] Completed. messages=${messages.length}->${newMessages.length}`);

  return { messages: newMessages, summaryMessage, removedMessageIds };
}

/**
 * 收集被丢弃的消息 ID
 */
function collectRemovedMessageIds(
  allMessages: Message[],
  keptMessages: Set<Message>,
  systemMessage?: Message
): string[] {
  const removedIds: string[] = [];

  for (const msg of allMessages) {
    // 跳过 system 消息
    if (msg === systemMessage) continue;
    // 如果消息不在保留集合中，收集其 ID
    if (!keptMessages.has(msg)) {
      if (msg.messageId) {
        removedIds.push(msg.messageId);
      }
    }
  }

  return removedIds;
}

// =============================================================================
// 内部实现
// =============================================================================

async function generateSummary(input: {
  provider: LLMProvider;
  pendingMessages: Message[];
  sourceMessages: Message[];
  activeMessages: Message[];
  language: string;
  logger?: Logger;
}): Promise<string> {
  const { provider, pendingMessages, sourceMessages, activeMessages, language, logger } = input;

  if (pendingMessages.length === 0) {
    return 'No messages to summarize.';
  }

  let previousSummary = '';
  if (isSummaryMessage(pendingMessages[0])) {
    previousSummary = contentToText(pendingMessages[0].content);
  }

  const summaryPrompt = buildSummaryPrompt(language);
  const previousSummaryBlock = previousSummary
    ? `\n<previous_summary>\n${previousSummary}\n</previous_summary>\n`
    : '';

  const compactionMessage = `<compaction-message>
${summaryPrompt}

Compaction constraints:
- Summarize earlier historical context in this conversation.
- Keep the most recent ${activeMessages.length} messages untouched (they remain in active context).
- Return plain summary text only; do NOT call tools.
- Preserve key decisions, file paths, unresolved tasks, and user constraints.
${previousSummaryBlock}
</compaction-message>`;

  const requestMessages = [
    ...sourceMessages,
    { role: 'user' as const, content: compactionMessage },
  ];

  const options: { max_tokens: number; model?: string; abortSignal?: AbortSignal } = {
    max_tokens: 1024,
  };

  const configuredModel = provider.config?.model;
  if (typeof configuredModel === 'string' && configuredModel.trim().length > 0) {
    options.model = configuredModel;
  }

  // 设置超时
  const timeoutMs = provider.getTimeTimeout();
  if (timeoutMs && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    try {
      options.abortSignal = AbortSignal.timeout(timeoutMs);
    } catch {
      // ignore
    }
  }

  try {
    const response = await provider.generate(requestMessages, options);

    if (!response || typeof response !== 'object' || !('choices' in response)) {
      logger?.warn('[Compaction] Summary generation returned invalid response');
      return previousSummary || 'Summary generation failed.';
    }

    const choice = (response as LLMResponse).choices?.[0];

    const content = contentToText(choice?.message?.content || '').trim();
    return content || previousSummary || 'Summary generation failed.';
  } catch (error) {
    logger?.warn('[Compaction] Summary generation failed:', { error: String(error) });
    return previousSummary || 'Summary generation failed.';
  }
}

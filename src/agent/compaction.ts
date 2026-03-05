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
  summaryMessage: Message | null;
  /** 被丢弃的消息 ID 列表 */
  removedMessageIds: string[];
}

// =============================================================================
// Token 估算工具函数
// =============================================================================

/**
 * 估算文本 Token 数（改进版）
 *
 * 算法说明：
 * - 中文字符（Unicode \u4e00-\u9fa5）：1 字符 ≈ 1.5 token
 * - 其他字符（英文，数字、符号等）：1 字符 ≈ 0.25 token
 *
 * 此估算基于常见 LLM（GPT、GLM 等）的 BPE 分词特点：
 * - 中文通常每个字为 1-2 个 token，平均约 1.5
 * - 英文单词平均为 0.5-1 个 token，按字符算是约 0.25
 *
 * @param text 要估算的文本
 * @returns 估算的 token 数
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  let cnCount = 0;
  let otherCount = 0;

  for (const char of text) {
    // 判断是否为中文字符（CJK 统一表意文字范围）
    if (char >= '\u4e00' && char <= '\u9fa5') {
      cnCount++;
    } else {
      otherCount++;
    }
  }

  // 中文：1.5 token/字符，其他：0.25 token/字符
  const totalTokens = cnCount * 1.5 + otherCount * 0.25;
  return Math.ceil(totalTokens);
}

/**
 * 估算消息列表的 Token 数
 *
 * @param messages 消息列表
 * @param tools 可选的工具定义列表
 * @returns 估算的总 token 数
 */
export function estimateMessagesTokens(messages: Message[], tools?: Tool[]): number {
  const messagesTotal = messages.reduce((acc, m) => {
    // 使用改进的 token 估算
    const content = JSON.stringify(m);
    return acc + estimateTokens(content) + 4; // 每条消息约 4 token 的 overhead
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

function buildSummaryPrompt(): string {
  return `You are an expert AI conversation compressor. Compress the conversation history into a structured memory summary with the following sections: 1. Primary Request and Intent 2. Key Technical Concepts 3. Files and Code Sections (preserve exact file paths) 4. Errors and Fixes (include exact error messages) 5. Problem Solving Process 6. Important User Instructions and Constraints 7. Pending Tasks 8. Current Work State Requirements: - Preserve critical technical details - Keep exact file paths and commands - Remove redundant or conversational text - Maintain task continuity for future steps - Keep the summary concise but information-dense`;
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
  const { provider, keepMessagesNum, logger } = options;
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
    logger,
  });
  const summaryMessage = summaryContent
    ? {
        messageId: crypto.randomUUID(),
        role: 'assistant' as const,
        type: 'summary' as const,
        content: `[Conversation Summary]\n${summaryContent}`,
      }
    : null;
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
  logger?: Logger;
}): Promise<string> {
  const { provider, pendingMessages, sourceMessages, logger } = input;

  if (pendingMessages.length === 0) {
    return '';
  }

  let previousSummary = '';
  if (isSummaryMessage(pendingMessages[0])) {
    previousSummary = contentToText(pendingMessages[0].content);
  }

  const summaryPrompt = buildSummaryPrompt();
  const previousSummaryBlock = previousSummary
    ? `\n<previous_summary>\n${previousSummary}\n</previous_summary>\n`
    : '';

  const compactionMessage = `<compaction-message>
   ${sourceMessages.map((m) => `${m.role}: ${contentToText(m.content)}`).join('\n')}
  </compaction-message>`;

  const requestMessages = [
    { role: 'system' as const, content: summaryPrompt },
    { role: 'user' as const, content: `${compactionMessage}\n${previousSummaryBlock}` },
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
      return '';
    }

    const choice = (response as LLMResponse).choices?.[0];

    const content = contentToText(choice?.message?.content || '').trim();
    return content || '';
  } catch (error) {
    logger?.warn('[Compaction] Summary generation failed:', { error: String(error) });
    return '';
  }
}

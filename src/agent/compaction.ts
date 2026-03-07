/**
 * 上下文压缩模块
 *
 * 使用 LLM 生成摘要来压缩对话历史，减少 token 消耗
 */

import { getEncoding } from 'js-tiktoken';
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

// 使用 cl100k_base 编码（GPT-3.5/GPT-4 使用的编码）
const encoder = getEncoding('cl100k_base');

/**
 * 估算文本 Token 数（使用 js-tiktoken 精确计算）
 *
 * 使用 OpenAI 的 cl100k_base 编码进行精确 Token 计算。
 * 相比启发式算法，这能提供准确的 Token 计数，避免上下文溢出。
 *
 * @param text 要估算的文本
 * @returns 实际 token 数
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  try {
    return encoder.encode(text).length;
  } catch (error) {
    // 降级策略：如果编码失败，使用保守的启发式估算
    // 汉字 x2，其他 x1.3
    console.warn('[TokenEstimation] Failed to encode text, using heuristic fallback', error);
    const chineseMatch = text.match(/[\u4e00-\u9fa5]/g);
    const chineseCount = chineseMatch ? chineseMatch.length : 0;
    const otherCount = text.length - chineseCount;
    return Math.ceil(chineseCount * 2 + otherCount * 0.4);
  }
}

/**
 * 估算消息列表的 Token 数
 *
 * 遵循 OpenAI 聊天格式的计费规则：
 * - 每条消息有 3 tokens 的固定开销 (<|start|>{role}<|end|>)
 * - name 字段额外 1 token
 * - role 和 content 计入 token
 * - 回复引导词 3 tokens
 */
export function estimateMessagesTokens(messages: Message[], tools?: Tool[]): number {
  let total = 0;

  for (const m of messages) {
    total += 3; // 每条消息的固定开销

    // role
    if (m.role) {
      total += estimateTokens(m.role);
    }

    // name
    const name = m.name as string | undefined;
    if (name) {
      total += estimateTokens(name) + 1; // name 字段额外开销
    }

    // content
    if (typeof m.content === 'string') {
      total += estimateTokens(m.content);
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part.type === 'text' && part.text) {
          total += estimateTokens(part.text);
        }
        // 对于 image_url，暂按固定开销估算
        // 参考 OpenAI 计费标准：
        // - Low detail: 85 tokens
        // - High detail: 85 + 170 * N (512x512 tiles)
        // 由于无法获取图片实际尺寸，对于 high/auto 模式，我们采用一个保守的预估值（例如假设平均需要 4 个 tiles => ~765 tokens）
        if (part.type === 'image_url') {
          const detail = part.image_url.detail || 'auto';
          if (detail === 'low') {
            total += 85;
          } else {
            // High/Auto 模式下，假设图片较大，使用较安全的估算值
            total += 765;
          }
        }
      }
    }

    // tool_calls
    const toolCalls = m.tool_calls as unknown[];
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      // 简单估算 tool calls 的 JSON 结构
      total += estimateTokens(JSON.stringify(toolCalls));
    }

    // tool_call_id
    const toolCallId = m.tool_call_id as string | undefined;
    if (toolCallId) {
      total += estimateTokens(toolCallId);
    }
  }

  // 工具定义开销
  if (tools && tools.length > 0) {
    // 工具定义通常比较庞大，直接对 JSON 估算比较合理
    total += estimateTokens(JSON.stringify(tools));
  }

  // 回复引导词
  total += 3;

  return total;
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

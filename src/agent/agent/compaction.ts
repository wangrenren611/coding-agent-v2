/**
 * 涓婁笅鏂囧帇缂╂ā鍧? *
 * 浣跨敤 LLM 鐢熸垚鎽樿鏉ュ帇缂╁璇濆巻鍙诧紝鍑忓皯 token 娑堣€? */

import { getEncoding } from 'js-tiktoken';
import type { LLMProvider, LLMResponse } from '../../providers';
import type { Message } from '../types';
import type { AgentLogger } from './logger';
import {
  contentToText,
  splitMessages,
  processToolCallPairs,
  rebuildMessages,
} from '../utils/message';
import { LLMTool } from '../tool/types';

// =============================================================================
// 绫诲瀷瀹氫箟
// =============================================================================

/**
 * 鍘嬬缉閫夐」
 */
export interface CompactOptions {
  /** LLM Provider锛堢敤浜庣敓鎴愭憳瑕侊級 */
  provider: LLMProvider;
  /** 淇濈暀鏈€杩戞秷鎭暟 */
  keepMessagesNum: number;
  /** 鏃ュ織鍣紙鍙€夛級 */
  logger?: AgentLogger;
  /** 鎽樿璇█锛堥粯璁?'English'锛?*/
  language?: string;
}

/**
 * 鍘嬬缉缁撴灉
 */
export interface CompactResult {
  /** 鍘嬬缉鍚庣殑娑堟伅鍒楄〃 */
  messages: Message[];
  /** 鎽樿娑堟伅 */
  summaryMessage: Message | null;
  /** 琚涪寮冪殑娑堟伅 ID 鍒楄〃 */
  removedMessageIds: string[];
}

// =============================================================================
// Token 浼扮畻宸ュ叿鍑芥暟
// =============================================================================

// 浣跨敤 cl100k_base 缂栫爜锛圙PT-3.5/GPT-4 浣跨敤鐨勭紪鐮侊級
const encoder = getEncoding('cl100k_base');

/**
 * 浼扮畻鏂囨湰 Token 鏁帮紙浣跨敤 js-tiktoken 绮剧‘璁＄畻锛? *
 * 浣跨敤 OpenAI 鐨?cl100k_base 缂栫爜杩涜绮剧‘ Token 璁＄畻銆? * 鐩告瘮鍚彂寮忕畻娉曪紝杩欒兘鎻愪緵鍑嗙‘鐨?Token 璁℃暟锛岄伩鍏嶄笂涓嬫枃婧㈠嚭銆? *
 * @param text 瑕佷及绠楃殑鏂囨湰
 * @returns 瀹為檯 token 鏁? */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  try {
    return encoder.encode(text).length;
  } catch (error) {
    // 闄嶇骇绛栫暐锛氬鏋滅紪鐮佸け璐ワ紝浣跨敤淇濆畧鐨勫惎鍙戝紡浼扮畻
    // 姹夊瓧 x2锛屽叾浠?x1.3
    console.warn('[TokenEstimation] Failed to encode text, using heuristic fallback', error);
    const chineseMatch = text.match(/[\u4e00-\u9fa5]/g);
    const chineseCount = chineseMatch ? chineseMatch.length : 0;
    const otherCount = text.length - chineseCount;
    return Math.ceil(chineseCount * 2 + otherCount * 0.4);
  }
}

/**
 * 浼扮畻娑堟伅鍒楄〃鐨?Token 鏁? *
 * 閬靛惊 OpenAI 鑱婂ぉ鏍煎紡鐨勮璐硅鍒欙細
 * - 姣忔潯娑堟伅鏈?3 tokens 鐨勫浐瀹氬紑閿€ (<|start|>{role}<|end|>)
 * - name 瀛楁棰濆 1 token
 * - role 鍜?content 璁″叆 token
 * - 鍥炲寮曞璇?3 tokens
 */
export function estimateMessagesTokens(messages: Message[], tools?: LLMTool[]): number {
  let total = 0;

  for (const m of messages) {
    // Per-message protocol overhead.
    total += 3;

    if (m.role) {
      total += estimateTokens(m.role);
    }

    const name = (m as unknown as Record<string, unknown>).name as string | undefined;
    if (name) {
      // Name field has an additional overhead token.
      total += estimateTokens(name) + 1;
    }

    if (typeof m.content === 'string') {
      total += estimateTokens(m.content);
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part.type === 'text' && part.text) {
          total += estimateTokens(part.text);
          continue;
        }

        if (part.type === 'image_url') {
          const detail = part.image_url.detail || 'auto';
          if (detail === 'low') {
            total += 85;
          } else {
            // Conservative estimate for high/auto detail images.
            total += 765;
          }
        }
      }
    }

    const toolCalls = m.tool_calls as unknown[];
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      total += estimateTokens(JSON.stringify(toolCalls));
    }

    const toolCallId = m.tool_call_id as string | undefined;
    if (toolCallId) {
      total += estimateTokens(toolCallId);
    }
  }

  if (tools && tools.length > 0) {
    total += estimateTokens(JSON.stringify(tools));
  }

  // Assistant priming tokens.
  total += 3;
  return total;
}

export type CompactionLogger = AgentLogger;

// =============================================================================
// 鍐呴儴杈呭姪鍑芥暟
// =============================================================================

function isSummaryMessage(message: Message): boolean {
  const text = contentToText(message.content);
  return text.startsWith('[Conversation Summary]') || text.startsWith('[瀵硅瘽鎽樿]');
}

function buildSummaryPrompt(): string {
  return `You are an expert AI conversation compressor. Compress the conversation history into a structured memory summary with the following sections: 1. Primary Request and Intent 2. Key Technical Concepts 3. Files and Code Sections (preserve exact file paths) 4. Errors and Fixes (include exact error messages) 5. Problem Solving Process 6. Important User Instructions and Constraints 7. Pending Tasks 8. Current Work State Requirements: - Preserve critical technical details - Keep exact file paths and commands - Remove redundant or conversational text - Maintain task continuity for future steps - Keep the summary concise but information-dense`;
}

// =============================================================================
// 鏍稿績鍘嬬缉鍑芥暟
// =============================================================================

/**
 * 鍘嬬缉瀵硅瘽鍘嗗彶
 *
 * @param messages 鍘熷娑堟伅鍒楄〃
 * @param options 鍘嬬缉閫夐」
 * @returns 鍘嬬缉缁撴灉
 */
export async function compact(
  messages: Message[],
  options: CompactOptions
): Promise<CompactResult> {
  const { provider, keepMessagesNum, logger } = options;
  // 鍒嗙娑堟伅鍖哄煙
  const { systemMessage, pending, active } = splitMessages(messages, keepMessagesNum);
  // 澶勭悊宸ュ叿璋冪敤閰嶅
  const { pending: finalPending, active: finalActive } = processToolCallPairs(pending, active);
  // 鏀堕泦琚涪寮冪殑娑堟伅 ID
  const removedMessageIds = collectRemovedMessageIds(messages, new Set(finalActive), systemMessage);
  // 鐢熸垚鎽樿
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
        timestamp: Date.now(),
      }
    : null;
  // 閲嶇粍娑堟伅
  const newMessages = rebuildMessages(systemMessage, summaryMessage, finalActive);
  logger?.info?.(`[Compaction] Completed. messages=${messages.length}->${newMessages.length}`);
  return { messages: newMessages, summaryMessage, removedMessageIds };
}

/**
 * 鏀堕泦琚涪寮冪殑娑堟伅 ID
 */
function collectRemovedMessageIds(
  allMessages: Message[],
  keptMessages: Set<Message>,
  systemMessage?: Message
): string[] {
  const removedIds: string[] = [];
  for (const msg of allMessages) {
    // 璺宠繃 system 娑堟伅
    if (msg === systemMessage) continue;
    // 濡傛灉娑堟伅涓嶅湪淇濈暀闆嗗悎涓紝鏀堕泦鍏?ID
    if (!keptMessages.has(msg)) {
      if (msg.messageId) {
        removedIds.push(msg.messageId);
      }
    }
  }
  return removedIds;
}

// =============================================================================
// 鍐呴儴瀹炵幇
// =============================================================================

async function generateSummary(input: {
  provider: LLMProvider;
  pendingMessages: Message[];
  sourceMessages: Message[];
  logger?: AgentLogger;
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

  // 璁剧疆瓒呮椂
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
      logger?.warn?.('[Compaction] Summary generation returned invalid response');
      return '';
    }

    const choice = (response as LLMResponse).choices?.[0];

    const content = contentToText(choice?.message?.content || '').trim();
    return content || '';
  } catch (error) {
    logger?.warn?.('[Compaction] Summary generation failed:', { error: String(error) });
    return '';
  }
}

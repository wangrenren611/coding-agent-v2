/**
 * Agent 完成检测器
 */

import type { AgentStepResult, CompletionResult } from './types';

// =============================================================================
// 默认完成检测器
// =============================================================================

/**
 * 默认完成检测逻辑
 */
export function defaultCompletionDetector(lastStep: AgentStepResult | undefined): CompletionResult {
  if (lastStep) {
    // 没有更多工具调用且文本生成完成
    if (lastStep.finishReason === 'stop' && lastStep.toolCalls.length === 0) {
      return { done: true, reason: 'stop' };
    }

    // 达到长度限制
    if (lastStep.finishReason === 'length') {
      return { done: true, reason: 'length', message: 'Max tokens reached' };
    }
  }

  return { done: false, reason: 'stop' };
}

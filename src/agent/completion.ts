/**
 * Agent 完成检测器
 */

import type { AgentStepResult, CompletionResult, CompletionDetector } from './types';

// =============================================================================
// 预置完成检测器
// =============================================================================

/**
 * 检测到特定文本时完成
 */
export function createTextCompletionDetector(stopText: string | RegExp): CompletionDetector {
  return (state) => {
    if (typeof stopText === 'string') {
      return { done: state.currentText.includes(stopText), reason: 'stop' };
    } else {
      return { done: stopText.test(state.currentText), reason: 'stop' };
    }
  };
}

/**
 * 检测到特定工具调用时完成
 */
export function createToolCompletionDetector(toolNames: string[]): CompletionDetector {
  return async (_state, _messages, lastStep) => {
    if (!lastStep) return { done: false, reason: 'stop' };

    const hasTargetTool = lastStep.toolCalls.some((tc) => toolNames.includes(tc.function.name));

    return { done: hasTargetTool, reason: 'tool_calls_complete' };
  };
}

/**
 * 组合多个完成检测器
 */
export function combineCompletionDetectors(...detectors: CompletionDetector[]): CompletionDetector {
  return async (state, messages, lastStep) => {
    for (const detector of detectors) {
      const result = await detector(state, messages, lastStep);
      if (result.done) {
        return result;
      }
    }
    return { done: false, reason: 'stop' };
  };
}

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

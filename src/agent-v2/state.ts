/**
 * Agent 状态管理
 */

import type { Usage } from '../providers';
import { DEFAULT_BACKOFF_CONFIG } from '../providers';
import type { AgentLoopState } from './types';

// =============================================================================
// 默认配置
// =============================================================================

/**
 * Agent 默认配置
 */
export const DEFAULT_AGENT_CONFIG = {
  maxSteps: 1000,
  maxRetries: 10,
  debug: false,
  enableCompaction: false,
  compactionKeepMessages: 40,
  summaryLanguage: 'English',
  compactionTriggerRatio: 0.9,
  useDefaultCompletionDetector: true,
  memoryManager: undefined,
} as const;

/**
 * 默认退避配置
 */
export const DEFAULT_AGENT_BACKOFF_CONFIG = DEFAULT_BACKOFF_CONFIG;

// =============================================================================
// 状态工厂
// =============================================================================

/**
 * 创建空的 Usage 对象
 */
export function createEmptyUsage(): Usage {
  return {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };
}

/**
 * 创建初始状态
 */
export function createInitialState(): AgentLoopState {
  return {
    stepIndex: 0,
    currentText: '',
    currentToolCalls: [],
    totalUsage: createEmptyUsage(),
    stepUsage: createEmptyUsage(),
    retryCount: 0,
    needsRetry: false,
    aborted: false,
    resultStatus: 'continue',
  };
}


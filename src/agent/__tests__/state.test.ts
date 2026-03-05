/**
 * Agent 状态管理测试
 */

import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_AGENT_CONFIG,
  DEFAULT_AGENT_BACKOFF_CONFIG,
  createEmptyUsage,
  createInitialState,
  mergeAgentConfig,
} from '../state';
import type { AgentConfig } from '../types';
import type { BackoffConfig } from '../../providers';

describe('DEFAULT_AGENT_CONFIG', () => {
  it('should have correct default values', () => {
    expect(DEFAULT_AGENT_CONFIG.maxSteps).toBe(1000);
    expect(DEFAULT_AGENT_CONFIG.maxRetries).toBe(10);
    expect(DEFAULT_AGENT_CONFIG.debug).toBe(false);
    expect(DEFAULT_AGENT_CONFIG.enableCompaction).toBe(false);
    expect(DEFAULT_AGENT_CONFIG.compactionThreshold).toBe(100000);
    expect(DEFAULT_AGENT_CONFIG.compactionKeepMessages).toBe(10);
    expect(DEFAULT_AGENT_CONFIG.summaryLanguage).toBe('English');
    expect(DEFAULT_AGENT_CONFIG.memoryManager).toBeUndefined();
  });
});

describe('DEFAULT_AGENT_BACKOFF_CONFIG', () => {
  it('should reference DEFAULT_BACKOFF_CONFIG from providers', () => {
    expect(DEFAULT_AGENT_BACKOFF_CONFIG).toBeDefined();
    expect(DEFAULT_AGENT_BACKOFF_CONFIG.initialDelayMs).toBe(1000);
    expect(DEFAULT_AGENT_BACKOFF_CONFIG.maxDelayMs).toBe(60000);
    expect(DEFAULT_AGENT_BACKOFF_CONFIG.base).toBe(2);
    expect(DEFAULT_AGENT_BACKOFF_CONFIG.jitter).toBe(true);
  });
});

describe('createEmptyUsage', () => {
  it('should create usage with all zeros', () => {
    const usage = createEmptyUsage();

    expect(usage).toEqual({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    });
  });

  it('should create a new object each time', () => {
    const usage1 = createEmptyUsage();
    const usage2 = createEmptyUsage();

    expect(usage1).not.toBe(usage2);
  });
});

describe('createInitialState', () => {
  it('should create correct initial state', () => {
    const state = createInitialState();

    expect(state.loopIndex).toBe(0);
    expect(state.stepIndex).toBe(0);
    expect(state.currentText).toBe('');
    expect(state.currentToolCalls).toEqual([]);
    expect(state.totalUsage).toEqual({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    });
    expect(state.stepUsage).toEqual({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    });
    expect(state.retryCount).toBe(0);
    expect(state.needsRetry).toBe(false);
    expect(state.aborted).toBe(false);
    expect(state.resultStatus).toBe('continue');
  });

  it('should create independent state objects', () => {
    const state1 = createInitialState();
    const state2 = createInitialState();

    state1.loopIndex = 5;
    state1.currentText = 'modified';

    expect(state2.loopIndex).toBe(0);
    expect(state2.currentText).toBe('');
  });
});

describe('mergeAgentConfig', () => {
  // Mock provider
  const mockProvider = {
    generate: vi.fn(),
    generateStream: vi.fn(),
    getTimeTimeout: vi.fn(() => 60000),
  } as unknown as import('../../providers').LLMProvider;

  const mockToolManager = {
    register: vi.fn(),
    toToolsSchema: vi.fn(() => []),
    executeTools: vi.fn(),
  } as unknown as import('../../tool').ToolManager;

  it('should merge with default values when minimal config provided', () => {
    const config: AgentConfig = {
      provider: mockProvider,
      toolManager: mockToolManager,
    };

    const merged = mergeAgentConfig(config);

    expect(merged.maxSteps).toBe(1000);
    expect(merged.maxRetries).toBe(10);
    expect(merged.debug).toBe(false);
    expect(merged.enableCompaction).toBe(false);
    expect(merged.compactionThreshold).toBe(100000);
    expect(merged.compactionKeepMessages).toBe(10);
    expect(merged.summaryLanguage).toBe('English');
    expect(merged.provider).toBe(mockProvider);
    expect(merged.toolManager).toBe(mockToolManager);
  });

  it('should override default values with provided config', () => {
    const config: AgentConfig = {
      provider: mockProvider,
      toolManager: mockToolManager,
      maxSteps: 500,
      maxRetries: 5,
      debug: true,
      enableCompaction: true,
      compactionThreshold: 50000,
      compactionKeepMessages: 20,
      summaryLanguage: 'Chinese',
      systemPrompt: 'You are helpful.',
    };

    const merged = mergeAgentConfig(config);

    expect(merged.maxSteps).toBe(500);
    expect(merged.maxRetries).toBe(5);
    expect(merged.debug).toBe(true);
    expect(merged.enableCompaction).toBe(true);
    expect(merged.compactionThreshold).toBe(50000);
    expect(merged.compactionKeepMessages).toBe(20);
    expect(merged.summaryLanguage).toBe('Chinese');
    expect(merged.systemPrompt).toBe('You are helpful.');
  });

  it('should merge backoffConfig with defaults', () => {
    const customBackoff: BackoffConfig = {
      initialDelayMs: 500,
      maxDelayMs: 30000,
      base: 3,
      jitter: false,
    };

    const config: AgentConfig = {
      provider: mockProvider,
      toolManager: mockToolManager,
      backoffConfig: customBackoff,
    };

    const merged = mergeAgentConfig(config);

    expect(merged.backoffConfig.initialDelayMs).toBe(500);
    expect(merged.backoffConfig.maxDelayMs).toBe(30000);
    expect(merged.backoffConfig.base).toBe(3);
    expect(merged.backoffConfig.jitter).toBe(false);
  });

  it('should partial merge backoffConfig', () => {
    const config: AgentConfig = {
      provider: mockProvider,
      toolManager: mockToolManager,
      backoffConfig: {
        initialDelayMs: 2000,
      },
    };

    const merged = mergeAgentConfig(config);

    expect(merged.backoffConfig.initialDelayMs).toBe(2000);
    expect(merged.backoffConfig.maxDelayMs).toBe(60000); // default
    expect(merged.backoffConfig.base).toBe(2); // default
    expect(merged.backoffConfig.jitter).toBe(true); // default
  });

  it('should handle generateOptions', () => {
    const config: AgentConfig = {
      provider: mockProvider,
      toolManager: mockToolManager,
      generateOptions: {
        max_tokens: 4096,
        temperature: 0.7,
      },
    };

    const merged = mergeAgentConfig(config);

    expect(merged.generateOptions).toEqual({
      max_tokens: 4096,
      temperature: 0.7,
    });
  });

  it('should use empty object for generateOptions when not provided', () => {
    const config: AgentConfig = {
      provider: mockProvider,
      toolManager: mockToolManager,
    };

    const merged = mergeAgentConfig(config);

    expect(merged.generateOptions).toEqual({});
  });

  it('should preserve optional fields', () => {
    const mockMemoryManager = {
      getContextMessages: vi.fn(),
      addMessages: vi.fn(),
    };

    const config: AgentConfig = {
      provider: mockProvider,
      toolManager: mockToolManager,
      sessionId: 'test-session-123',
      memoryManager: mockMemoryManager as unknown as import('../../storage').MemoryManager,
      logger: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
      } as unknown as import('../../logger').Logger,
      plugins: [],
      completionDetector: vi.fn(),
    };

    const merged = mergeAgentConfig(config);

    expect(merged.sessionId).toBe('test-session-123');
    expect(merged.memoryManager).toBe(mockMemoryManager);
    expect(merged.logger).toBeDefined();
    expect(merged.plugins).toEqual([]);
    expect(merged.completionDetector).toBeDefined();
  });
});

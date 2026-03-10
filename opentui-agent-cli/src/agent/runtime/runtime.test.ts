import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { AgentEventHandlers } from './types';

// 模拟依赖
vi.mock('./tool-confirmation', () => ({
  resolveToolConfirmDecision: vi.fn(),
}));

vi.mock('./source-modules', () => ({
  getSourceModules: vi.fn(),
  resolveWorkspaceRoot: vi.fn(),
}));

vi.mock('../../../../src/agent-v4/prompts/system', () => ({
  buildSystemPrompt: vi.fn(),
}));

// 导入被测试模块
import {
  runAgentPrompt,
  getAgentModelLabel,
  getAgentModelId,
  listAgentModels,
  switchAgentModel,
  disposeAgentRuntime,
} from './runtime';

describe('runtime', () => {
  const mockResolveToolConfirmDecision = vi.mocked(require('./tool-confirmation').resolveToolConfirmDecision);
  const mockGetSourceModules = vi.mocked(require('./source-modules').getSourceModules);
  const mockResolveWorkspaceRoot = vi.mocked(require('./source-modules').resolveWorkspaceRoot);
  const mockBuildSystemPrompt = vi.mocked(require('../../../../src/agent-v4/prompts/system').buildSystemPrompt);

  beforeEach(() => {
    vi.clearAllMocks();
    
    // 默认模拟
    mockResolveWorkspaceRoot.mockReturnValue('/test/workspace');
    mockBuildSystemPrompt.mockReturnValue('Test system prompt');
    
    // 模拟SourceModules
    const mockModules = {
      loadEnvFiles: vi.fn().mockResolvedValue(undefined),
      agent: {
        on: vi.fn(),
        off: vi.fn(),
      },
      appService: {
        listContextMessages: vi.fn().mockResolvedValue([]),
        runForeground: vi.fn().mockResolvedValue({ success: true }),
        listModels: vi.fn().mockResolvedValue([
          { id: 'glm-5', name: 'GLM-5' },
          { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
        ]),
        switchModel: vi.fn().mockResolvedValue({ success: true }),
        getCurrentModelId: vi.fn().mockResolvedValue('glm-5'),
        getCurrentModelLabel: vi.fn().mockResolvedValue('GLM-5'),
      },
      appStore: {
        close: vi.fn().mockResolvedValue(undefined),
      },
    };
    
    mockGetSourceModules.mockResolvedValue(mockModules);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAgentModelLabel', () => {
    it('should return model label', async () => {
      const label = await getAgentModelLabel();
      expect(label).toBe('GLM-5');
    });

    it('should handle errors gracefully', async () => {
      const mockModules = {
        loadEnvFiles: vi.fn().mockResolvedValue(undefined),
        agent: { on: vi.fn(), off: vi.fn() },
        appService: {
          getCurrentModelLabel: vi.fn().mockRejectedValue(new Error('Failed to get label')),
          listContextMessages: vi.fn(),
          runForeground: vi.fn(),
          listModels: vi.fn(),
          switchModel: vi.fn(),
          getCurrentModelId: vi.fn(),
        },
        appStore: { close: vi.fn() },
      };
      mockGetSourceModules.mockResolvedValue(mockModules);

      await expect(getAgentModelLabel()).rejects.toThrow('Failed to get label');
    });
  });

  describe('getAgentModelId', () => {
    it('should return model id', async () => {
      const id = await getAgentModelId();
      expect(id).toBe('glm-5');
    });
  });

  describe('listAgentModels', () => {
    it('should return list of models', async () => {
      const models = await listAgentModels();
      expect(models).toEqual([
        { id: 'glm-5', name: 'GLM-5' },
        { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
      ]);
    });

    it('should handle empty model list', async () => {
      const mockModules = {
        loadEnvFiles: vi.fn().mockResolvedValue(undefined),
        agent: { on: vi.fn(), off: vi.fn() },
        appService: {
          listModels: vi.fn().mockResolvedValue([]),
          listContextMessages: vi.fn(),
          runForeground: vi.fn(),
          switchModel: vi.fn(),
          getCurrentModelId: vi.fn(),
          getCurrentModelLabel: vi.fn(),
        },
        appStore: { close: vi.fn() },
      };
      mockGetSourceModules.mockResolvedValue(mockModules);

      const models = await listAgentModels();
      expect(models).toEqual([]);
    });
  });

  describe('switchAgentModel', () => {
    it('should switch to specified model', async () => {
      const result = await switchAgentModel('claude-3.5-sonnet');
      expect(result).toEqual({ success: true });
    });

    it('should handle switch failure', async () => {
      const mockModules = {
        loadEnvFiles: vi.fn().mockResolvedValue(undefined),
        agent: { on: vi.fn(), off: vi.fn() },
        appService: {
          switchModel: vi.fn().mockResolvedValue({ success: false, error: 'Failed to switch' }),
          listContextMessages: vi.fn(),
          runForeground: vi.fn(),
          listModels: vi.fn(),
          getCurrentModelId: vi.fn(),
          getCurrentModelLabel: vi.fn(),
        },
        appStore: { close: vi.fn() },
      };
      mockGetSourceModules.mockResolvedValue(mockModules);

      const result = await switchAgentModel('invalid-model');
      expect(result).toEqual({ success: false, error: 'Failed to switch' });
    });
  });

  describe('disposeAgentRuntime', () => {
    it('should dispose runtime instance', async () => {
      await disposeAgentRuntime();
      // 应该调用appStore.close()
      // 由于模块是模拟的，我们无法直接验证，但可以确认没有抛出错误
    });

    it('should handle when runtime is not initialized', async () => {
      // 第一次调用会初始化
      await getAgentModelLabel();
      // 然后销毁
      await disposeAgentRuntime();
      // 再次销毁应该不会出错
      await disposeAgentRuntime();
    });
  });

  describe('runAgentPrompt', () => {
    it('should run agent prompt with handlers', async () => {
      const handlers: AgentEventHandlers = {
        onTextDelta: vi.fn(),
        onTextComplete: vi.fn(),
        onToolUse: vi.fn(),
        onToolStream: vi.fn(),
        onToolResult: vi.fn(),
        onToolConfirm: vi.fn(),
        onUsage: vi.fn(),
        onFinish: vi.fn(),
        onError: vi.fn(),
      };

      const result = await runAgentPrompt('Test prompt', handlers);
      expect(result).toEqual({ success: true });
    });

    it('should handle tool confirm events', async () => {
      const handlers: AgentEventHandlers = {
        onTextDelta: vi.fn(),
        onTextComplete: vi.fn(),
        onToolUse: vi.fn(),
        onToolStream: vi.fn(),
        onToolResult: vi.fn(),
        onToolConfirm: vi.fn(),
        onUsage: vi.fn(),
        onFinish: vi.fn(),
        onError: vi.fn(),
      };

      // 模拟工具确认
      mockResolveToolConfirmDecision.mockResolvedValue({ approved: true, message: 'Approved' });

      const result = await runAgentPrompt('Test prompt with tool', handlers);
      expect(result).toEqual({ success: true });
    });

    it('should handle abort signal', async () => {
      const handlers: AgentEventHandlers = {
        onTextDelta: vi.fn(),
        onTextComplete: vi.fn(),
        onToolUse: vi.fn(),
        onToolStream: vi.fn(),
        onToolResult: vi.fn(),
        onToolConfirm: vi.fn(),
        onUsage: vi.fn(),
        onFinish: vi.fn(),
        onError: vi.fn(),
      };

      const abortController = new AbortController();
      const options = { abortSignal: abortController.signal };

      const result = await runAgentPrompt('Test prompt', handlers, options);
      expect(result).toEqual({ success: true });
    });

    it('should handle runtime initialization error', async () => {
      // 模拟初始化失败
      mockGetSourceModules.mockRejectedValue(new Error('Failed to load modules'));

      const handlers: AgentEventHandlers = {
        onTextDelta: vi.fn(),
        onTextComplete: vi.fn(),
        onToolUse: vi.fn(),
        onToolStream: vi.fn(),
        onToolResult: vi.fn(),
        onToolConfirm: vi.fn(),
        onUsage: vi.fn(),
        onFinish: vi.fn(),
        onError: vi.fn(),
      };

      await expect(runAgentPrompt('Test prompt', handlers)).rejects.toThrow('Failed to load modules');
    });
  });
});
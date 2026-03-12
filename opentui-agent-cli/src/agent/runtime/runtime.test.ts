import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./tool-confirmation', () => ({
  resolveToolConfirmDecision: vi.fn().mockResolvedValue({ approved: true, message: 'Approved' }),
}));

vi.mock('./source-modules', () => ({
  getSourceModules: vi.fn(),
  resolveWorkspaceRoot: vi.fn(),
}));

vi.mock('../../../../src/agent-v4/prompts/system', () => ({
  buildSystemPrompt: vi.fn(() => 'Test system prompt'),
}));

import {
  disposeAgentRuntime,
  getAgentModelId,
  getAgentModelLabel,
  listAgentModels,
  runAgentPrompt,
  switchAgentModel,
} from './runtime';
import * as sourceModules from './source-modules';
import type { AgentEventHandlers } from './types';

const buildMockModules = () => {
  class FakeToolManager {
    registerTool = vi.fn();
    getTools = vi.fn(() => []);
  }

  class FakeTool {
    toToolSchema() {
      return {
        type: 'function',
        function: {
          name: 'fake_tool',
        },
      };
    }
  }

  class FakeAgent {
    on = vi.fn();
    off = vi.fn();
  }

  class FakeAppService {
    async listContextMessages() {
      return [];
    }

    async runForeground() {
      return {
        executionId: 'exec_runtime',
        conversationId: 'conv_runtime',
        messages: [
          {
            messageId: 'msg_assistant',
            role: 'assistant',
            type: 'assistant-text',
            content: 'done',
          },
        ],
        finishReason: 'stop' as const,
        steps: 1,
        run: {},
      };
    }
  }

  return {
    ProviderRegistry: {
      getModelIds: () => ['glm-5', 'claude-3.5-sonnet'],
      getModelConfig: (modelId: string) => ({
        name: modelId === 'glm-5' ? 'GLM-5' : 'Claude 3.5 Sonnet',
        envApiKey: 'TEST_API_KEY',
        provider: modelId === 'glm-5' ? 'zhipu' : 'anthropic',
        model: modelId,
      }),
      createFromEnv: () => ({}),
    },
    loadEnvFiles: vi.fn().mockResolvedValue([]),
    createLoggerFromEnv: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
    createAgentLoggerAdapter: vi.fn((logger: Record<string, unknown>) => ({
      info: typeof logger.info === 'function' ? logger.info.bind(logger) : undefined,
      warn: typeof logger.warn === 'function' ? logger.warn.bind(logger) : undefined,
      error: typeof logger.error === 'function' ? logger.error.bind(logger) : undefined,
    })),
    StatelessAgent: FakeAgent,
    AgentAppService: FakeAppService,
    createSqliteAgentAppStore: () => ({
      close: vi.fn().mockResolvedValue(undefined),
    }),
    DefaultToolManager: FakeToolManager,
    BashTool: FakeTool,
    WriteFileTool: FakeTool,
    FileReadTool: FakeTool,
    FileEditTool: FakeTool,
    GlobTool: FakeTool,
    GrepTool: FakeTool,
    SkillTool: FakeTool,
    TaskTool: FakeTool,
    TaskCreateTool: FakeTool,
    TaskGetTool: FakeTool,
    TaskListTool: FakeTool,
    TaskUpdateTool: FakeTool,
    TaskStopTool: FakeTool,
    TaskOutputTool: FakeTool,
    TaskStore: class {},
    RealSubagentRunnerAdapter: class {},
  };
};

describe('runtime', () => {
  const mockGetSourceModules = sourceModules.getSourceModules as unknown as ReturnType<
    typeof vi.fn
  >;
  const mockResolveWorkspaceRoot = sourceModules.resolveWorkspaceRoot as unknown as ReturnType<
    typeof vi.fn
  >;
  const originalApiKey = process.env.TEST_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TEST_API_KEY = 'test-key';
    mockResolveWorkspaceRoot.mockReturnValue('/test/workspace');
    mockGetSourceModules.mockResolvedValue(buildMockModules());
  });

  afterEach(async () => {
    await disposeAgentRuntime();
    if (originalApiKey === undefined) {
      delete process.env.TEST_API_KEY;
    } else {
      process.env.TEST_API_KEY = originalApiKey;
    }
  });

  it('returns the active model label', async () => {
    await expect(getAgentModelLabel()).resolves.toBe('GLM-5');
  });

  it('returns the active model id', async () => {
    await expect(getAgentModelId()).resolves.toBe('glm-5');
  });

  it('lists models with current selection', async () => {
    await expect(listAgentModels()).resolves.toEqual([
      {
        id: 'claude-3.5-sonnet',
        name: 'Claude 3.5 Sonnet',
        provider: 'anthropic',
        apiKeyEnv: 'TEST_API_KEY',
        configured: true,
        current: false,
      },
      {
        id: 'glm-5',
        name: 'GLM-5',
        provider: 'zhipu',
        apiKeyEnv: 'TEST_API_KEY',
        configured: true,
        current: true,
      },
    ]);
  });

  it('switches model when the target is configured', async () => {
    await expect(switchAgentModel('claude-3.5-sonnet')).resolves.toEqual({
      modelId: 'claude-3.5-sonnet',
      modelLabel: 'Claude 3.5 Sonnet',
    });
  });

  it('runs a prompt and returns the assembled result', async () => {
    const handlers: AgentEventHandlers = {
      onTextDelta: vi.fn(),
      onTextComplete: vi.fn(),
      onToolUse: vi.fn(),
      onToolStream: vi.fn(),
      onToolResult: vi.fn(),
      onToolConfirm: vi.fn(),
      onUsage: vi.fn(),
    };

    await expect(runAgentPrompt('Test prompt', handlers)).resolves.toEqual(
      expect.objectContaining({
        text: 'done',
        completionReason: 'stop',
        modelLabel: 'GLM-5',
      })
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./tool-confirmation', () => ({
  resolveToolConfirmDecision: vi.fn(),
}));

vi.mock('./source-modules', () => ({
  getSourceModules: vi.fn(),
  resolveWorkspaceRoot: vi.fn(),
}));

vi.mock('../../../../src/agent-v4/prompts/system', () => ({
  buildSystemPrompt: vi.fn(() => 'Test system prompt'),
}));

import { disposeAgentRuntime, runAgentPrompt } from './runtime';
import * as sourceModules from './source-modules';
import type { AgentEventHandlers } from './types';

describe('runAgentPrompt usage forwarding', () => {
  const mockGetSourceModules = vi.mocked(sourceModules.getSourceModules);
  const mockResolveWorkspaceRoot = vi.mocked(sourceModules.resolveWorkspaceRoot);
  const originalApiKey = process.env.TEST_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.TEST_API_KEY = 'test-key';
    mockResolveWorkspaceRoot.mockReturnValue('/test/workspace');

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

      async runForeground(
        _request: unknown,
        callbacks?: {
          onUsage?: (usage: {
            sequence: number;
            stepIndex: number;
            messageId: string;
            usage: {
              prompt_tokens: number;
              completion_tokens: number;
              total_tokens: number;
            };
            cumulativeUsage: {
              prompt_tokens: number;
              completion_tokens: number;
              total_tokens: number;
            };
            contextTokens?: number;
            contextLimitTokens?: number;
            contextUsagePercent?: number;
          }) => void | Promise<void>;
        }
      ) {
        await callbacks?.onUsage?.({
          sequence: 1,
          stepIndex: 1,
          messageId: 'msg_usage',
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
          cumulativeUsage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
          contextTokens: 123,
          contextLimitTokens: 1000,
          contextUsagePercent: 12.3,
        });

        return {
          executionId: 'exec_usage',
          conversationId: 'conv_usage',
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

    mockGetSourceModules.mockResolvedValue({
      ProviderRegistry: {
        getModelIds: () => ['test-model'],
        getModelConfig: () => ({
          name: 'Test Model',
          envApiKey: 'TEST_API_KEY',
          model: 'test-model',
        }),
        createFromEnv: () => ({}),
      },
      loadEnvFiles: vi.fn().mockResolvedValue([]),
      StatelessAgent: FakeAgent,
      AgentAppService: FakeAppService,
      createSqliteAgentAppStore: () => ({
        prepare: vi.fn().mockResolvedValue(undefined),
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
    } as unknown as Awaited<ReturnType<typeof sourceModules.getSourceModules>>);
  });

  afterEach(async () => {
    await disposeAgentRuntime();
    if (originalApiKey === undefined) {
      delete process.env.TEST_API_KEY;
    } else {
      process.env.TEST_API_KEY = originalApiKey;
    }
  });

  it('forwards usage events to TUI handlers and returns final usage', async () => {
    const onUsage = vi.fn();
    const handlers = {
      onUsage,
    } as AgentEventHandlers;

    const result = await runAgentPrompt('show usage', handlers);

    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        cumulativePromptTokens: 10,
        cumulativeCompletionTokens: 5,
        cumulativeTotalTokens: 15,
      })
    );
    expect(result.usage).toEqual(
      expect.objectContaining({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      })
    );
  });
});

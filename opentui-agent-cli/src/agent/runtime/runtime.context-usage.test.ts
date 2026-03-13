import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./tool-confirmation', () => ({
  resolveToolConfirmDecision: vi.fn(),
}));

vi.mock('./source-modules', () => ({
  getSourceModules: vi.fn(),
  resolveWorkspaceRoot: vi.fn(),
}));

vi.mock('../../../../src/agent/prompts/system', () => ({
  buildSystemPrompt: vi.fn(() => 'Test system prompt'),
}));

import { disposeAgentRuntime, runAgentPrompt } from './runtime';
import * as sourceModules from './source-modules';
import type { AgentContextUsageEvent, AgentEventHandlers } from './types';

describe('runAgentPrompt context usage forwarding', () => {
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
          onContextUsage?: (usage: {
            stepIndex: number;
            messageCount: number;
            contextTokens: number;
            contextLimitTokens: number;
            contextUsagePercent: number;
          }) => void | Promise<void>;
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
        await callbacks?.onContextUsage?.({
          stepIndex: 1,
          messageCount: 1,
          contextTokens: 123,
          contextLimitTokens: 1000,
          contextUsagePercent: 12.3,
        });

        return {
          executionId: 'exec_ctx',
          conversationId: 'conv_ctx',
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
    loadConfigToEnv: vi.fn().mockReturnValue([]),
      createLoggerFromEnv: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
      createAgentLoggerAdapter: vi.fn((logger: Record<string, unknown>) => ({
        info: typeof logger.info === 'function' ? logger.info.bind(logger) : undefined,
        warn: typeof logger.warn === 'function' ? logger.warn.bind(logger) : undefined,
        error: typeof logger.error === 'function' ? logger.error.bind(logger) : undefined,
      })),
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
      FileHistoryListTool: FakeTool,
      FileHistoryRestoreTool: FakeTool,
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

  it('forwards realtime context usage to TUI handlers before final usage', async () => {
    const onContextUsage = vi.fn();
    const onUsage = vi.fn();
    const handlers = {
      onContextUsage,
      onUsage,
    } as AgentEventHandlers & {
      onContextUsage: (event: AgentContextUsageEvent) => void;
    };

    await runAgentPrompt('show context', handlers);

    expect(onContextUsage).toHaveBeenCalledTimes(1);
    expect(onContextUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        contextTokens: 123,
        contextLimit: 1000,
        contextUsagePercent: 12.3,
      })
    );
    expect(onUsage).not.toHaveBeenCalled();
  });
});

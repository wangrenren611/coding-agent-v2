import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./tool-confirmation', () => ({
  resolveToolConfirmDecision: vi.fn(),
}));

vi.mock('./source-modules', () => ({
  getSourceModules: vi.fn(),
  resolveWorkspaceRoot: vi.fn(),
}));

import { disposeAgentRuntime, runAgentPrompt } from './runtime';
import * as sourceModules from './source-modules';

describe('runAgentPrompt error handling', () => {
  const mockGetSourceModules = sourceModules.getSourceModules as ReturnType<typeof vi.fn>;
  const mockResolveWorkspaceRoot = sourceModules.resolveWorkspaceRoot as ReturnType<typeof vi.fn>;
  const originalApiKey = process.env.TEST_API_KEY;
  const createLoggerFromEnv = vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    close: vi.fn(),
  }));
  let buildModules: (
    AppServiceClass: new () => {
      listContextMessages: () => Promise<unknown[]>;
      runForeground: (...args: any[]) => Promise<unknown>;
    }
  ) => Awaited<ReturnType<typeof sourceModules.getSourceModules>>;

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
          onError?: (error: Error) => void | Promise<void>;
        }
      ) {
        await callbacks?.onError?.(new Error('502 Bad Gateway: Upstream request failed'));

        return {
          executionId: 'exec_error',
          conversationId: 'conv_error',
          messages: [],
          finishReason: 'error' as const,
          steps: 1,
          run: {},
        };
      }
    }

    buildModules = AppServiceClass =>
      ({
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
        buildSystemPrompt: vi.fn(() => 'Test system prompt'),
        resolveRenxDatabasePath: vi.fn(() => '/tmp/renx/data.db'),
        resolveRenxTaskDir: vi.fn(() => '/tmp/renx/task'),
        createLoggerFromEnv,
        createAgentLoggerAdapter: vi.fn(() => ({
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        })),
        StatelessAgent: FakeAgent,
        AgentAppService: AppServiceClass,
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
      }) as unknown as Awaited<ReturnType<typeof sourceModules.getSourceModules>>;

    mockGetSourceModules.mockResolvedValue(buildModules(FakeAppService));
  });

  afterEach(async () => {
    await disposeAgentRuntime();
    if (originalApiKey === undefined) {
      delete process.env.TEST_API_KEY;
    } else {
      process.env.TEST_API_KEY = originalApiKey;
    }
  });

  it('disables console logging for the TUI runtime', async () => {
    await runAgentPrompt('hello', {});

    expect(createLoggerFromEnv).toHaveBeenCalledWith(
      expect.objectContaining({
        AGENT_LOG_CONSOLE: 'false',
      }),
      '/test/workspace'
    );
  });

  it('uses onError messages as the completion message when the run fails', async () => {
    const result = await runAgentPrompt('hello', {});

    expect(result.completionReason).toBe('error');
    expect(result.completionMessage).toBe('502 Bad Gateway: Upstream request failed');
  });

  it('does not emit a terminal error stop for a retryable stream error that later succeeds', async () => {
    class FakeAppServiceWithRetryableError {
      async listContextMessages() {
        return [];
      }

      async runForeground(
        _request: unknown,
        callbacks?: {
          onError?: (error: Error) => void | Promise<void>;
          onEvent?: (event: { eventType: string; data: Record<string, unknown> }) => Promise<void>;
        }
      ) {
        await callbacks?.onError?.(new Error('Network connection lost. (chunk: gen-retryable)'));
        await callbacks?.onEvent?.({
          eventType: 'error',
          data: {
            message: 'Network connection lost. (chunk: gen-retryable)',
          },
        });
        await callbacks?.onEvent?.({
          eventType: 'chunk',
          data: {
            content: 'recovered response',
          },
        });
        await callbacks?.onEvent?.({
          eventType: 'done',
          data: {
            finishReason: 'stop',
          },
        });

        return {
          executionId: 'exec_retry_success',
          conversationId: 'conv_retry_success',
          messages: [],
          finishReason: 'stop' as const,
          steps: 2,
          run: {},
        };
      }
    }

    mockGetSourceModules.mockResolvedValue(buildModules(FakeAppServiceWithRetryableError));

    const handlers = {
      onStop: vi.fn(),
      onTextComplete: vi.fn(),
    };

    const result = await runAgentPrompt('hello', handlers);

    expect(handlers.onStop).toHaveBeenCalledTimes(1);
    expect(handlers.onStop).toHaveBeenCalledWith({ reason: 'stop' });
    expect(handlers.onTextComplete).toHaveBeenCalledWith('recovered response');
    expect(result.completionReason).toBe('stop');
    expect(result.completionMessage).toBeUndefined();
    expect(result.text).toBe('recovered response');
  });

  it('emits a terminal error stop after the run settles with finishReason=error', async () => {
    const handlers = {
      onStop: vi.fn(),
    };

    await runAgentPrompt('hello', handlers);

    expect(handlers.onStop).toHaveBeenCalledTimes(1);
    expect(handlers.onStop).toHaveBeenCalledWith({
      reason: 'error',
      message: undefined,
    });
  });
});

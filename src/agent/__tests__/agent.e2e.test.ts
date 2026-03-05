import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { z } from 'zod';
import { Agent } from '../agent';
import type { LLMGenerateOptions, LLMProvider, LLMRequestMessage, Chunk } from '../../providers';
import { BaseTool, ToolManager } from '../../tool';
import type { ToolExecutionContext, ToolResult } from '../../core/types';
import { MemoryManager, createFileStorageBundle } from '../../storage';
import { createLogger, LogLevel, type Logger } from '../../logger';

/**
 * 场景数据参考：
 * /Users/wrr/work/coding-agent-data/agent-memory/contexts/agent-1111.json
 */
const REFERENCE_SYSTEM_PROMPT =
  'You are QPSCode, an interactive CLI coding agent focused on software engineering tasks.';
const INITIAL_TASK_TEXT =
  '初始化项目 /Users/wrr/work/coding-agent-v2: nodejs+ts+vitest+prettier+eslint+husky+cross-env';

interface ProviderCallSnapshot {
  messages: LLMRequestMessage[];
  options?: LLMGenerateOptions;
}

function cloneMessages(messages: LLMRequestMessage[]): LLMRequestMessage[] {
  return JSON.parse(JSON.stringify(messages)) as LLMRequestMessage[];
}

const readProjectBriefSchema = z.object({
  projectPath: z.string(),
});

class ReadProjectBriefTool extends BaseTool<typeof readProjectBriefSchema> {
  constructor(
    private readonly invocations: Array<{
      projectPath: string;
      loopIndex: number;
      stepIndex: number;
    }>
  ) {
    super();
  }

  get meta() {
    return {
      name: 'read_project_brief',
      description: '读取项目目录并返回初始化建议',
      parameters: readProjectBriefSchema,
    };
  }

  async execute(
    args: z.infer<typeof readProjectBriefSchema>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    this.invocations.push({
      projectPath: args.projectPath,
      loopIndex: context.loopIndex,
      stepIndex: context.stepIndex,
    });

    return {
      success: true,
      data: {
        projectPath: args.projectPath,
        files: ['package.json', 'tsconfig.json', 'vitest.config.ts', '.eslintrc.cjs'],
        summary: '目标目录为空仓库，建议先写配置文件并安装依赖',
      },
    };
  }
}

function createFirstRunProvider(calls: ProviderCallSnapshot[]): LLMProvider {
  let streamCallIndex = 0;

  return {
    config: { model: 'mock-model' },
    async generate(): Promise<never> {
      throw new Error('Not used in this test');
    },
    async *generateStream(
      messages: LLMRequestMessage[],
      options?: LLMGenerateOptions
    ): AsyncGenerator<Chunk> {
      calls.push({ messages: cloneMessages(messages), options });

      if (streamCallIndex === 0) {
        streamCallIndex++;
        yield {
          index: 0,
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content: '我会先读取项目状态，然后给出初始化方案。',
                tool_calls: [
                  {
                    id: 'call_read_project_brief_1',
                    type: 'function',
                    index: 0,
                    function: {
                      name: 'read_project_brief',
                      arguments: '{"projectPath":"',
                    },
                  },
                ],
              },
            },
          ],
        };

        yield {
          index: 1,
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: 'call_read_project_brief_1',
                    type: 'function',
                    index: 0,
                    function: {
                      name: '',
                      arguments: '/Users/wrr/work/coding-agent-v2"}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: {
            prompt_tokens: 120,
            completion_tokens: 64,
            total_tokens: 184,
          },
        };
        return;
      }

      if (streamCallIndex === 1) {
        streamCallIndex++;
        yield {
          index: 0,
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                content: '已完成初始化规划：先安装依赖，再执行 pnpm ci:check 验证。',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 88,
            completion_tokens: 32,
            total_tokens: 120,
          },
        };
        return;
      }

      throw new Error(`Unexpected generateStream call index: ${streamCallIndex}`);
    },
    getTimeTimeout: () => 60_000,
    getLLMMaxTokens: () => 128_000,
    getMaxOutputTokens: () => 8_000,
  } as unknown as LLMProvider;
}

function createFollowupProvider(calls: ProviderCallSnapshot[]): LLMProvider {
  return {
    config: { model: 'mock-model' },
    async generate(): Promise<never> {
      throw new Error('Not used in this test');
    },
    async *generateStream(
      messages: LLMRequestMessage[],
      options?: LLMGenerateOptions
    ): AsyncGenerator<Chunk> {
      calls.push({ messages: cloneMessages(messages), options });
      yield {
        index: 0,
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              content: '下一步执行清单：1) pnpm install 2) pnpm ci:check 3) git add/commit。',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 96,
          completion_tokens: 30,
          total_tokens: 126,
        },
      };
    },
    getTimeTimeout: () => 60_000,
    getLLMMaxTokens: () => 128_000,
    getMaxOutputTokens: () => 8_000,
  } as unknown as LLMProvider;
}

describe('Agent end-to-end task scenario', () => {
  let tempDir: string;
  let memoryManager: MemoryManager;
  let logger: Logger;
  let logFilePath: string;

  const fixedDir = process.env.AGENT_E2E_DATA_DIR;
  const keepArtifacts = process.env.AGENT_E2E_KEEP_DATA === '1' || Boolean(fixedDir);

  beforeEach(async () => {
    if (fixedDir) {
      tempDir = path.resolve(fixedDir);
      await fs.mkdir(tempDir, { recursive: true });
    } else {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-e2e-test-'));
    }

    logFilePath = path.join(tempDir, 'logs', 'agent.e2e.log');
    logger = createLogger({
      level: LogLevel.DEBUG,
      console: { enabled: false },
      file: {
        enabled: true,
        filepath: logFilePath,
        format: 'pretty',
      },
    });

    memoryManager = new MemoryManager(createFileStorageBundle(tempDir));
  });

  afterEach(async () => {
    await memoryManager.close();
    logger.close();

    if (!keepArtifacts) {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('should complete a realistic multi-step task with tool execution and memory restore', async () => {
    const toolInvocations: Array<{ projectPath: string; loopIndex: number; stepIndex: number }> =
      [];
    const toolManager = new ToolManager();
    toolManager.register(new ReadProjectBriefTool(toolInvocations));

    const firstRunCalls: ProviderCallSnapshot[] = [];
    const firstAgent = new Agent({
      provider: createFirstRunProvider(firstRunCalls),
      toolManager,
      memoryManager,
      logger,
      sessionId: 'agent-1111',
      systemPrompt: REFERENCE_SYSTEM_PROMPT,
      maxSteps: 6,
    });

    const firstResult = await firstAgent.run({
      role: 'user',
      content: [{ type: 'text', text: INITIAL_TASK_TEXT }],
    });

    expect(firstResult.completionReason).toBe('stop');
    expect(firstResult.steps).toHaveLength(2);
    expect(firstResult.steps[0].finishReason).toBe('tool_calls');
    expect(firstResult.steps[0].toolCalls).toHaveLength(1);
    expect(firstResult.steps[0].toolCalls[0].function.name).toBe('read_project_brief');
    expect(firstResult.steps[0].toolResults).toHaveLength(1);
    expect(firstResult.steps[0].toolResults[0].result.success).toBe(true);
    expect(firstResult.text).toContain('pnpm ci:check');

    expect(toolInvocations).toHaveLength(1);
    expect(toolInvocations[0].projectPath).toBe('/Users/wrr/work/coding-agent-v2');

    expect(firstRunCalls).toHaveLength(2);
    expect(firstRunCalls[0].messages[0].role).toBe('system');
    expect(firstRunCalls[0].messages[1].role).toBe('user');
    expect(firstRunCalls[0].options?.tools).toBeDefined();
    expect(firstRunCalls[0].options?.tools?.[0]?.function.name).toBe('read_project_brief');
    expect(firstRunCalls[1].messages.some((m) => m.role === 'tool')).toBe(true);

    const historyAfterFirstRun = memoryManager.getHistory({ sessionId: 'agent-1111' });
    expect(historyAfterFirstRun.some((m) => m.role === 'tool')).toBe(true);
    expect(
      historyAfterFirstRun.some(
        (m) =>
          m.role === 'assistant' &&
          typeof m.content === 'string' &&
          m.content.includes('pnpm ci:check')
      )
    ).toBe(true);

    const followupCalls: ProviderCallSnapshot[] = [];
    const followupAgent = new Agent({
      provider: createFollowupProvider(followupCalls),
      toolManager,
      memoryManager,
      logger,
      sessionId: 'agent-1111',
      systemPrompt: REFERENCE_SYSTEM_PROMPT,
    });

    const followupResult = await followupAgent.run('继续并生成下一步执行清单');

    expect(followupResult.completionReason).toBe('stop');
    expect(followupResult.text).toContain('下一步执行清单');
    expect(followupCalls).toHaveLength(1);
    expect(followupCalls[0].messages.some((m) => m.role === 'tool')).toBe(true);
    expect(followupCalls[0].messages[followupCalls[0].messages.length - 1].role).toBe('user');

    const historyAfterFollowup = memoryManager.getHistory({ sessionId: 'agent-1111' });
    expect(historyAfterFollowup.length).toBeGreaterThan(historyAfterFirstRun.length);
    expect(
      historyAfterFollowup.some(
        (m) =>
          m.role === 'assistant' &&
          typeof m.content === 'string' &&
          m.content.includes('下一步执行清单')
      )
    ).toBe(true);

    const contextFilePath = path.join(tempDir, 'contexts', 'agent-1111.json');
    const historyFilePath = path.join(tempDir, 'histories', 'agent-1111.json');
    const sessionFilePath = path.join(tempDir, 'sessions', 'agent-1111.json');
    await Promise.all([
      expect(fs.access(contextFilePath)).resolves.toBeUndefined(),
      expect(fs.access(historyFilePath)).resolves.toBeUndefined(),
      expect(fs.access(sessionFilePath)).resolves.toBeUndefined(),
      expect(fs.access(logFilePath)).resolves.toBeUndefined(),
    ]);

    const contextRaw = await fs.readFile(contextFilePath, 'utf8');
    const contextJson = JSON.parse(contextRaw) as { sessionId: string; messages: unknown[] };
    expect(contextJson.sessionId).toBe('agent-1111');
    expect(contextJson.messages.length).toBeGreaterThan(0);

    const logRaw = await fs.readFile(logFilePath, 'utf8');
    expect(logRaw.includes('[Agent] Starting run')).toBe(true);
    expect(logRaw.includes('[Agent] Run completed')).toBe(true);
  });
});

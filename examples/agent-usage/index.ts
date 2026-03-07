import {
  Agent,
  ProviderRegistry,
  createLoggerFromEnv,
  createMemoryManagerFromEnv,
  loadEnvFiles,
  loadRuntimeConfigFromEnv,
  type ModelId,
  type Plugin,
  type ToolStreamEvent,
} from '../../src/index.ts';
import { createInterface } from 'node:readline/promises';
import {
  BashTool,
  FileEditTool,
  FileReadTool,
  FileStatTool,
  FileWriteTool,
  GlobTool,
  GrepTool,
  SkillTool,
  ToolManager,
  type ToolConfirmDecision,
  type ToolConfirmRequest,
} from '../../src/tool/index.ts';
import { buildSystemPrompt } from '../../src/prompts/system.ts';

const DEFAULT_MODEL: ModelId = 'glm-5';
const DEFAULT_PROMPT = '请分析当前仓库结构并给出 3 条可执行的改进建议。';
const EXAMPLE_DEFAULT_LOG_DIR = './examples/agent-usage/logs';
const EXAMPLE_DEFAULT_LOG_FILE = 'agent-example.log';
const EXAMPLE_DEFAULT_MAX_STEPS = 10000;

function applyExampleDefaultEnv(): void {
  // 示例默认开启文件日志；若用户已设置则尊重用户配置
  if (process.env.AGENT_LOG_FILE_ENABLED === undefined) {
    process.env.AGENT_LOG_FILE_ENABLED = 'true';
  }
  if (process.env.AGENT_LOG_DIR === undefined) {
    process.env.AGENT_LOG_DIR = EXAMPLE_DEFAULT_LOG_DIR;
  }
  if (process.env.AGENT_LOG_FILE === undefined) {
    process.env.AGENT_LOG_FILE = EXAMPLE_DEFAULT_LOG_FILE;
  }
}

function printUsage(): void {
  console.log(`
Agent usage example

Usage:
  pnpm example:agent [modelId] [prompt] [followUpPrompt]

Examples:
  pnpm example:agent
  pnpm example:agent glm-4.7 "帮我设计一个模块目录结构"
  pnpm example:agent glm-4.7 "初始化项目步骤" "请继续并给出风险清单"

This example registers built-in file/shell tools:
  file_read / file_write / file_edit / file_stat

Env:
  AGENT_AUTO_CONFIRM_TOOLS=true   # 自动同意所有待确认工具调用
  AGENT_AUTO_CONFIRM_TOOLS=false  # 自动拒绝所有待确认工具调用
`);
}

function resolveModelId(input?: string): ModelId {
  if (!input) return DEFAULT_MODEL;

  const modelIds = ProviderRegistry.getModelIds();
  if (!modelIds.includes(input as ModelId)) {
    throw new Error(
      `Unsupported modelId: "${input}". Run providers example to list available ids.`
    );
  }
  return input as ModelId;
}

function requireEnvApiKey(modelId: ModelId): void {
  const modelConfig = ProviderRegistry.getModelConfig(modelId);
  const apiKey = process.env[modelConfig.envApiKey];
  if (!apiKey) {
    throw new Error(`Missing env ${modelConfig.envApiKey} for model "${modelId}".`);
  }
}

function printResult(title: string, text: string): void {
  console.log(`\n=== ${title} ===`);
  console.log(text || '(empty)');
}

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || raw.trim().length === 0) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid ${name}="${raw}", expected a positive integer.`);
  }
  return value;
}

function createConsoleStreamPlugin(): Plugin {
  let currentChannel: 'assistant' | 'reasoning' | 'tool' | null = null;

  const switchChannel = (next: 'assistant' | 'reasoning' | 'tool', title: string): void => {
    if (currentChannel === next) return;
    process.stdout.write(`\n=== ${title} ===\n`);
    currentChannel = next;
  };

  const printToolEvent = (event: ToolStreamEvent): void => {
    switchChannel('tool', 'Tool Stream');
    const prefix = `[tool:${event.toolName}:${event.toolCallId}:${event.type}#${event.sequence}]`;
    if (event.type === 'stdout' || event.type === 'stderr') {
      process.stdout.write(`${prefix} ${event.content ?? ''}`);
      if (!event.content?.endsWith('\n')) {
        process.stdout.write('\n');
      }
      return;
    }

    if (event.content) {
      process.stdout.write(`${prefix} ${event.content}\n`);
      return;
    }

    if (event.data !== undefined) {
      process.stdout.write(`${prefix} ${JSON.stringify(event.data)}\n`);
      return;
    }

    process.stdout.write(`${prefix}\n`);
  };

  return {
    name: 'example-console-stream',
    textDelta: ({ text, isReasoning }) => {
      if (!text) return;
      if (isReasoning) {
        switchChannel('reasoning', 'Reasoning Stream');
      } else {
        switchChannel('assistant', 'Assistant Stream');
      }
      process.stdout.write(text);
    },
    toolStream: (event) => {
      printToolEvent(event);
    },
    toolConfirm: (request) => {
      switchChannel('tool', 'Tool Stream');
      process.stdout.write(
        `[tool-confirm:${request.toolName}:${request.toolCallId}] reason=${request.reason ?? 'n/a'} args=${JSON.stringify(request.args)}\n`
      );
    },
    step: ({ stepIndex, finishReason, toolCallsCount }) => {
      process.stdout.write(
        `\n[step] index=${stepIndex} finishReason=${finishReason ?? 'unknown'} toolCalls=${toolCallsCount}\n`
      );
    },
    stop: ({ reason, message }) => {
      process.stdout.write(`\n[stop] reason=${reason}${message ? ` message=${message}` : ''}\n`);
    },
  };
}

function parseAutoConfirmDecision(): ToolConfirmDecision | undefined {
  const raw = process.env.AGENT_AUTO_CONFIRM_TOOLS?.trim().toLowerCase();
  if (!raw) {
    return undefined;
  }
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'y') {
    return 'approve';
  }
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'n') {
    return 'deny';
  }
  return undefined;
}

async function confirmToolExecution(request: ToolConfirmRequest): Promise<ToolConfirmDecision> {
  const autoDecision = parseAutoConfirmDecision();
  if (autoDecision) {
    console.log(
      `[tool-confirm] auto decision=${autoDecision} tool=${request.toolName} id=${request.toolCallId}`
    );
    return autoDecision;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log(
      `[tool-confirm] no TTY available, default deny tool=${request.toolName} id=${request.toolCallId}`
    );
    return 'deny';
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const question =
      `\n确认执行工具 "${request.toolName}" (callId=${request.toolCallId})? [y/N]\n` +
      `reason=${request.reason ?? 'n/a'}\n` +
      `args=${JSON.stringify(request.args)}\n> `;
    const answer = (await rl.question(question)).trim().toLowerCase();
    if (answer === 'y' || answer === 'yes') {
      return 'approve';
    }
    return 'deny';
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const [modelArg, promptArg] = process.argv.slice(2);

  try {
    await loadEnvFiles(process.cwd());
    applyExampleDefaultEnv();

    const modelId = resolveModelId(modelArg);
    requireEnvApiKey(modelId);

    const runtimeConfig = loadRuntimeConfigFromEnv(process.env, process.cwd());
    const memoryManager = createMemoryManagerFromEnv(process.env, process.cwd());
    const logger = createLoggerFromEnv(process.env, process.cwd());
    const maxSteps = parsePositiveIntEnv('AGENT_MAX_STEPS', EXAMPLE_DEFAULT_MAX_STEPS);
    const provider = ProviderRegistry.createFromEnv(modelId, {
      logger: logger.child('Provider'),
    });
    const toolManager = new ToolManager();
    toolManager.register([
      new BashTool(),
      new FileReadTool(),
      new FileWriteTool(),
      new FileEditTool(),
      new FileStatTool(),
      new GlobTool(),
      new GrepTool(),
      new SkillTool(),
    ]);
    const sessionId = process.env.AGENT_SESSION_ID ?? `example-agent-${Date.now()}`;

    console.log('=== Runtime Config ===');
    console.log(`model=${modelId}`);
    console.log(`sessionId=${sessionId}`);
    console.log(`storage.backend=${runtimeConfig.storage.backend}`);
    console.log(`storage.dir=${runtimeConfig.storage.dir}`);
    console.log(`storage.sqlitePath=${runtimeConfig.storage.sqlitePath}`);
    console.log(`agent.maxSteps=${maxSteps}`);
    console.log(`log.fileEnabled=${String(runtimeConfig.log.fileEnabled)}`);
    console.log(`log.filePath=${runtimeConfig.log.filePath}`);

    const agent = new Agent({
      provider,
      toolManager,
      memoryManager,
      logger,
      sessionId,
      systemPrompt: buildSystemPrompt({ directory: process.cwd() }),
      maxSteps,
      plugins: [createConsoleStreamPlugin()],
      onToolConfirm: confirmToolExecution,
    });

    const prompt = promptArg ?? DEFAULT_PROMPT;

    const first = await agent.run(prompt);
    printResult('First Run', first.text);
    console.log(
      `completion.reason=${first.completionReason}, completion.message=${first.completionMessage ?? ''}`
    );

    const history = memoryManager.getHistory({ sessionId });
    console.log('\n=== Memory Summary ===');
    console.log(`history.messages=${history.length}`);
    console.log(`storage.contextFile=${runtimeConfig.storage.dir}/contexts/${sessionId}.json`);
    if (runtimeConfig.log.fileEnabled) {
      console.log(`log.file=${runtimeConfig.log.filePath}`);
    }

    await memoryManager.close();
    logger.close();
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(`[AgentExampleError] ${message}`);
    printUsage();
    process.exitCode = 1;
  }
}

void main();

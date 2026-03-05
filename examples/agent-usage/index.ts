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
import { BashTool, ToolManager } from '../../src/tool/index.ts';

const DEFAULT_MODEL: ModelId = 'glm-4.7';
const DEFAULT_PROMPT = '初始化一个 Node.js + TypeScript + Vitest 项目，给出执行步骤。';
const EXAMPLE_DEFAULT_LOG_DIR = './examples/agent-usage/logs';
const EXAMPLE_DEFAULT_LOG_FILE = 'agent-example.log';
const EXAMPLE_DEFAULT_MAX_STEPS = 24;

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
    toolManager.registerList([new BashTool()]);
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
      systemPrompt: 'You are a practical coding assistant. Respond in Chinese with concise steps.',
      maxSteps,
      plugins: [createConsoleStreamPlugin()],
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

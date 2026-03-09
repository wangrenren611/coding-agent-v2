import * as path from 'node:path';
import { config as loadDotEnv } from 'dotenv';
import { ProviderRegistry, type ModelId } from '../src/providers/index.ts';
import { StatelessAgent } from '../src/agent-v4/agent/index.ts';
import { DefaultToolManager } from '../src/agent-v4/tool/tool-manager.ts';
import type { Message, StreamEvent } from '../src/agent-v4/types.ts';
import { BashTool } from '../src/agent-v4/tool/bash.ts';
import { WriteFileTool } from '../src/agent-v4/tool/write-file.ts';
import type { Usage } from '../src/providers/index.ts';
import {
  AgentAppService,
  createSqliteAgentAppStore,
  type CliEventEnvelope,
} from '../src/agent-v4/app/index.ts';

const DEFAULT_MODEL: ModelId = 'minimax-2.5';
const DEFAULT_PROMPT = '请用三点总结当前仓库的主要结构。';

function bootstrapEnv(): void {
  const dotenvPath = '.env.development';
  const result = loadDotEnv({ path: dotenvPath, quiet: true });
  if (result.error) {
    console.warn(`[demo] dotenv file not loaded: ${dotenvPath} (${result.error.message})`);
  } else {
    console.log(`[demo] loaded env from ${dotenvPath}`);
  }
}

function resolveModelId(input?: string): ModelId {
  const candidate = (
    input ||
    process.env.AGENT_V4_MODEL ||
    process.env.AI_MODEL ||
    DEFAULT_MODEL
  ).trim();
  const supported = ProviderRegistry.getModelIds();
  if (!supported.includes(candidate as ModelId)) {
    throw new Error(`Unsupported modelId "${candidate}". Supported: ${supported.join(', ')}`);
  }
  return candidate as ModelId;
}

function requireModelApiKey(modelId: ModelId): void {
  const modelConfig = ProviderRegistry.getModelConfig(modelId);
  const key = process.env[modelConfig.envApiKey];
  if (!key) {
    throw new Error(`Missing env ${modelConfig.envApiKey} for model "${modelId}".`);
  }
}

function resolveDbPath(input?: string): string {
  const raw = input || process.env.AGENT_V4_DB_PATH || '.agent-v4/agent.db';
  return path.resolve(process.cwd(), raw.trim());
}

function printEvent(event: CliEventEnvelope): void {
  const streamEvent = {
    type: event.eventType as StreamEvent['type'],
    data: event.data,
  };
  switch (streamEvent.type) {
    case 'chunk': {
      const data = streamEvent.data as { content?: string };
      if (data.content) process.stdout.write(data.content);
      return;
    }
    case 'reasoning_chunk': {
      const showReasoning = process.env.AGENT_V4_SHOW_REASONING?.trim().toLowerCase() === 'true';
      if (!showReasoning) return;
      const data = streamEvent.data as { reasoningContent?: string; reasoning_content?: string };
      const reasoningText = data.reasoningContent ?? data.reasoning_content;
      if (reasoningText) process.stdout.write(`[reasoning] ${reasoningText}\n`);
      return;
    }
    case 'tool_call':
    case 'tool_result':
    case 'tool_stream':
    case 'progress':
    case 'checkpoint':
    case 'compaction':
    case 'done':
    case 'error':
      console.log(`\n[event:${event.eventType} seq=${event.seq}]`, JSON.stringify(event.data));
      return;
    default:
      return;
  }
}

interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

function isUsage(value: unknown): value is Usage {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const usage = value as Partial<Usage>;
  return (
    typeof usage.prompt_tokens === 'number' &&
    typeof usage.completion_tokens === 'number' &&
    typeof usage.total_tokens === 'number'
  );
}

function updateUsageAndPrint(
  message: Message,
  cumulativeUsage: UsageStats,
  usageStepCounter: { value: number }
): void {
  if (message.role !== 'assistant' || !isUsage(message.usage)) {
    return;
  }

  usageStepCounter.value += 1;
  const usage = message.usage;
  cumulativeUsage.promptTokens += usage.prompt_tokens;
  cumulativeUsage.completionTokens += usage.completion_tokens;
  cumulativeUsage.totalTokens += usage.total_tokens;

  console.log(
    `\n[usage:step ${usageStepCounter.value}] prompt=${usage.prompt_tokens} completion=${usage.completion_tokens} total=${usage.total_tokens}`
  );
  console.log(
    `[usage:total] prompt=${cumulativeUsage.promptTokens} completion=${cumulativeUsage.completionTokens} total=${cumulativeUsage.totalTokens}`
  );
}

async function main(): Promise<void> {
  bootstrapEnv();
  const [modelArg, ...promptParts] = process.argv.slice(2);

  const modelId = resolveModelId(modelArg);
  requireModelApiKey(modelId);
  const prompt =
    promptParts.join(' ').trim() || process.env.AGENT_V4_PROMPT?.trim() || DEFAULT_PROMPT;

  const provider = ProviderRegistry.createFromEnv(modelId);
  const toolManager = new DefaultToolManager();
  toolManager.registerTool(new BashTool());
  toolManager.registerTool(new WriteFileTool());
  const agent = new StatelessAgent(provider, toolManager, { maxRetryCount: 2 });
  const dbPath = resolveDbPath(process.env.AGENT_V4_DB_PATH);
  const store = createSqliteAgentAppStore(dbPath);
  const app = new AgentAppService({
    agent,
    executionStore: store,
    eventStore: store,
    messageStore: store,
  });

  const conversationId = process.env.AGENT_V4_CONVERSATION_ID || `conv_${Date.now()}`;
  const executionId = process.env.AGENT_V4_EXECUTION_ID || `exec_${Date.now()}`;
  const maxSteps = 1000;

  console.log(`[demo] model=${modelId}`);
  console.log(`[demo] conversationId=${conversationId}`);
  console.log(`[demo] executionId=${executionId}`);
  console.log(`[demo] dbPath=${dbPath}`);
  console.log(`[demo] prompt=${prompt}`);
  console.log('---');

  const cumulativeUsage: UsageStats = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  const usageStepCounter = { value: 0 };

  try {
    const result = await app.runForeground(
      {
        conversationId,
        executionId,
        userInput: prompt,
        maxSteps,
      },
      {
        onEvent: (event) => {
          printEvent(event);
        },
        onMessage: (message) => {
          updateUsageAndPrint(message, cumulativeUsage, usageStepCounter);
        },
      }
    );

    const run = await app.getRun(executionId);
    const listedRuns = await app.listRuns(conversationId, { limit: 10 });
    const runEvents = await app.listRunEvents(executionId);

    console.log('\n---');
    console.log(`[demo] finishReason=${result.finishReason}`);
    console.log(`[demo] steps=${result.steps}`);
    console.log(`[demo] runStatus=${run?.status ?? 'UNKNOWN'}`);
    console.log(`[demo] terminalReason=${run?.terminalReason ?? 'UNKNOWN'}`);
    console.log(`[demo] persistedEvents=${runEvents.length}`);
    console.log(`[demo] runListCount=${listedRuns.items.length}`);
    if (usageStepCounter.value > 0) {
      console.log(
        `[demo] usageTotal prompt=${cumulativeUsage.promptTokens} completion=${cumulativeUsage.completionTokens} total=${cumulativeUsage.totalTokens}`
      );
    }
  } finally {
    await store.close();
  }
}

main().catch((error) => {
  console.error('[demo] failed', error);
  process.exitCode = 1;
});

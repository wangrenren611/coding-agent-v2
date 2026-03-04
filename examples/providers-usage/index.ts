import { ProviderRegistry, type ModelId } from '../../src/providers/index.ts';
import {
  createMessages,
  printProviderError,
  readChunkText,
  requireEnvApiKey,
  resolveModelId,
} from './shared.ts';

type Command = 'list-models' | 'non-stream' | 'stream' | 'stream-timeout';

function printUsage(): void {
  console.log(`
Providers usage example

Commands:
  list-models
  non-stream [modelId] [prompt]
  stream [modelId] [prompt]
  stream-timeout [modelId] [prompt] [timeoutMs]

Examples:
  pnpm example:providers list-models
  pnpm example:providers non-stream glm-4.7 "解释一下 TypeScript 条件类型"
  pnpm example:providers stream glm-4.7 "写一个二分查找函数"
  pnpm example:providers stream-timeout glm-4.7 "写 500 行注释" 1
`);
}

function parseArgs(argv: string[]): {
  command: Command;
  modelId?: ModelId;
  prompt?: string;
  timeoutMs?: number;
} {
  const [commandRaw, modelRaw, promptRaw, timeoutRaw] = argv;
  if (!commandRaw) {
    throw new Error('Missing command.');
  }
  if (
    commandRaw !== 'list-models' &&
    commandRaw !== 'non-stream' &&
    commandRaw !== 'stream' &&
    commandRaw !== 'stream-timeout'
  ) {
    throw new Error(`Unknown command: "${commandRaw}"`);
  }

  const command = commandRaw as Command;
  const modelId = command === 'list-models' ? undefined : resolveModelId(modelRaw);
  const prompt = promptRaw ?? '请给我一个 3 条的 TypeScript 学习计划。';

  let timeoutMs: number | undefined;
  if (command === 'stream-timeout') {
    const parsed = Number(timeoutRaw ?? 1);
    timeoutMs = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  }

  return { command, modelId, prompt, timeoutMs };
}

function listModels(): void {
  const rows = ProviderRegistry.listModels().map((m) => ({
    id: m.id,
    provider: m.provider,
    model: m.model,
    envApiKey: m.envApiKey,
    envBaseURL: m.envBaseURL,
  }));
  console.table(rows);
}

async function runNonStream(modelId: ModelId, prompt: string): Promise<void> {
  requireEnvApiKey(modelId);
  const provider = ProviderRegistry.createFromEnv(modelId);

  const response = await provider.generate(createMessages(prompt), {
    temperature: 0.2,
    max_tokens: 1024,
  });

  const content = response.choices[0]?.message?.content;
  console.log('\n=== Non-Stream Response ===');
  if (typeof content === 'string') {
    console.log(content);
  } else {
    console.log(JSON.stringify(content, null, 2));
  }

  if (response.usage) {
    console.log('\n=== Usage ===');
    console.log(JSON.stringify(response.usage, null, 2));
  }
}

async function runStream(modelId: ModelId, prompt: string): Promise<void> {
  requireEnvApiKey(modelId);
  const provider = ProviderRegistry.createFromEnv(modelId);

  const stream = provider.generateStream(createMessages(prompt), {
    temperature: 0.2,
    max_tokens: 1024,
  });

  console.log('\n=== Stream Response ===');
  let usage: unknown;
  for await (const chunk of stream) {
    const text = readChunkText(chunk);
    if (text) {
      process.stdout.write(text);
    }
    if (chunk.usage) {
      usage = chunk.usage;
    }
  }
  process.stdout.write('\n');

  if (usage) {
    console.log('\n=== Usage ===');
    console.log(JSON.stringify(usage, null, 2));
  }
}

async function runStreamTimeoutDemo(modelId: ModelId, prompt: string, timeoutMs: number): Promise<void> {
  requireEnvApiKey(modelId);
  const provider = ProviderRegistry.createFromEnv(modelId);

  const signal = AbortSignal.timeout(timeoutMs);
  const stream = provider.generateStream(createMessages(prompt), {
    abortSignal: signal,
    temperature: 0.2,
    max_tokens: 1024,
  });

  for await (const chunk of stream) {
    const text = readChunkText(chunk);
    if (text) {
      process.stdout.write(text);
    }
  }
  process.stdout.write('\n');
}

async function main(): Promise<void> {
  try {
    const { command, modelId, prompt, timeoutMs } = parseArgs(process.argv.slice(2));

    switch (command) {
      case 'list-models':
        listModels();
        return;
      case 'non-stream':
        await runNonStream(modelId!, prompt!);
        return;
      case 'stream':
        await runStream(modelId!, prompt!);
        return;
      case 'stream-timeout':
        await runStreamTimeoutDemo(modelId!, prompt!, timeoutMs!);
        return;
    }
  } catch (error) {
    printProviderError(error);
    printUsage();
    process.exitCode = 1;
  }
}

void main();

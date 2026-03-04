import { OpenAICompatibleProvider } from '../../src/providers/index.ts';
import { createMessages, printProviderError, readChunkText } from './shared.ts';

function createManualProvider(): OpenAICompatibleProvider {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.GLM_API_KEY;
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY (or GLM_API_KEY) for manual provider example.');
  }

  const baseURL =
    process.env.OPENAI_API_BASE_URL ??
    process.env.OPENAI_API_BASE ??
    process.env.GLM_API_BASE ??
    'https://api.openai.com/v1';

  const model = process.env.OPENAI_MODEL ?? process.env.AI_MODEL ?? 'gpt-4o-mini';

  return new OpenAICompatibleProvider({
    apiKey,
    baseURL,
    model,
    temperature: 0.2,
    max_tokens: 1024,
    LLMMAX_TOKENS: 128000,
    chatCompletionsPath: '/chat/completions',
    enableStreamUsage: true,
  });
}

async function run(): Promise<void> {
  const provider = createManualProvider();
  const prompt = process.argv.slice(2).join(' ') || '给我一段简短的 TypeScript 示例代码。';

  const messages = createMessages(prompt);

  const nonStream = await provider.generate(messages, {
    max_tokens: 256,
  });
  console.log('\n=== Manual Provider: generate ===');
  console.log(nonStream.choices[0]?.message?.content ?? '');

  console.log('\n=== Manual Provider: generateStream ===');
  const stream = provider.generateStream(messages, {
    max_tokens: 256,
  });
  for await (const chunk of stream) {
    const text = readChunkText(chunk);
    if (text) {
      process.stdout.write(text);
    }
  }
  process.stdout.write('\n');
}

void run().catch((error) => {
  printProviderError(error);
  process.exitCode = 1;
});

import { loadEnvFiles } from '../src/config/index.ts';
import { ProviderRegistry } from '../src/providers/registry.ts';

async function main(): Promise<void> {
  const loadedFiles = await loadEnvFiles(process.cwd(), {
    files: ['.env.development'],
  });

  if (loadedFiles.length === 0) {
    throw new Error('Failed to load .env.development');
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY in .env.development');
  }

  const provider = ProviderRegistry.createFromEnv('gpt-5.3');
  const response = await provider.generate(
    [
      {
        role: 'user',
        content: 'Reply with exactly: pong',
      },
    ],
    {
      max_tokens: 32,
    }
  );
  const text = response.choices[0]?.message?.content;

  console.log('[test] loaded env:', loadedFiles.join(', '));
  console.log('[test] url:', `${provider.config.baseURL}${provider.adapter.getEndpointPath()}`);
  console.log('[test] adapter:', provider.adapter.constructor.name);
  console.log('[test] content:', text);
  console.log('[test] usage:', JSON.stringify(response.usage ?? null));
}

main().catch((error) => {
  console.error('[test] failed:', error);
  process.exitCode = 1;
});

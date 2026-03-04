import {
  ProviderRegistry,
  isAbortedError,
  isPermanentError,
  isRetryableError,
  type Chunk,
  type LLMRequestMessage,
  type MessageContent,
  type ModelId,
} from '../../src/providers/index.ts';

export const DEFAULT_MODEL: ModelId = 'glm-4.7';

const DEFAULT_SYSTEM_PROMPT =
  'You are a concise coding assistant. Answer in Chinese and keep output structured.';

export function createMessages(prompt: string): LLMRequestMessage[] {
  return [
    { role: 'system', content: DEFAULT_SYSTEM_PROMPT },
    { role: 'user', content: prompt },
  ];
}

export function resolveModelId(input?: string): ModelId {
  const fallback = DEFAULT_MODEL;
  if (!input) {
    return fallback;
  }

  const modelIds = ProviderRegistry.getModelIds();
  if (!modelIds.includes(input as ModelId)) {
    throw new Error(
      `Unsupported modelId: "${input}". Run "list-models" to view supported model ids.`
    );
  }

  return input as ModelId;
}

export function requireEnvApiKey(modelId: ModelId): void {
  const modelConfig = ProviderRegistry.getModelConfig(modelId);
  const apiKey = process.env[modelConfig.envApiKey];
  if (!apiKey) {
    throw new Error(
      `Missing env ${modelConfig.envApiKey}. This model requires API key from env before createFromEnv().`
    );
  }
}

export function readChunkText(chunk: Chunk): string {
  if (!chunk.choices?.length) {
    return '';
  }

  let text = '';
  for (const choice of chunk.choices) {
    text += readContentText(choice.delta?.content);
  }
  return text;
}

function readContentText(content: MessageContent | undefined): string {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((part) => {
      if (part.type === 'text' && typeof part.text === 'string') {
        return part.text;
      }
      return '';
    })
    .join('');
}

export function printProviderError(error: unknown): void {
  if (isRetryableError(error)) {
    console.error(`[RetryableError] code=${error.code ?? 'UNKNOWN'} message=${error.message}`);
    return;
  }
  if (isPermanentError(error)) {
    console.error(`[PermanentError] code=${error.code ?? 'UNKNOWN'} message=${error.message}`);
    return;
  }
  if (isAbortedError(error)) {
    console.error(`[AbortedError] code=${error.code ?? 'ABORTED'} message=${error.message}`);
    return;
  }
  if (error instanceof Error) {
    console.error(`[UnknownError] ${error.name}: ${error.message}`);
    return;
  }
  console.error(`[UnknownError] ${String(error)}`);
}

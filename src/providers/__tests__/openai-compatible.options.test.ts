import { describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleProvider } from '../openai-compatible';
import type { Chunk } from '../types';

function createDoneStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

async function drainStream(stream: AsyncGenerator<Chunk>): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _ of stream) {
    // no-op
  }
}

describe('OpenAICompatibleProvider request options', () => {
  it('should include stream_options.include_usage by default in stream mode', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com',
      model: 'gpt-4',
      temperature: 0.7,
      max_tokens: 2000,
      LLMMAX_TOKENS: 8000,
    });

    const fetchSpy = vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: createDoneStream(),
    } as Response);

    const stream = provider.generateStream([{ role: 'user', content: 'hello' }]);
    await drainStream(stream);

    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(requestBody.stream).toBe(true);
    expect(requestBody.stream_options?.include_usage).toBe(true);
  });

  it('should respect explicit stream_options.include_usage=false', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com',
      model: 'gpt-4',
      temperature: 0.7,
      max_tokens: 2000,
      LLMMAX_TOKENS: 8000,
    });

    const fetchSpy = vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: createDoneStream(),
    } as Response);

    const stream = provider.generateStream([{ role: 'user', content: 'hello' }], {
      stream_options: {
        include_usage: false,
      },
    });
    await drainStream(stream);

    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(requestBody.stream_options?.include_usage).toBe(false);
  });

  it('should pass tool_stream through without enabling stream mode', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com',
      model: 'gpt-4',
      temperature: 0.7,
      max_tokens: 2000,
      LLMMAX_TOKENS: 8000,
    });

    const fetchSpy = vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'test-id',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
      }),
    } as Response);

    await provider.generate([{ role: 'user', content: 'hello' }], {
      tool_stream: true,
    });

    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(requestBody.stream).toBe(false);
    expect(requestBody.tool_stream).toBe(true);
    expect(requestBody.stream_options).toBeUndefined();
  });

  it('should use provider config tool_stream by default', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com',
      model: 'gpt-4',
      temperature: 0.7,
      max_tokens: 2000,
      LLMMAX_TOKENS: 8000,
      tool_stream: true,
    });

    const fetchSpy = vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'test-id',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
      }),
    } as Response);

    await provider.generate([{ role: 'user', content: 'hello' }]);

    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(requestBody.stream).toBe(false);
    expect(requestBody.tool_stream).toBe(true);
  });

  it('should not send thinking flag in standard adapter request body', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com',
      model: 'gpt-4',
      temperature: 0.7,
      max_tokens: 2000,
      LLMMAX_TOKENS: 8000,
      thinking: false,
    });

    const fetchSpy = vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: createDoneStream(),
    } as Response);

    const stream = provider.generateStream([{ role: 'user', content: 'hello' }]);
    await drainStream(stream);

    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(requestBody.thinking).toBeUndefined();
  });

  it('should preserve multimodal content parts in request body', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com',
      model: 'gpt-4',
      temperature: 0.7,
      max_tokens: 2000,
      LLMMAX_TOKENS: 8000,
    });

    const fetchSpy = vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: createDoneStream(),
    } as Response);

    const userContent = [
      { type: 'text', text: 'describe this media' },
      { type: 'image_url', image_url: { url: 'https://example.com/demo.png' } },
      { type: 'file', file: { file_id: 'file-video-1', filename: 'demo.mp4' } },
      { type: 'input_video', input_video: { url: 'https://example.com/clip.mp4' } },
    ] as const;

    const stream = provider.generateStream([{ role: 'user', content: [...userContent] }]);
    await drainStream(stream);

    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(requestBody.messages[0].content).toEqual(userContent);
  });

  it('should use provider max_tokens as default when request max_tokens is not provided', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com',
      model: 'gpt-4',
      temperature: 0.7,
      max_tokens: 4321,
      LLMMAX_TOKENS: 8000,
    });

    const fetchSpy = vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'test-id',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
      }),
    } as Response);

    await provider.generate([{ role: 'user', content: 'hello' }]);

    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(requestBody.max_tokens).toBe(4321);
  });

  it('should allow request temperature to override provider default', async () => {
    const provider = new OpenAICompatibleProvider({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com',
      model: 'gpt-4',
      temperature: 0.7,
      max_tokens: 2000,
      LLMMAX_TOKENS: 8000,
    });

    const fetchSpy = vi.spyOn(provider.httpClient, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'test-id',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
      }),
    } as Response);

    await provider.generate([{ role: 'user', content: 'hello' }], {
      temperature: 0.2,
    });

    const requestBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(requestBody.temperature).toBe(0.2);
  });
});

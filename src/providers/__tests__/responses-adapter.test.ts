import { describe, expect, it } from 'vitest';
import { ResponsesAdapter } from '../adapters/responses';
import type { Chunk } from '../types';

async function collectChunks(stream: AsyncGenerator<Chunk>): Promise<Chunk[]> {
  const chunks: Chunk[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('ResponsesAdapter', () => {
  it('should transform chat-style messages into responses input items', () => {
    const adapter = new ResponsesAdapter({
      defaultModel: 'gpt-5.3-codex',
    });

    const body = adapter.transformRequest({
      model: 'gpt-5.3-codex',
      stream: true,
      max_tokens: 32,
      temperature: 0.1,
      model_reasoning_effort: 'high',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Reply with exactly: pong' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              index: 0,
              function: {
                name: 'lookup_weather',
                arguments: '{"city":"Shanghai"}',
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_1',
          content: '{"temperature":26}',
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'lookup_weather',
            description: 'Lookup weather by city',
            parameters: {
              type: 'object',
              properties: {
                city: { type: 'string' },
              },
              required: ['city'],
            },
          },
        },
      ],
    });

    expect(body).toMatchObject({
      model: 'gpt-5.3-codex',
      stream: true,
      store: false,
      max_output_tokens: 32,
      reasoning: {
        effort: 'high',
      },
      tools: [
        {
          type: 'function',
          name: 'lookup_weather',
          description: 'Lookup weather by city',
        },
      ],
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: 'You are a helpful assistant.' }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'Reply with exactly: pong' }],
        },
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'lookup_weather',
          arguments: '{"city":"Shanghai"}',
        },
        {
          type: 'function_call_output',
          call_id: 'call_1',
          output: '{"temperature":26}',
        },
      ],
    });

    expect(body).not.toHaveProperty('stream_options');
    expect(body).not.toHaveProperty('tool_stream');
  });

  it('should map assistant history content to gateway-compatible format', () => {
    const adapter = new ResponsesAdapter({
      defaultModel: 'gpt-5.3-codex',
    });

    const body = adapter.transformRequest({
      model: 'gpt-5.3-codex',
      stream: true,
      max_tokens: 32,
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '你好！我在这儿，随时可以帮你看代码。' },
        { role: 'user', content: '你是谁' },
      ],
    });

    expect(body).toMatchObject({
      input: [
        {
          role: 'system',
          content: [{ type: 'input_text', text: 'You are a helpful assistant.' }],
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: '你好' }],
        },
        {
          role: 'assistant',
          content: '你好！我在这儿，随时可以帮你看代码。',
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: '你是谁' }],
        },
      ],
    });
  });

  it('should transform responses output to standard response shape', () => {
    const adapter = new ResponsesAdapter({
      defaultModel: 'gpt-5.3-codex',
    });

    const response = adapter.transformResponse({
      id: 'resp_123',
      object: 'response',
      created_at: 1_762_675_000,
      model: 'gpt-5.3-codex',
      output: [
        { type: 'reasoning', content: [] },
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'pong' }],
        },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 2,
        total_tokens: 12,
        input_tokens_details: {
          cached_tokens: 7,
        },
        output_tokens_details: {
          reasoning_tokens: 1,
        },
      },
    });

    expect(response).toMatchObject({
      id: 'resp_123',
      object: 'chat.completion',
      created: 1_762_675_000,
      model: 'gpt-5.3-codex',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'pong',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 2,
        prompt_tokens: 10,
        completion_tokens: 2,
        total_tokens: 12,
        input_tokens_details: {
          cached_tokens: 7,
        },
        output_tokens_details: {
          reasoning_tokens: 1,
        },
      },
    });
  });

  it('should parse responses streaming events into standard chunks', async () => {
    const adapter = new ResponsesAdapter({
      defaultModel: 'gpt-5.3-codex',
    });

    const sse = [
      'event: response.created\n',
      'data: {"type":"response.created","response":{"id":"resp_123","model":"gpt-5.3-codex","created_at":1762675000}}\n\n',
      'event: response.output_item.added\n',
      'data: {"type":"response.output_item.added","output_index":0,"item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"lookup_weather","arguments":""}}\n\n',
      'event: response.function_call_arguments.delta\n',
      'data: {"type":"response.function_call_arguments.delta","output_index":0,"item_id":"fc_1","delta":"{\\"city\\":\\"Shanghai\\"}"}\n\n',
      'event: response.output_text.delta\n',
      'data: {"type":"response.output_text.delta","output_index":1,"content_index":0,"delta":"pong"}\n\n',
      'event: response.completed\n',
      'data: {"type":"response.completed","response":{"id":"resp_123","model":"gpt-5.3-codex","created_at":1762675000,"usage":{"input_tokens":10,"output_tokens":2,"total_tokens":12,"input_tokens_details":{"cached_tokens":6},"output_tokens_details":{"reasoning_tokens":1}}}}\n\n',
    ].join('');

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        controller.close();
      },
    });

    const chunks = await collectChunks(adapter.parseStreamAsync!(stream.getReader()));

    expect(chunks).toHaveLength(4);
    expect(chunks[0].choices?.[0]?.delta.tool_calls?.[0]).toMatchObject({
      id: 'call_1',
      index: 0,
      function: {
        name: 'lookup_weather',
        arguments: '',
      },
    });
    expect(chunks[1].choices?.[0]?.delta.tool_calls?.[0]?.function?.arguments).toBe(
      '{"city":"Shanghai"}'
    );
    expect(chunks[2].choices?.[0]?.delta.content).toBe('pong');
    expect(chunks[3].usage).toMatchObject({
      input_tokens: 10,
      output_tokens: 2,
      prompt_tokens: 10,
      completion_tokens: 2,
      total_tokens: 12,
      input_tokens_details: {
        cached_tokens: 6,
      },
      output_tokens_details: {
        reasoning_tokens: 1,
      },
    });
  });

  it('should convert response.failed events into standard stream error chunks', async () => {
    const adapter = new ResponsesAdapter({
      defaultModel: 'glm-5',
    });

    const sse = [
      'event: response.created\n',
      'data: {"type":"response.created","response":{"id":"resp_failed","model":"glm-5","created_at":1762675000}}\n\n',
      'event: response.failed\n',
      'data: {"type":"response.failed","error":{"code":"upstream_timeout","type":"server_error","message":"temporary upstream timeout"}}\n\n',
    ].join('');

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        controller.close();
      },
    });

    const chunks = await collectChunks(adapter.parseStreamAsync!(stream.getReader()));

    expect(chunks).toEqual([
      {
        id: 'resp_failed',
        index: 0,
        error: {
          code: 'upstream_timeout',
          type: 'server_error',
          message: 'temporary upstream timeout',
        },
      },
    ]);
  });
});

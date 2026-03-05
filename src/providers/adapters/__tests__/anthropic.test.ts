/**
 * AnthropicAdapter test cases
 *
 * Verify Anthropic API adapter functionality
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnthropicAdapter } from '../anthropic';
import type { LLMRequestMessage, Tool } from '../../types';
import { createLogger } from '../../../logger';
import type { LogRecord } from '../../../logger';

describe('AnthropicAdapter', () => {
  let adapter: AnthropicAdapter;

  beforeEach(() => {
    adapter = new AnthropicAdapter({
      defaultModel: 'claude-opus-4-6-20250528',
      endpointPath: '/v1/messages',
    });
  });

  describe('getEndpointPath', () => {
    it('should return correct endpoint path', () => {
      expect(adapter.getEndpointPath()).toBe('/v1/messages');
    });
  });

  describe('getHeaders', () => {
    it('should return correct Anthropic API headers', () => {
      const headers = adapter.getHeaders('test-api-key');

      expect(headers.get('Content-Type')).toBe('application/json');
      expect(headers.get('x-api-key')).toBe('test-api-key');
      expect(headers.get('anthropic-version')).toBe('2023-06-01');
    });

    it('should support custom API version', () => {
      const customAdapter = new AnthropicAdapter({
        apiVersion: '2024-01-01',
      });
      const headers = customAdapter.getHeaders('test-api-key');

      expect(headers.get('anthropic-version')).toBe('2024-01-01');
    });
  });

  describe('transformRequest', () => {
    it('should correctly transform basic request', () => {
      const messages: LLMRequestMessage[] = [{ role: 'user', content: 'Hello' }];

      const request = adapter.transformRequest({
        model: 'claude-opus-4-6-20250528',
        messages,
        max_tokens: 1024,
      });

      const body = request as unknown as Record<string, unknown>;
      expect(body.model).toBe('claude-opus-4-6-20250528');
      expect(body.max_tokens).toBe(1024);
      expect(body.messages).toHaveLength(1);
    });

    it('should extract system message to top-level field', () => {
      const messages: LLMRequestMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello' },
      ];

      const request = adapter.transformRequest({
        model: 'claude-opus-4-6-20250528',
        messages,
        max_tokens: 1024,
      });

      const body = request as unknown as Record<string, unknown>;
      expect(body.system).toBe('You are a helpful assistant.');
      expect(
        (body.messages as Array<Record<string, unknown>>).find((m) => m.role === 'system')
      ).toBeUndefined();
    });

    it('should merge multiple system messages', () => {
      const messages: LLMRequestMessage[] = [
        { role: 'system', content: 'You are helpful.' },
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: 'Hello' },
      ];

      const request = adapter.transformRequest({
        model: 'claude-opus-4-6-20250528',
        messages,
        max_tokens: 1024,
      });

      const body = request as unknown as Record<string, unknown>;
      expect(body.system).toBe('You are helpful.\n\nBe concise.');
    });

    it('should convert tool definitions into Anthropic format', () => {
      const messages: LLMRequestMessage[] = [{ role: 'user', content: 'What is the weather?' }];
      const tools: Tool[] = [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get weather info',
            parameters: {
              type: 'object',
              properties: {
                location: { type: 'string' },
              },
            },
          },
        },
      ];

      const request = adapter.transformRequest({
        model: 'claude-opus-4-6-20250528',
        messages,
        max_tokens: 1024,
        tools,
      });

      const body = request as unknown as Record<string, unknown>;
      expect(body.tools).toBeDefined();
      expect((body.tools as Array<Record<string, unknown>>)[0].name).toBe('get_weather');
      expect((body.tools as Array<Record<string, unknown>>)[0].input_schema).toBeDefined();
    });

    it('should log warn when image_url is not base64 data URL', () => {
      const records: LogRecord[] = [];
      const logger = createLogger({
        console: { enabled: false },
        file: { enabled: false, filepath: './logs/test.log' },
        onLog: (record) => {
          records.push(record);
        },
      });
      const warnSpy = vi.spyOn(logger, 'warn');
      const adapterWithLogger = new AnthropicAdapter({ logger });

      const messages: LLMRequestMessage[] = [
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'https://example.com/demo.png' } }],
        },
      ];

      adapterWithLogger.transformRequest({
        model: 'claude-opus-4-6-20250528',
        messages,
        max_tokens: 1024,
      });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(
        records.some((record) => record.message.includes('Anthropic does not support image URLs'))
      ).toBe(true);
    });
  });

  describe('transformResponse', () => {
    it('should correctly transform Anthropic response to standard format', () => {
      const anthropicResponse = {
        id: 'msg_xxx',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello! How can I help you?' }],
        model: 'claude-opus-4-6-20250528',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          output_tokens: 20,
        },
      };

      const response = adapter.transformResponse(anthropicResponse);

      expect(response.id).toBe('msg_xxx');
      expect(response.model).toBe('claude-opus-4-6-20250528');
      expect(response.choices).toHaveLength(1);
      expect(response.choices[0].message.content).toBe('Hello! How can I help you?');
      expect(response.choices[0].message.role).toBe('assistant');
      expect(response.choices[0].finish_reason).toBe('stop');
      expect(response.usage?.prompt_tokens).toBe(10);
      expect(response.usage?.completion_tokens).toBe(20);
    });

    it('should correctly handle tool call response', () => {
      const anthropicResponse = {
        id: 'msg_xxx',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'text', text: '' },
          {
            type: 'tool_use',
            id: 'toolu_xxx',
            name: 'get_weather',
            input: { location: 'Beijing' },
          },
        ],
        model: 'claude-opus-4-6-20250528',
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          output_tokens: 30,
        },
      };

      const response = adapter.transformResponse(anthropicResponse);

      expect(response.choices[0].message.tool_calls).toBeDefined();
      expect(response.choices[0].message.tool_calls).toHaveLength(1);
      expect(response.choices[0].message.tool_calls?.[0].id).toBe('toolu_xxx');
      expect(response.choices[0].message.tool_calls?.[0].function.name).toBe('get_weather');
      expect(response.choices[0].finish_reason).toBe('tool_calls');
    });

    it('should correctly convert stop_reason', () => {
      const testCases = [
        { stop_reason: 'end_turn', expected: 'stop' },
        { stop_reason: 'max_tokens', expected: 'length' },
        { stop_reason: 'tool_use', expected: 'tool_calls' },
        { stop_reason: null, expected: null },
      ];

      for (const { stop_reason, expected } of testCases) {
        const response = adapter.transformResponse({
          id: 'msg_xxx',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'test' }],
          model: 'claude-opus-4-6-20250528',
          stop_reason,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
        });

        expect(response.choices[0].finish_reason).toBe(expected);
      }
    });
  });

  describe('parseStreamEvent', () => {
    it('should correctly parse message_start event', () => {
      const event = {
        type: 'message_start',
        message: {
          id: 'msg_xxx',
          type: 'message' as const,
          role: 'assistant' as const,
          content: [] as Array<{ type: 'text'; text: string }>,
          model: 'claude-opus-4-6-20250528',
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      };

      const chunk = adapter.parseStreamEvent(event, {});

      expect(chunk).not.toBeNull();
      expect(chunk?.id).toBe('msg_xxx');
      expect(chunk?.model).toBe('claude-opus-4-6-20250528');
      expect(chunk?.choices?.[0]?.delta.role).toBe('assistant');
    });

    it('should correctly parse content_block_delta text event', () => {
      const event = {
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'text_delta',
          text: 'Hello',
        },
      };

      const chunk = adapter.parseStreamEvent(event, {});

      expect(chunk).not.toBeNull();
      expect(chunk?.choices?.[0]?.delta.content).toBe('Hello');
    });

    it('should correctly parse message_delta event', () => {
      const event = {
        type: 'message_delta',
        delta: {
          type: 'stop_reason',
          stop_reason: 'end_turn',
        },
        usage: {
          input_tokens: 0,
          output_tokens: 50,
        },
      };
      const chunk = adapter.parseStreamEvent(event, {});

      expect(chunk).not.toBeNull();
      expect(chunk?.choices?.[0]?.finish_reason).toBe('stop');
      expect(chunk?.usage?.completion_tokens).toBe(50);
    });

    it('should preserve tool call id and name across tool delta chunks', () => {
      const states = new Map<number, { id: string; name: string }>();

      const startChunk = adapter.parseStreamEvent(
        {
          type: 'content_block_start',
          index: 2,
          content_block: {
            type: 'tool_use',
            id: 'toolu_123',
            name: 'get_weather',
          },
        },
        {},
        states
      );

      const deltaChunk = adapter.parseStreamEvent(
        {
          type: 'content_block_delta',
          index: 2,
          delta: {
            type: 'input_json_delta',
            partial_json: '{"location":"Beijing"}',
          },
        },
        {},
        states
      );

      expect(startChunk?.choices?.[0]?.delta.tool_calls?.[0].id).toBe('toolu_123');
      expect(startChunk?.choices?.[0]?.delta.tool_calls?.[0].function.name).toBe('get_weather');
      expect(deltaChunk?.choices?.[0]?.delta.tool_calls?.[0].id).toBe('toolu_123');
      expect(deltaChunk?.choices?.[0]?.delta.tool_calls?.[0].function.name).toBe('get_weather');
      expect(deltaChunk?.choices?.[0]?.delta.tool_calls?.[0].function.arguments).toBe(
        '{"location":"Beijing"}'
      );
    });
  });

  describe('isStreamEndEvent', () => {
    it('should correctly identify stream end event', () => {
      expect(adapter.isStreamEndEvent({ type: 'message_stop' })).toBe(true);
      expect(adapter.isStreamEndEvent({ type: 'message_start' })).toBe(false);
      expect(adapter.isStreamEndEvent({ type: 'content_block_delta' })).toBe(false);
    });
  });
});

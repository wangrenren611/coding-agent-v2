/**
 * StandardAdapter test cases
 *
 * Verify Standard API adapter functionality, especially system parameter
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { StandardAdapter } from '../standard';
import type { LLMRequestMessage } from '../../types';

describe('StandardAdapter', () => {
  let adapter: StandardAdapter;

  beforeEach(() => {
    adapter = new StandardAdapter({
      defaultModel: 'gpt-4o',
      endpointPath: '/chat/completions',
    });
  });

  describe('getEndpointPath', () => {
    it('should return correct endpoint path', () => {
      expect(adapter.getEndpointPath()).toBe('/chat/completions');
    });
  });

  describe('getHeaders', () => {
    it('should return correct headers', () => {
      const headers = adapter.getHeaders('test-api-key');

      expect(headers.get('Content-Type')).toBe('application/json');
      expect(headers.get('Authorization')).toBe('Bearer test-api-key');
    });
  });

  describe('transformRequest', () => {
    it('should correctly transform basic request', () => {
      const messages: LLMRequestMessage[] = [{ role: 'user', content: 'Hello' }];

      const request = adapter.transformRequest({
        model: 'gpt-4o',
        messages,
        max_tokens: 1024,
      });

      expect(request.model).toBe('gpt-4o');
      expect(request.max_tokens).toBe(1024);
      expect(request.messages).toHaveLength(1);
    });

    it('should use default model when not provided', () => {
      const messages: LLMRequestMessage[] = [{ role: 'user', content: 'Hello' }];

      const request = adapter.transformRequest({
        messages,
      });

      expect(request.model).toBe('gpt-4o');
    });

    describe('system parameter', () => {
      it('should add system parameter as string to request body', () => {
        const messages: LLMRequestMessage[] = [{ role: 'user', content: 'Hello' }];

        const request = adapter.transformRequest({
          model: 'gpt-4o',
          messages,
          system: 'You are a helpful assistant.',
        });

        expect(request.system).toBe('You are a helpful assistant.');
      });

      it('should add system parameter as array to request body', () => {
        const messages: LLMRequestMessage[] = [{ role: 'user', content: 'Hello' }];

        const request = adapter.transformRequest({
          model: 'gpt-4o',
          messages,
          system: ['You are a helpful assistant.', 'Please respond in Chinese.'],
        });

        expect(request.system).toEqual([
          'You are a helpful assistant.',
          'Please respond in Chinese.',
        ]);
      });

      it('should filter empty strings from system array', () => {
        const messages: LLMRequestMessage[] = [{ role: 'user', content: 'Hello' }];

        const request = adapter.transformRequest({
          model: 'gpt-4o',
          messages,
          system: ['You are helpful.', '', 'Be concise.', ''],
        });

        expect(request.system).toEqual(['You are helpful.', 'Be concise.']);
      });

      it('should not add system if array is all empty strings', () => {
        const messages: LLMRequestMessage[] = [{ role: 'user', content: 'Hello' }];

        const request = adapter.transformRequest({
          model: 'gpt-4o',
          messages,
          system: ['', '', ''],
        });

        expect(request.system).toBeUndefined();
      });

      it('should not add system if string is empty', () => {
        const messages: LLMRequestMessage[] = [{ role: 'user', content: 'Hello' }];

        const request = adapter.transformRequest({
          model: 'gpt-4o',
          messages,
          system: '',
        });

        expect(request.system).toBeUndefined();
      });

      it('should not add system if undefined', () => {
        const messages: LLMRequestMessage[] = [{ role: 'user', content: 'Hello' }];

        const request = adapter.transformRequest({
          model: 'gpt-4o',
          messages,
        });

        expect(request.system).toBeUndefined();
      });

      it('should handle system with whitespace-only strings in array', () => {
        const messages: LLMRequestMessage[] = [{ role: 'user', content: 'Hello' }];

        const request = adapter.transformRequest({
          model: 'gpt-4o',
          messages,
          system: ['Helpful.', '   ', '\t', '\n'],
        });

        expect(request.system).toEqual(['Helpful.']);
      });
    });

    describe('tool_stream parameter', () => {
      it('should add tool_stream to request body when provided', () => {
        const messages: LLMRequestMessage[] = [{ role: 'user', content: 'Hello' }];

        const request = adapter.transformRequest({
          model: 'gpt-4o',
          messages,
          tool_stream: true,
        });

        expect(request.tool_stream).toBe(true);
      });

      it('should add tool_stream=false to request body when explicitly set', () => {
        const messages: LLMRequestMessage[] = [{ role: 'user', content: 'Hello' }];

        const request = adapter.transformRequest({
          model: 'gpt-4o',
          messages,
          tool_stream: false,
        });

        expect(request.tool_stream).toBe(false);
      });
    });
  });

  describe('transformResponse', () => {
    it('should correctly transform basic response', () => {
      const response = {
        id: 'chatcmpl-xxx',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello! How can I help you?',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      };

      const result = adapter.transformResponse(response);

      expect(result.id).toBe('chatcmpl-xxx');
      expect(result.model).toBe('gpt-4o');
      expect(result.choices).toHaveLength(1);
      expect(result.choices[0].message.content).toBe('Hello! How can I help you?');
      expect(result.choices[0].message.role).toBe('assistant');
      expect(result.choices[0].finish_reason).toBe('stop');
      expect(result.usage?.prompt_tokens).toBe(10);
      expect(result.usage?.completion_tokens).toBe(20);
    });

    it('should throw error when choices is empty', () => {
      const response = {
        id: 'chatcmpl-xxx',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o',
        choices: [],
      };

      expect(() => adapter.transformResponse(response)).toThrow('Empty choices');
    });

    it('should correctly handle tool call response', () => {
      const response = {
        id: 'chatcmpl-xxx',
        object: 'chat.completion',
        created: 1234567890,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [
                {
                  id: 'call_xxx',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"location":"Beijing"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      };

      const result = adapter.transformResponse(response);

      expect(result.choices[0].message.tool_calls).toBeDefined();
      expect(result.choices[0].message.tool_calls).toHaveLength(1);
      expect(result.choices[0].message.tool_calls?.[0].id).toBe('call_xxx');
      expect(result.choices[0].message.tool_calls?.[0].function.name).toBe('get_weather');
      expect(result.choices[0].finish_reason).toBe('tool_calls');
    });
  });
});

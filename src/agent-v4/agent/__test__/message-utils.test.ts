import { describe, expect, it } from 'vitest';
import { convertMessageToLLMMessage, mergeLLMConfig } from '../message-utils';
import type { Message } from '../../types';

const createMessage = (overrides: Partial<Message> = {}): Message => ({
  messageId: 'msg_1',
  type: 'user',
  role: 'user',
  content: '',
  timestamp: Date.now(),
  ...overrides,
});

describe('convertMessageToLLMMessage', () => {
  it('converts basic message', () => {
    const message = createMessage({
      role: 'user',
      content: 'Hello',
    });

    const result = convertMessageToLLMMessage(message);

    expect(result.role).toBe('user');
    expect(result.content).toBe('Hello');
  });

  it('converts message with tool_call_id', () => {
    const message = createMessage({
      role: 'tool',
      content: 'Tool result',
      tool_call_id: 'call_123',
    });

    const result = convertMessageToLLMMessage(message);

    expect(result.role).toBe('tool');
    expect(result.content).toBe('Tool result');
    expect(result.tool_call_id).toBe('call_123');
  });

  it('converts message with id', () => {
    const message = createMessage({
      role: 'assistant',
      content: 'Response',
      id: 'msg_123',
    });

    const result = convertMessageToLLMMessage(message);

    expect(result.id).toBe('msg_123');
  });

  it('converts message with reasoning_content', () => {
    const message = createMessage({
      role: 'assistant',
      content: 'Response',
      reasoning_content: 'Thinking...',
    });

    const result = convertMessageToLLMMessage(message);

    expect(result.reasoning_content).toBe('Thinking...');
  });

  it('converts message with valid tool_calls', () => {
    const message = createMessage({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          index: 0,
          function: {
            name: 'test',
            arguments: '{"key": "value"}',
          },
        },
      ],
    });

    const result = convertMessageToLLMMessage(message);

    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls![0].function.arguments).toBe('{"key": "value"}');
  });

  it('sanitizes invalid tool_calls arguments', () => {
    const message = createMessage({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          index: 0,
          function: {
            name: 'test',
            arguments: 'invalid json',
          },
        },
      ],
    });

    const result = convertMessageToLLMMessage(message);

    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls![0].function.arguments).toBe('{}');
  });

  it('sanitizes empty tool_calls arguments', () => {
    const message = createMessage({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          index: 0,
          function: {
            name: 'test',
            arguments: '',
          },
        },
      ],
    });

    const result = convertMessageToLLMMessage(message);

    expect(result.tool_calls![0].function.arguments).toBe('{}');
  });

  it('sanitizes whitespace-only tool_calls arguments', () => {
    const message = createMessage({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          index: 0,
          function: {
            name: 'test',
            arguments: '   ',
          },
        },
      ],
    });

    const result = convertMessageToLLMMessage(message);

    expect(result.tool_calls![0].function.arguments).toBe('{}');
  });

  it('handles non-string tool_calls arguments', () => {
    const message = createMessage({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          index: 0,
          function: {
            name: 'test',
            arguments: 123 as any,
          },
        },
      ],
    });

    const result = convertMessageToLLMMessage(message);

    expect(result.tool_calls![0].function.arguments).toBe('{}');
  });

  it('handles null tool_calls arguments', () => {
    const message = createMessage({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          index: 0,
          function: {
            name: 'test',
            arguments: null as any,
          },
        },
      ],
    });

    const result = convertMessageToLLMMessage(message);

    expect(result.tool_calls![0].function.arguments).toBe('{}');
  });

  it('handles undefined tool_calls arguments', () => {
    const message = createMessage({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          index: 0,
          function: {
            name: 'test',
            arguments: undefined as any,
          },
        },
      ],
    });

    const result = convertMessageToLLMMessage(message);

    expect(result.tool_calls![0].function.arguments).toBe('{}');
  });

  it('handles empty tool_calls array', () => {
    const message = createMessage({
      role: 'assistant',
      content: '',
      tool_calls: [],
    });

    const result = convertMessageToLLMMessage(message);

    expect(result.tool_calls).toEqual([]);
  });

  it('handles null tool_calls', () => {
    const message = createMessage({
      role: 'assistant',
      content: '',
      tool_calls: null as any,
    });

    const result = convertMessageToLLMMessage(message);

    expect(result.tool_calls).toBeNull();
  });

  it('handles undefined tool_calls', () => {
    const message = createMessage({
      role: 'assistant',
      content: '',
      tool_calls: undefined,
    });

    const result = convertMessageToLLMMessage(message);

    expect(result.tool_calls).toBeUndefined();
  });

  it('handles multiple tool_calls', () => {
    const message = createMessage({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          index: 0,
          function: {
            name: 'test1',
            arguments: '{"key1": "value1"}',
          },
        },
        {
          id: 'call_2',
          type: 'function',
          index: 1,
          function: {
            name: 'test2',
            arguments: 'invalid',
          },
        },
      ],
    });

    const result = convertMessageToLLMMessage(message);

    expect(result.tool_calls).toHaveLength(2);
    expect(result.tool_calls![0].function.arguments).toBe('{"key1": "value1"}');
    expect(result.tool_calls![1].function.arguments).toBe('{}');
  });

  it('preserves tool_call properties', () => {
    const message = createMessage({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          index: 0,
          function: {
            name: 'test',
            arguments: '{}',
          },
        },
      ],
    });

    const result = convertMessageToLLMMessage(message);

    expect(result.tool_calls![0].id).toBe('call_1');
    expect(result.tool_calls![0].type).toBe('function');
    expect(result.tool_calls![0].index).toBe(0);
    expect(result.tool_calls![0].function.name).toBe('test');
  });
});

describe('mergeLLMConfig', () => {
  it('returns undefined when all inputs are undefined', () => {
    const result = mergeLLMConfig(undefined, undefined, undefined);
    expect(result).toBeUndefined();
  });

  it('returns config when only config is provided', () => {
    const config = { model: 'gpt-4', temperature: 0.7 };
    const result = mergeLLMConfig(config, undefined, undefined);

    expect(result).toEqual(config);
  });

  it('adds tools to config', () => {
    const config = { model: 'gpt-4' };
    const tools = [
      {
        type: 'function' as const,
        function: { name: 'test', description: 'Test', parameters: {} },
      },
    ];
    const result = mergeLLMConfig(config, tools, undefined);

    expect(result).toEqual({
      model: 'gpt-4',
      tools,
    });
  });

  it('adds abortSignal to config', () => {
    const config = { model: 'gpt-4' };
    const abortSignal = new AbortController().signal;
    const result = mergeLLMConfig(config, undefined, abortSignal);

    expect(result).toEqual({
      model: 'gpt-4',
      abortSignal,
    });
  });

  it('adds both tools and abortSignal to config', () => {
    const config = { model: 'gpt-4' };
    const tools = [
      {
        type: 'function' as const,
        function: { name: 'test', description: 'Test', parameters: {} },
      },
    ];
    const abortSignal = new AbortController().signal;
    const result = mergeLLMConfig(config, tools, abortSignal);

    expect(result).toEqual({
      model: 'gpt-4',
      tools,
      abortSignal,
    });
  });

  it('handles empty tools array', () => {
    const config = { model: 'gpt-4' };
    const result = mergeLLMConfig(config, [], undefined);

    expect(result).toEqual({ model: 'gpt-4' });
  });

  it('handles null config', () => {
    const tools = [
      {
        type: 'function' as const,
        function: { name: 'test', description: 'Test', parameters: {} },
      },
    ];
    const result = mergeLLMConfig(null as any, tools, undefined);

    expect(result).toEqual({ tools });
  });

  it('handles undefined config with tools', () => {
    const tools = [
      {
        type: 'function' as const,
        function: { name: 'test', description: 'Test', parameters: {} },
      },
    ];
    const result = mergeLLMConfig(undefined, tools, undefined);

    expect(result).toEqual({ tools });
  });

  it('handles undefined config with abortSignal', () => {
    const abortSignal = new AbortController().signal;
    const result = mergeLLMConfig(undefined, undefined, abortSignal);

    expect(result).toEqual({ abortSignal });
  });

  it('handles undefined config with both tools and abortSignal', () => {
    const tools = [
      {
        type: 'function' as const,
        function: { name: 'test', description: 'Test', parameters: {} },
      },
    ];
    const abortSignal = new AbortController().signal;
    const result = mergeLLMConfig(undefined, tools, abortSignal);

    expect(result).toEqual({ tools, abortSignal });
  });

  it('preserves existing config properties', () => {
    const config = {
      model: 'gpt-4',
      temperature: 0.7,
      maxTokens: 1000,
      topP: 0.9,
    };
    const result = mergeLLMConfig(config, undefined, undefined);

    expect(result).toEqual(config);
  });

  it('overwrites tools in config', () => {
    const config = {
      model: 'gpt-4',
      tools: [
        {
          type: 'function' as const,
          function: { name: 'old', description: 'Old', parameters: {} },
        },
      ],
    };
    const newTools = [
      { type: 'function' as const, function: { name: 'new', description: 'New', parameters: {} } },
    ];
    const result = mergeLLMConfig(config, newTools, undefined);

    expect(result!.tools).toEqual(newTools);
  });

  it('overwrites abortSignal in config', () => {
    const oldSignal = new AbortController().signal;
    const newSignal = new AbortController().signal;
    const config = {
      model: 'gpt-4',
      abortSignal: oldSignal,
    };
    const result = mergeLLMConfig(config, undefined, newSignal);

    expect(result!.abortSignal).toBe(newSignal);
  });
});

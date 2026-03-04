/**
 * Anthropic API Adapter
 *
 * Supports Anthropic Claude API specification:
 * - Separate system field (not a message role)
 * - Unique authentication headers (x-api-key + anthropic-version)
 * - Different response and streaming formats
 */

import { BaseAPIAdapter } from './base';
import type {
  LLMRequest,
  LLMResponse,
  LLMRequestMessage,
  LLMResponseMessage,
  Chunk,
  MessageContent,
  ToolCall,
} from '../types';

/**
 * Anthropic content block
 */
interface AnthropicContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result';
  text?: string;
  source?: {
    type: 'base64' | 'url';
    media_type?: string;
    data?: string;
    url?: string;
  };
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | AnthropicContentBlock[];
  is_error?: boolean;
}

/**
 * Anthropic request message format
 */
interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

/**
 * Anthropic request body
 */
interface AnthropicRequestBody {
  model: string;
  max_tokens: number;
  system?: string;
  messages: AnthropicMessage[];
  stream?: boolean;
  tools?: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
  temperature?: number;
}

/**
 * Anthropic response format
 */
interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Anthropic stream event
 */
interface AnthropicStreamEvent {
  type: string;
  message?: AnthropicResponse;
  index?: number;
  content_block?: AnthropicContentBlock;
  delta?: {
    type: string;
    text?: string;
    stop_reason?: string;
    partial_json?: string;
  };
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * Anthropic API Adapter
 */
export class AnthropicAdapter extends BaseAPIAdapter {
  readonly endpointPath: string;
  readonly defaultModel: string;
  readonly apiVersion: string;

  constructor(options: { endpointPath?: string; defaultModel?: string; apiVersion?: string } = {}) {
    super();
    this.endpointPath = options.endpointPath ?? '/v1/messages';
    this.defaultModel = options.defaultModel ?? 'claude-opus-4-6-20250528';
    this.apiVersion = options.apiVersion ?? '2023-06-01';
  }

  /**
   * Transform request to Anthropic format
   */
  transformRequest(options?: LLMRequest): LLMRequest {
    if (!options) {
      return { model: this.defaultModel, messages: [] };
    }

    const { messages, tools, ...rest } = options;

    // Extract system messages
    let systemPrompt = '';
    const conversationMessages: LLMRequestMessage[] = [];

    for (const msg of messages || []) {
      if (msg.role === 'system') {
        const content = this.extractTextContent(msg.content);
        if (content) {
          systemPrompt += (systemPrompt ? '\n\n' : '') + content;
        }
      } else {
        conversationMessages.push(msg);
      }
    }
    // Convert message format
    const anthropicMessages = this.convertMessages(conversationMessages);

    const body: AnthropicRequestBody = {
      model: rest.model || this.defaultModel,
      max_tokens: rest.max_tokens || 4096,
      messages: anthropicMessages,
      stream: rest.stream ?? false,
    };
    if (systemPrompt) {
      body.system = systemPrompt;
    }
    if (rest.temperature !== undefined) {
      body.temperature = rest.temperature;
    }
    // convert tool definitions
    if (tools && tools.length > 0) {
      body.tools = tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters,
      }));
    }
    return body as unknown as LLMRequest;
  }
  /**
   * Transform response to standard format
   */
  transformResponse(response: unknown): LLMResponse {
    const anthropicResp = response as AnthropicResponse;
    // extract text content and tool calls
    const content: string[] = [];
    const toolCalls: ToolCall[] = [];
    for (const block of anthropicResp.content || []) {
      if (block.type === 'text' && block.text) {
        content.push(block.text);
      } else if (block.type === 'tool_use' && block.id && block.name) {
        toolCalls.push({
          id: block.id,
          type: 'function',
          index: toolCalls.length,
          function: {
            name: block.name,
            arguments: typeof block.input === 'string' ? block.input : JSON.stringify(block.input),
          },
        });
      }
    }
    const message: LLMResponseMessage = {
      role: 'assistant',
      content: content.join(''),
    };
    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }
    // convert stop_reason
    let finishReason: 'stop' | 'length' | 'tool_calls' | null = null;
    if (anthropicResp.stop_reason === 'end_turn') {
      finishReason = 'stop';
    } else if (anthropicResp.stop_reason === 'max_tokens') {
      finishReason = 'length';
    } else if (anthropicResp.stop_reason === 'tool_use') {
      finishReason = 'tool_calls';
    }
    return {
      id: anthropicResp.id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: anthropicResp.model,
      choices: [
        {
          index: 0,
          message,
          finish_reason: finishReason,
        },
      ],
      usage: {
        prompt_tokens: anthropicResp.usage?.input_tokens || 0,
        completion_tokens: anthropicResp.usage?.output_tokens || 0,
        total_tokens:
          (anthropicResp.usage?.input_tokens || 0) + (anthropicResp.usage?.output_tokens || 0),
      },
    };
  }
  /**
   * Get request headers
   */
  getHeaders(apiKey: string): Headers {
    return new Headers({
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': this.apiVersion,
    });
  }
  /**
   * Get endpoint path
   */
  getEndpointPath(): string {
    return this.endpointPath;
  }
  /**
   * Parse Anthropic stream response
   */
  async *parseStreamAsync(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<Chunk> {
    const decoder = new TextDecoder();
    let buffer = '';

    const baseChunk: Partial<Chunk> = {};
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (!data) continue;
          let event: AnthropicStreamEvent;
          try {
            event = JSON.parse(data);
          } catch {
            continue;
          }
          // update base chunk info
          if (event.type === 'message_start' && event.message) {
            baseChunk.id = event.message.id;
            baseChunk.model = event.message.model;
          }
          // check if stream end
          if (this.isStreamEndEvent(event)) {
            return;
          }
          // parse event
          const chunk = this.parseStreamEvent(event, baseChunk);
          if (chunk) {
            yield chunk;
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore lock release errors
      }
    }
  }
  /**
   * Parse stream event to standard Chunk
   */
  parseStreamEvent(event: AnthropicStreamEvent, baseChunk: Partial<Chunk>): Chunk | null {
    switch (event.type) {
      case 'message_start':
        return {
          id: event.message?.id || baseChunk.id || '',
          index: 0,
          model: event.message?.model || baseChunk.model || '',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: '' },
              finish_reason: null,
            },
          ],
        };
      case 'content_block_start':
        if (event.content_block?.type === 'tool_use') {
          return {
            ...baseChunk,
            index: event.index ?? 0,
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      id: event.content_block.id || '',
                      type: 'function',
                      index: event.index ?? 0,
                      function: {
                        name: event.content_block.name || '',
                        arguments: '',
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          } as Chunk;
        }
        return null;
      case 'content_block_delta':
        if (event.delta?.type === 'text_delta' && event.delta.text) {
          return {
            ...baseChunk,
            index: event.index ?? 0,
            choices: [
              {
                index: 0,
                delta: { role: 'assistant', content: event.delta.text },
                finish_reason: null,
              },
            ],
          } as Chunk;
        } else if (event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
          return {
            ...baseChunk,
            index: event.index ?? 0,
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      id: '',
                      type: 'function',
                      index: event.index ?? 0,
                      function: {
                        name: '',
                        arguments: event.delta.partial_json,
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          } as Chunk;
        }
        return null;
      case 'message_delta':
        return {
          ...baseChunk,
          index: 0,
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: '' },
              finish_reason: this.convertStopReason(event.delta?.stop_reason),
            },
          ],
          usage: event.usage
            ? {
                prompt_tokens: 0,
                completion_tokens: event.usage.output_tokens || 0,
                total_tokens: event.usage.output_tokens || 0,
              }
            : undefined,
        } as Chunk;
      case 'message_stop':
        return null;
      default:
        return null;
    }
  }
  /**
   * Check if stream end event
   */
  isStreamEndEvent(event: AnthropicStreamEvent): boolean {
    return event.type === 'message_stop';
  }
  /**
   * Convert messages to Anthropic format
   */
  private convertMessages(messages: LLMRequestMessage[]): AnthropicMessage[] {
    const result: AnthropicMessage[] = [];
    for (const msg of messages) {
      // handle tool response
      if (msg.role === 'tool' && msg.tool_call_id) {
        result.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.tool_call_id,
              content: this.extractTextContent(msg.content),
            },
          ],
        });
        continue;
      }
      // handle assistant message with tool calls
      const toolCalls = msg.tool_calls as ToolCall[] | undefined;
      if (msg.role === 'assistant' && toolCalls && toolCalls.length > 0) {
        const content: AnthropicContentBlock[] = [];
        const textContent = this.extractTextContent(msg.content);
        if (textContent) {
          content.push({ type: 'text', text: textContent });
        }
        for (const toolCall of toolCalls) {
          content.push({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.function.name,
            input: this.parseJsonSafe(toolCall.function.arguments) || {},
          });
        }
        result.push({ role: 'assistant', content });
        continue;
      }
      // handle normal message
      const content = this.convertContent(msg.content);
      result.push({
        role: msg.role as 'user' | 'assistant',
        content,
      });
    }
    return result;
  }
  /**
   * Convert content to Anthropic format
   */
  private convertContent(content: MessageContent): string | AnthropicContentBlock[] {
    if (typeof content === 'string') {
      return content;
    }
    if (!Array.isArray(content)) {
      return String(content);
    }
    const blocks: AnthropicContentBlock[] = [];
    for (const part of content) {
      if (part.type === 'text') {
        blocks.push({ type: 'text', text: part.text });
      } else if (part.type === 'image_url') {
        const imageUrl = part.image_url.url;
        if (imageUrl.startsWith('data:')) {
          const matches = imageUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (matches) {
            blocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: matches[1],
                data: matches[2],
              },
            });
          }
        } else {
          console.warn(
            'Anthropic does not support image URLs directly. Please use base64 encoding.'
          );
        }
      }
    }
    return blocks.length === 1 && blocks[0].type === 'text' ? (blocks[0].text ?? '') : blocks;
  }
  /**
   * Extract text content
   */
  private extractTextContent(content: MessageContent): string {
    if (typeof content === 'string') {
      return content;
    }
    if (Array.isArray(content)) {
      return content
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map((part) => part.text)
        .join('');
    }
    return '';
  }
  /**
   * Safe JSON parse
   */
  private parseJsonSafe(str: string): Record<string, unknown> | null {
    try {
      return JSON.parse(str);
    } catch {
      return null;
    }
  }
  /**
   * Convert stop_reason
   */
  private convertStopReason(
    reason: string | undefined
  ): 'stop' | 'length' | 'content_filter' | 'tool_calls' | null {
    if (!reason) return null;
    switch (reason) {
      case 'end_turn':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_calls';
      default:
        return null;
    }
  }
}

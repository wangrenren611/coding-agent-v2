import { BaseAPIAdapter } from './base';
import type {
  Chunk,
  InputContentPart,
  LLMRequest,
  LLMRequestMessage,
  LLMResponse,
  LLMResponseMessage,
  Tool,
  ToolCall,
  Usage,
} from '../types';

interface ResponsesInputTextPart {
  type: 'input_text';
  text: string;
}

interface ResponsesOutputTextPart {
  type: 'output_text';
  text: string;
}

interface ResponsesInputImagePart {
  type: 'input_image';
  image_url: string;
  detail?: 'auto' | 'low' | 'high';
}

interface ResponsesInputAudioPart {
  type: 'input_audio';
  input_audio: {
    data: string;
    format: 'wav' | 'mp3';
  };
}

interface ResponsesInputFilePart {
  type: 'input_file';
  file_id?: string;
  file_data?: string;
  filename?: string;
}

type ResponsesInputContentPart =
  | ResponsesInputTextPart
  | ResponsesOutputTextPart
  | ResponsesInputImagePart
  | ResponsesInputAudioPart
  | ResponsesInputFilePart;

interface ResponsesMessageItem {
  role: 'system' | 'user' | 'assistant';
  content: string | ResponsesInputContentPart[];
}

interface ResponsesFunctionCallItem {
  type: 'function_call';
  call_id: string;
  name: string;
  arguments: string;
}

interface ResponsesFunctionCallOutputItem {
  type: 'function_call_output';
  call_id: string;
  output: string;
}

type ResponsesInputItem =
  | ResponsesMessageItem
  | ResponsesFunctionCallItem
  | ResponsesFunctionCallOutputItem;

interface ResponsesTool {
  type: 'function';
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

interface ResponsesOutputTextContent {
  type: 'output_text';
  text?: string;
}

interface ResponsesOutputMessageItem {
  id?: string;
  type: 'message';
  role?: 'assistant';
  content?: ResponsesOutputTextContent[];
}

interface ResponsesOutputFunctionCallItem {
  id?: string;
  type: 'function_call';
  call_id?: string;
  name?: string;
  arguments?: string;
}

interface ResponsesUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}

interface ResponsesCompletedResponse {
  id?: string;
  created_at?: number;
  model?: string;
  output?: Array<ResponsesOutputMessageItem | ResponsesOutputFunctionCallItem | { type?: string }>;
  usage?: ResponsesUsage;
  response?: {
    id?: string;
    created_at?: number;
    model?: string;
    output?: Array<
      ResponsesOutputMessageItem | ResponsesOutputFunctionCallItem | { type?: string }
    >;
    usage?: ResponsesUsage;
  };
}

interface ResponsesStreamState {
  responseId?: string;
  model?: string;
  created: number;
  toolCalls: Map<number, { id?: string; name?: string }>;
}

interface ParsedSseEvent {
  type: string;
  data: Record<string, unknown>;
}

export class ResponsesAdapter extends BaseAPIAdapter {
  readonly endpointPath: string;
  readonly defaultModel: string;

  constructor(options: { endpointPath?: string; defaultModel?: string } = {}) {
    super();
    this.endpointPath = options.endpointPath ?? '/responses';
    this.defaultModel = options.defaultModel ?? 'gpt-5';
  }

  transformRequest(options?: LLMRequest): Record<string, unknown> {
    if (!options) {
      return {
        model: this.defaultModel,
        input: [],
        store: false,
      };
    }

    const {
      messages,
      max_tokens,
      model_reasoning_effort,
      stream_options,
      tool_stream,
      thinking,
      abortSignal,
      tools,
      ...rest
    } = options;
    void stream_options;
    void tool_stream;
    void thinking;
    void abortSignal;

    const extras = Object.fromEntries(
      Object.entries(rest).filter(([, value]) => value !== undefined)
    );

    const body: Record<string, unknown> = {
      ...extras,
      model: options.model || this.defaultModel,
      input: this.convertMessages(messages || []),
      store: false,
      stream: options.stream ?? false,
    };

    if (max_tokens !== undefined) {
      body.max_output_tokens = max_tokens;
    }

    if (model_reasoning_effort) {
      body.reasoning = {
        effort: model_reasoning_effort,
      };
    }

    if (tools && tools.length > 0) {
      body.tools = tools.map((tool) => this.convertTool(tool));
    }

    return body;
  }

  transformResponse(response: unknown): LLMResponse {
    const payload = this.unwrapResponse(response);
    const extracted = this.extractOutput(payload.output || []);
    const message: LLMResponseMessage = {
      role: 'assistant',
      content: extracted.text,
    };

    if (extracted.toolCalls.length > 0) {
      message.tool_calls = extracted.toolCalls;
    }

    return {
      id: payload.id || 'response',
      object: 'chat.completion',
      created: payload.created_at || Math.floor(Date.now() / 1000),
      model: payload.model || this.defaultModel,
      choices: [
        {
          index: 0,
          message,
          finish_reason: extracted.toolCalls.length > 0 ? 'tool_calls' : 'stop',
        },
      ],
      usage: this.mapUsage(payload.usage),
    };
  }

  getHeaders(apiKey: string): Headers {
    return new Headers({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    });
  }

  getEndpointPath(): string {
    return this.endpointPath;
  }

  async *parseStreamAsync(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<Chunk> {
    const decoder = new TextDecoder();
    let buffer = '';
    const state: ResponsesStreamState = {
      created: Math.floor(Date.now() / 1000),
      toolCalls: new Map(),
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer.trim()) {
            const event = this.parseSseBlock(buffer);
            const parsed = this.parseStreamEvent(event, state);
            if (parsed === 'done') {
              return;
            }
            if (parsed) {
              yield parsed;
            }
          }
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() ?? '';

        for (const block of blocks) {
          const event = this.parseSseBlock(block);
          const parsed = this.parseStreamEvent(event, state);
          if (parsed === 'done') {
            return;
          }
          if (parsed) {
            yield parsed;
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

  private convertMessages(messages: LLMRequestMessage[]): ResponsesInputItem[] {
    const cleaned = this.cleanMessage(messages as Array<Record<string, unknown>>);
    const items: ResponsesInputItem[] = [];

    for (const message of cleaned) {
      if (message.role === 'tool') {
        if (!message.tool_call_id) {
          continue;
        }
        items.push({
          type: 'function_call_output',
          call_id: message.tool_call_id,
          output: this.contentToText(message.content),
        });
        continue;
      }

      const content = this.convertContentParts(message.role, message.content);
      if (content.length > 0 && this.isResponsesMessageRole(message.role)) {
        items.push({
          role: message.role,
          content:
            message.role === 'assistant'
              ? this.normalizeAssistantContent(message.content, content)
              : content,
        });
      }

      if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
        for (const toolCall of message.tool_calls) {
          items.push({
            type: 'function_call',
            call_id: toolCall.id,
            name: toolCall.function.name,
            arguments: toolCall.function.arguments,
          });
        }
      }
    }

    return items;
  }

  private convertContentParts(
    role: LLMRequestMessage['role'],
    content: LLMRequestMessage['content']
  ): ResponsesInputContentPart[] {
    if (typeof content === 'string') {
      if (content === '') {
        return [];
      }
      return [
        {
          type: role === 'assistant' ? 'output_text' : 'input_text',
          text: content,
        },
      ];
    }

    if (!Array.isArray(content)) {
      return [];
    }

    const parts: ResponsesInputContentPart[] = [];
    for (const part of content) {
      const converted = this.convertContentPart(role, part);
      if (converted) {
        parts.push(converted);
      }
    }
    return parts;
  }

  private convertContentPart(
    role: LLMRequestMessage['role'],
    part: InputContentPart
  ): ResponsesInputContentPart | null {
    switch (part.type) {
      case 'text':
        return {
          type: role === 'assistant' ? 'output_text' : 'input_text',
          text: part.text,
        };
      case 'image_url':
        return {
          type: 'input_image',
          image_url: part.image_url.url,
          detail: part.image_url.detail,
        };
      case 'input_audio':
        return {
          type: 'input_audio',
          input_audio: part.input_audio,
        };
      case 'file':
        return {
          type: 'input_file',
          file_id: part.file.file_id,
          file_data: part.file.file_data,
          filename: part.file.filename,
        };
      case 'input_video':
        return {
          type: 'input_file',
          file_id: part.input_video.file_id,
          file_data: part.input_video.data,
          filename: undefined,
        };
      default:
        return null;
    }
  }

  private normalizeAssistantContent(
    originalContent: LLMRequestMessage['content'],
    converted: ResponsesInputContentPart[]
  ): string | ResponsesInputContentPart[] {
    if (typeof originalContent === 'string') {
      return originalContent;
    }

    if (
      converted.length > 0 &&
      converted.every(
        (part) =>
          part.type === 'output_text' ||
          part.type === 'input_audio' ||
          part.type === 'input_file' ||
          part.type === 'input_image'
      )
    ) {
      return converted;
    }

    return this.contentToText(originalContent);
  }

  private convertTool(tool: Tool): ResponsesTool {
    return {
      type: 'function',
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    };
  }

  private unwrapResponse(response: unknown) {
    const payload = response as ResponsesCompletedResponse;
    return payload.response ?? payload;
  }

  private extractOutput(
    output: Array<ResponsesOutputMessageItem | ResponsesOutputFunctionCallItem | { type?: string }>
  ): {
    text: string;
    toolCalls: ToolCall[];
  } {
    const texts: string[] = [];
    const toolCalls: ToolCall[] = [];

    for (const item of output) {
      if (item.type === 'message') {
        for (const part of item.content ?? []) {
          if (part.type === 'output_text' && typeof part.text === 'string') {
            texts.push(part.text);
          }
        }
      }

      if (item.type === 'function_call') {
        toolCalls.push({
          id: item.call_id || item.id || `call_${toolCalls.length}`,
          type: 'function',
          index: toolCalls.length,
          function: {
            name: item.name || '',
            arguments: item.arguments || '',
          },
        });
      }
    }

    return {
      text: texts.join(''),
      toolCalls,
    };
  }

  private mapUsage(usage?: ResponsesUsage): Usage | undefined {
    if (!usage) {
      return undefined;
    }

    const promptTokens = usage.input_tokens ?? 0;
    const completionTokens = usage.output_tokens ?? 0;

    return {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: usage.total_tokens ?? promptTokens + completionTokens,
    };
  }

  private parseSseBlock(block: string): ParsedSseEvent | null {
    const lines = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      return null;
    }

    let type = '';
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith('event:')) {
        type = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trim());
      } else if (line.startsWith('{')) {
        dataLines.push(line);
      }
    }

    const rawData = dataLines.join('\n');
    if (!rawData || rawData === '[DONE]') {
      return null;
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(rawData) as Record<string, unknown>;
    } catch {
      return null;
    }

    return {
      type: type || String(data.type || ''),
      data,
    };
  }

  private parseStreamEvent(
    event: ParsedSseEvent | null,
    state: ResponsesStreamState
  ): Chunk | 'done' | null {
    if (!event) {
      return null;
    }

    const { type, data } = event;

    if (type === 'response.created') {
      const response = (data.response as Record<string, unknown> | undefined) ?? data;
      state.responseId = this.readString(response.id) || state.responseId;
      state.model = this.readString(response.model) || state.model;
      state.created = this.readNumber(response.created_at) || state.created;
      return null;
    }

    if (type === 'response.output_item.added') {
      const item = data.item as Record<string, unknown> | undefined;
      if (item?.type !== 'function_call') {
        return null;
      }

      const outputIndex = this.readNumber(data.output_index) ?? 0;
      const toolCallId =
        this.readString(item.call_id) || this.readString(item.id) || `call_${outputIndex}`;
      const name = this.readString(item.name) || '';
      state.toolCalls.set(outputIndex, { id: toolCallId, name });

      return this.createChunk(state, {
        tool_calls: [
          {
            index: outputIndex,
            id: toolCallId,
            type: 'function',
            function: {
              name,
              arguments: '',
            },
          },
        ],
      });
    }

    if (type === 'response.function_call_arguments.delta') {
      const outputIndex = this.readNumber(data.output_index) ?? 0;
      const toolState = state.toolCalls.get(outputIndex) || {};
      const delta = this.readString(data.delta) || '';
      const name = this.readString(data.name) || toolState.name || '';
      const id = toolState.id || this.readString(data.call_id) || this.readString(data.item_id);

      state.toolCalls.set(outputIndex, { id, name });

      return this.createChunk(state, {
        tool_calls: [
          {
            index: outputIndex,
            id: id || `call_${outputIndex}`,
            type: 'function',
            function: {
              name,
              arguments: delta,
            },
          },
        ],
      });
    }

    if (type === 'response.output_text.delta') {
      const delta = this.readString(data.delta);
      if (!delta) {
        return null;
      }

      return this.createChunk(state, {
        content: delta,
      });
    }

    if (type === 'response.completed') {
      const payload = this.unwrapResponse(data);
      state.responseId = payload.id || state.responseId;
      state.model = payload.model || state.model;
      state.created = payload.created_at || state.created;

      return {
        id: state.responseId,
        index: 0,
        object: 'chat.completion.chunk',
        created: state.created,
        model: state.model,
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              content: '',
            },
            finish_reason: 'stop',
          },
        ],
        usage: this.mapUsage(payload.usage),
      };
    }

    if (type === 'response.failed') {
      const error = data.error as Record<string, unknown> | undefined;
      const message = this.readString(error?.message) || 'Responses stream failed';
      const errorCode = this.readString(error?.code);
      const errorType = this.readString(error?.type) || 'response.failed';
      return {
        id: state.responseId,
        index: 0,
        error: {
          code: errorCode,
          type: errorType,
          message,
        },
      };
    }

    return null;
  }

  private createChunk(
    state: ResponsesStreamState,
    delta: Partial<Pick<LLMResponseMessage, 'content' | 'tool_calls'>>
  ): Chunk {
    return {
      id: state.responseId,
      index: 0,
      object: 'chat.completion.chunk',
      created: state.created,
      model: state.model,
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            content: delta.content ?? '',
            tool_calls: delta.tool_calls,
          },
        },
      ],
    };
  }

  private isResponsesMessageRole(role: string): role is ResponsesMessageItem['role'] {
    return role === 'system' || role === 'user' || role === 'assistant';
  }

  private contentToText(content: LLMRequestMessage['content']): string {
    if (typeof content === 'string') {
      return content;
    }

    if (!Array.isArray(content)) {
      return '';
    }

    return content
      .map((part) => {
        switch (part.type) {
          case 'text':
            return part.text;
          case 'image_url':
            return part.image_url.url;
          case 'input_audio':
            return part.input_audio.data;
          case 'input_video':
            return part.input_video.url || part.input_video.file_id || part.input_video.data || '';
          case 'file':
            return part.file.file_id || part.file.filename || part.file.file_data || '';
          default:
            return '';
        }
      })
      .join('\n');
  }

  private readNumber(value: unknown): number | undefined {
    return typeof value === 'number' ? value : undefined;
  }

  private readString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }
}

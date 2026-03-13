import type { LLMRequestMessage, MessageContent, ToolCall } from '../../providers';
import type { AgentInput, Message } from '../types';

function hasNonEmptyTextContent(content: MessageContent | undefined): boolean {
  if (typeof content === 'string') {
    return content.trim().length > 0;
  }
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some((part) => {
    if (part.type === 'text') {
      return typeof part.text === 'string' && part.text.trim().length > 0;
    }
    return true;
  });
}

function hasNonEmptyReasoningContent(reasoningContent: string | undefined): boolean {
  return typeof reasoningContent === 'string' && reasoningContent.trim().length > 0;
}

export function shouldSendMessageToLLM(message: Message): boolean {
  if (message.role !== 'assistant' || message.type !== 'assistant-text') {
    return true;
  }

  const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
  if (hasToolCalls) {
    return true;
  }

  return (
    hasNonEmptyTextContent(message.content) ||
    hasNonEmptyReasoningContent(message.reasoning_content)
  );
}

export function convertMessageToLLMMessage(message: Message): LLMRequestMessage {
  return {
    role: message.role,
    content: message.content,
    tool_call_id: message.tool_call_id,
    tool_calls: sanitizeToolCallsForRequest(message.tool_calls),
    id: message.id,
    reasoning_content: message.reasoning_content,
  };
}

function sanitizeToolCallsForRequest(
  toolCalls: Message['tool_calls']
): LLMRequestMessage['tool_calls'] {
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    return toolCalls;
  }

  return toolCalls.map((toolCall) => ({
    ...toolCall,
    function: {
      ...toolCall.function,
      arguments: sanitizeToolCallArguments(toolCall.function?.arguments),
    },
  })) as ToolCall[];
}

function sanitizeToolCallArguments(argumentsText: unknown): string {
  if (typeof argumentsText !== 'string' || argumentsText.trim().length === 0) {
    return '{}';
  }

  try {
    JSON.parse(argumentsText);
    return argumentsText;
  } catch {
    return '{}';
  }
}

export function mergeLLMConfig(
  config: AgentInput['config'],
  tools?: AgentInput['tools'],
  abortSignal?: AbortSignal
): AgentInput['config'] {
  if (!config && !tools && !abortSignal) {
    return undefined;
  }

  const merged: NonNullable<AgentInput['config']> = {
    ...(config || {}),
  };

  if (tools && tools.length > 0) {
    merged.tools = tools;
  }

  if (abortSignal) {
    merged.abortSignal = abortSignal;
  }

  return merged;
}

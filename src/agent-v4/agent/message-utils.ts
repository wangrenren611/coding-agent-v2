import type { LLMRequestMessage } from '../../providers';
import type { AgentInput, Message } from '../types';

export function convertMessageToLLMMessage(message: Message): LLMRequestMessage {
  return {
    role: message.role,
    content: message.content,
    tool_call_id: message.tool_call_id,
    tool_calls: message.tool_calls,
    id: message.id,
    reasoning_content: message.reasoning_content,
  };
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

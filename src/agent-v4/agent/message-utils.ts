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
  abortSignal?: AbortSignal
): AgentInput['config'] {
  if (!abortSignal) {
    return config;
  }
  return {
    ...(config || {}),
    abortSignal,
  };
}

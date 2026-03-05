import { LLMError, isAbortedError, isPermanentError, type Usage } from '../../providers';
import type { ToolCall } from '../../core/types';

export function mergeToolCallDelta(
  currentToolCalls: ToolCall[],
  incomingToolCall: ToolCall,
  stepIndex: number
): ToolCall[] {
  const nextToolCalls = currentToolCalls.map((toolCall) => ({
    ...toolCall,
    function: { ...toolCall.function },
  }));

  const index = Number.isFinite(incomingToolCall?.index) ? incomingToolCall.index : 0;
  const incomingId =
    typeof incomingToolCall?.id === 'string' && incomingToolCall.id.trim().length > 0
      ? incomingToolCall.id
      : '';
  const incomingName =
    typeof incomingToolCall?.function?.name === 'string' ? incomingToolCall.function.name : '';
  const incomingArguments =
    typeof incomingToolCall?.function?.arguments === 'string'
      ? incomingToolCall.function.arguments
      : '';

  const existingIndex = nextToolCalls.findIndex((toolCall) => {
    if (incomingId && toolCall.id === incomingId) {
      return true;
    }
    return toolCall.index === index;
  });

  if (existingIndex === -1) {
    nextToolCalls.push({
      id: incomingId || `tool_call_${stepIndex}_${index}`,
      type: incomingToolCall?.type || 'function',
      index,
      function: {
        name: incomingName,
        arguments: incomingArguments,
      },
    });
    return nextToolCalls;
  }

  const existing = nextToolCalls[existingIndex];
  if (incomingId && existing.id !== incomingId) {
    existing.id = incomingId;
  }
  if (incomingName) {
    existing.function.name = existing.function.name || incomingName;
  }
  if (incomingArguments) {
    existing.function.arguments += incomingArguments;
  }

  return nextToolCalls;
}

export function accumulateUsage(
  stepUsage: Usage,
  totalUsage: Usage,
  chunkUsage?: Usage
): { stepUsage: Usage; totalUsage: Usage } {
  if (!chunkUsage) {
    return { stepUsage, totalUsage };
  }

  return {
    stepUsage: { ...chunkUsage },
    totalUsage: {
      ...totalUsage,
      prompt_tokens: totalUsage.prompt_tokens + chunkUsage.prompt_tokens,
      completion_tokens: totalUsage.completion_tokens + chunkUsage.completion_tokens,
      total_tokens: totalUsage.total_tokens + chunkUsage.total_tokens,
    },
  };
}

export type LoopErrorDisposition = 'throw_permanent' | 'abort' | 'retry' | 'throw_unknown';

export function classifyLoopError(error: Error, stateAborted: boolean): LoopErrorDisposition {
  if (isPermanentError(error)) {
    return 'throw_permanent';
  }

  if (isAbortedError(error) || stateAborted) {
    return 'abort';
  }

  if (error instanceof LLMError) {
    return 'retry';
  }

  return 'throw_unknown';
}

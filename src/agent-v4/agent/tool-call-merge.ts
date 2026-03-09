import type { ToolCall } from '../../providers';

export async function mergeToolCalls(params: {
  existing: ToolCall[];
  incoming: ToolCall[];
  messageId: string;
  onArgumentsChunk: (toolCall: ToolCall, argumentsChunk: string, messageId: string) => Promise<void>;
}): Promise<ToolCall[]> {
  const { existing, incoming, messageId, onArgumentsChunk } = params;
  const result = existing.map((call) => ({ ...call }));

  for (const newCall of incoming) {
    const existingCall = result.find((c) => c.id === newCall.id);
    if (existingCall) {
      if (!existingCall.function.name && newCall.function.name) {
        existingCall.function.name = newCall.function.name;
      }
      existingCall.function.arguments += newCall.function.arguments;
      await onArgumentsChunk(existingCall, newCall.function.arguments, messageId);
    } else {
      result.push({ ...newCall });
      await onArgumentsChunk(newCall, newCall.function.arguments, messageId);
    }
  }
  return result;
}

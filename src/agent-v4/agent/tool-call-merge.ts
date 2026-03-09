import type { ToolCall } from '../../providers';

export async function mergeToolCalls(params: {
  existing: ToolCall[];
  incoming: ToolCall[];
  messageId: string;
  onArgumentsChunk: (
    toolCall: ToolCall,
    argumentsChunk: string,
    messageId: string
  ) => Promise<void>;
}): Promise<ToolCall[]> {
  const { existing, incoming, messageId, onArgumentsChunk } = params;
  const result = existing.map((call) => ({
    ...call,
    function: {
      ...(call.function || {}),
      arguments: call.function?.arguments || '',
    },
  }));
  const byId = new Map<string, ToolCall>();
  const byIndex = new Map<number, ToolCall>();

  for (const call of result) {
    registerCallMaps(call, byId, byIndex);
  }

  for (const newCall of incoming) {
    const existingCall = findExistingCall(newCall, byId, byIndex);
    const argumentsChunk = newCall.function?.arguments || '';

    if (existingCall) {
      if (isPresent(newCall.id) && newCall.id !== existingCall.id) {
        if (isPresent(existingCall.id)) {
          byId.delete(existingCall.id);
        }
        existingCall.id = newCall.id;
        byId.set(newCall.id, existingCall);
      }
      if (isPresent(newCall.function?.name)) {
        existingCall.function.name = newCall.function.name;
      }
      if (isPresent(newCall.type)) {
        existingCall.type = newCall.type;
      }
      if (typeof newCall.index === 'number' && newCall.index !== existingCall.index) {
        if (typeof existingCall.index === 'number') {
          byIndex.delete(existingCall.index);
        }
        existingCall.index = newCall.index;
        byIndex.set(existingCall.index, existingCall);
      }
      existingCall.function.arguments += argumentsChunk;
      if (argumentsChunk) {
        await onArgumentsChunk(existingCall, argumentsChunk, messageId);
      }
    } else {
      const normalized = createToolCallFromLLM(newCall);
      result.push(normalized);
      registerCallMaps(normalized, byId, byIndex);
      if (argumentsChunk) {
        await onArgumentsChunk(normalized, argumentsChunk, messageId);
      }
    }
  }
  return result;
}

function registerCallMaps(
  call: ToolCall,
  byId: Map<string, ToolCall>,
  byIndex: Map<number, ToolCall>
): void {
  if (isPresent(call.id)) {
    byId.set(call.id, call);
  }
  if (typeof call.index === 'number') {
    byIndex.set(call.index, call);
  }
}

function findExistingCall(
  incoming: ToolCall,
  byId: Map<string, ToolCall>,
  byIndex: Map<number, ToolCall>
): ToolCall | undefined {
  if (isPresent(incoming.id)) {
    const matchedById = byId.get(incoming.id);
    if (matchedById) {
      return matchedById;
    }
  }
  if (typeof incoming.index === 'number') {
    return byIndex.get(incoming.index);
  }
  return undefined;
}

function createToolCallFromLLM(incoming: ToolCall): ToolCall {
  return {
    ...incoming,
    function: {
      ...(incoming.function || {}),
      arguments: incoming.function?.arguments || '',
    },
  };
}

function isPresent(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

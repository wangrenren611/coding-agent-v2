import type { AgentToolUseEvent } from './types';

const readToolCallId = (event: AgentToolUseEvent): string | undefined => {
  const maybeId = (event as { id?: unknown }).id;
  return typeof maybeId === 'string' && maybeId.length > 0 ? maybeId : undefined;
};

export class ToolCallBuffer {
  private readonly plannedOrder: string[] = [];
  private readonly plannedIds = new Set<string>();
  private readonly toolCallsById = new Map<string, AgentToolUseEvent>();
  private readonly emittedIds = new Set<string>();

  register(
    toolCall: AgentToolUseEvent,
    emit: (event: AgentToolUseEvent) => void,
    executing = false
  ) {
    const toolCallId = readToolCallId(toolCall);
    if (!toolCallId) {
      emit(toolCall);
      return;
    }

    this.toolCallsById.set(toolCallId, toolCall);
    if (!this.plannedIds.has(toolCallId)) {
      this.plannedIds.add(toolCallId);
      this.plannedOrder.push(toolCallId);
    }

    if (executing) {
      this.emit(toolCallId, emit);
    }
  }

  flush(emit: (event: AgentToolUseEvent) => void) {
    for (const toolCallId of this.plannedOrder) {
      this.emit(toolCallId, emit);
    }
  }

  ensureEmitted(toolCallId: string | undefined, emit: (event: AgentToolUseEvent) => void) {
    if (!toolCallId) {
      return;
    }
    this.emit(toolCallId, emit);
  }

  private emit(toolCallId: string, emit: (event: AgentToolUseEvent) => void) {
    if (this.emittedIds.has(toolCallId)) {
      return;
    }
    const toolCall = this.toolCallsById.get(toolCallId);
    if (!toolCall) {
      return;
    }
    this.emittedIds.add(toolCallId);
    emit(toolCall);
  }
}

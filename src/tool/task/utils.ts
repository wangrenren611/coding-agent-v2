import type { Message } from '../../core/types';
import type { BackgroundTaskStatus, ManagedTask, TaskStatus } from './types';

export function nowIso(): string {
  return new Date().toISOString();
}

export function uniqueStrings(values: string[]): string[] {
  const normalized = values.map((value) => value.trim()).filter((value) => value.length > 0);
  return Array.from(new Set(normalized));
}

export function compareTaskIds(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left) ? Number.parseInt(left, 10) : Number.NaN;
  const rightNumeric = /^\d+$/.test(right) ? Number.parseInt(right, 10) : Number.NaN;

  if (!Number.isNaN(leftNumeric) && !Number.isNaN(rightNumeric)) {
    return leftNumeric - rightNumeric;
  }
  if (!Number.isNaN(leftNumeric)) {
    return -1;
  }
  if (!Number.isNaN(rightNumeric)) {
    return 1;
  }
  return left.localeCompare(right);
}

export function nextManagedTaskId(tasks: ManagedTask[]): string {
  let maxNumericId = 0;
  for (const task of tasks) {
    if (!/^\d+$/.test(task.id)) {
      continue;
    }
    maxNumericId = Math.max(maxNumericId, Number.parseInt(task.id, 10));
  }
  return String(maxNumericId + 1);
}

export function isStatusTransitionAllowed(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) {
    return true;
  }

  const transitions: Record<TaskStatus, TaskStatus[]> = {
    pending: ['in_progress'],
    in_progress: ['completed'],
    completed: [],
  };
  return transitions[from].includes(to);
}

export function extractOpenDependencies(tasks: ManagedTask[], blockedBy: string[]): string[] {
  const openTaskIds = new Set(
    tasks.filter((task) => task.status !== 'completed').map((task) => task.id)
  );
  return uniqueStrings(blockedBy).filter((taskId) => openTaskIds.has(taskId));
}

export function applyMetadataPatch(
  current: Record<string, unknown> | undefined,
  patch: Record<string, unknown | null>
): Record<string, unknown> | undefined {
  const next: Record<string, unknown> = { ...(current ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete next[key];
      continue;
    }
    next[key] = value;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export function createBackgroundTaskId(): string {
  const random = Math.random().toString(16).slice(2, 10);
  return `task_${Date.now()}_${random}`;
}

export function buildSubTaskSessionId(parentSessionId: string, taskId: string): string {
  return `${parentSessionId}::subtask::${taskId}`;
}

export function isTerminalBackgroundStatus(status: BackgroundTaskStatus): boolean {
  return status === 'cancelled' || status === 'completed' || status === 'failed';
}

export function extractToolsUsed(messages: Message[]): string[] {
  const tools = new Set<string>();
  for (const message of messages) {
    if (!Array.isArray(message.tool_calls)) {
      continue;
    }
    for (const toolCall of message.tool_calls) {
      const toolName = toolCall?.function?.name;
      if (typeof toolName === 'string' && toolName.length > 0) {
        tools.add(toolName);
      }
    }
  }
  return Array.from(tools);
}

export function pickLastToolName(messages: Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!Array.isArray(message.tool_calls)) {
      continue;
    }
    for (let j = message.tool_calls.length - 1; j >= 0; j -= 1) {
      const toolName = message.tool_calls[j]?.function?.name;
      if (toolName) {
        return toolName;
      }
    }
  }
  return undefined;
}

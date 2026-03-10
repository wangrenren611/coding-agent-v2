import type {
  AgentLoopEvent,
  AgentStepEvent,
  AgentStopEvent,
  AgentToolConfirmEvent,
  AgentToolResultEvent,
  AgentToolStreamEvent,
  AgentToolUseEvent,
} from './types';

const MAX_TOOL_TEXT = 12000;

const stringify = (value: unknown): string => {
  if (value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const stringifyPretty = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const limitText = (value: string): string => {
  if (value.length <= MAX_TOOL_TEXT) {
    return value;
  }
  return `${value.slice(0, MAX_TOOL_TEXT)}\n... (truncated)`;
};

const hasNonEmptyText = (value: unknown): value is string => {
  return typeof value === 'string' && value.length > 0;
};

type ToolCallLike = {
  id?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
};

type ToolResultLike = {
  success?: boolean;
  data?: unknown;
  error?: string;
};

const asObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return value as Record<string, unknown>;
};

const toToolCall = (value: unknown): ToolCallLike => {
  const objectValue = asObject(value);
  const functionValue = asObject(objectValue.function);
  return {
    id: typeof objectValue.id === 'string' ? objectValue.id : undefined,
    function: {
      name: typeof functionValue.name === 'string' ? functionValue.name : undefined,
      arguments: typeof functionValue.arguments === 'string' ? functionValue.arguments : undefined,
    },
  };
};

const parseToolArguments = (raw?: string): Record<string, unknown> => {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return asObject(parsed);
  } catch {
    return { raw };
  }
};

const pickString = (value: unknown): string | undefined => {
  return typeof value === 'string' ? value : undefined;
};

const formatToolUseAsCode = (toolCall: ToolCallLike): string => {
  const toolName = toolCall.function?.name ?? 'tool';
  const callId = toolCall.id ?? 'unknown';
  const args = parseToolArguments(toolCall.function?.arguments);

  if (toolName === 'bash') {
    const command = pickString(args.command) ?? '';
    const timeout = args.timeout;
    const lines = [`# Tool: bash (${callId})`, `$ ${command}`];
    if (typeof timeout === 'number') {
      lines.push(`# timeout: ${timeout}ms`);
    }
    return lines.join('\n');
  }

  if (toolName.startsWith('file_')) {
    const path = pickString(args.path);
    const action = pickString(args.action);
    const lines = [`# Tool: ${toolName} (${callId})`];
    if (action) {
      lines.push(`# action: ${action}`);
    }
    if (path) {
      lines.push(`# path: ${path}`);
    }
    const rest = { ...args };
    delete rest.action;
    delete rest.path;
    if (Object.keys(rest).length > 0) {
      lines.push(stringifyPretty(rest));
    }
    return lines.join('\n');
  }

  return [`# Tool: ${toolName} (${callId})`, stringifyPretty(args)].join('\n');
};

const omitOutputField = (value: Record<string, unknown>): Record<string, unknown> => {
  const cloned = { ...value };
  delete cloned.output;
  delete cloned.summary;
  return cloned;
};

const formatToolResultAsCode = (
  event: AgentToolResultEvent,
  opts?: { suppressOutput?: boolean }
): string => {
  const toolCall = toToolCall(event.toolCall);
  const toolName = toolCall.function?.name ?? 'tool';
  const callId = toolCall.id ?? 'unknown';

  const result = asObject(event.result) as ToolResultLike;
  const data = asObject(result.data);
  const lines = [`# Result: ${toolName} (${callId}) ${result.success ? 'success' : 'error'}`];

  if (result.error) {
    lines.push(result.error);
  }

  const summary = pickString(data.summary);
  const output = pickString(data.output);
  if (!opts?.suppressOutput && hasNonEmptyText(output)) {
    lines.push(output);
    return limitText(lines.join('\n'));
  }

  if (summary) {
    lines.push(summary);
  }

  if (output === '') {
    if (!summary) {
      lines.push('no output');
    }
    return limitText(lines.join('\n'));
  }

  const normalizedData = opts?.suppressOutput ? omitOutputField(data) : data;
  if (Object.keys(normalizedData).length > 0) {
    lines.push(stringifyPretty(normalizedData));
    return limitText(lines.join('\n'));
  }

  if (opts?.suppressOutput && hasNonEmptyText(output)) {
    return limitText(lines.join('\n'));
  }

  const raw = stringifyPretty(event.result);
  if (raw) {
    lines.push(raw);
  }

  return limitText(lines.join('\n'));
};

export const formatToolConfirmEvent = (event: AgentToolConfirmEvent): string => {
  const reason = event.reason ? ` reason=${event.reason}` : '';
  const args = stringify(event.args);
  return `[tool-confirm:${event.toolName}:${event.toolCallId}]${reason} args=${args}`;
};

export const formatToolUseEvent = (event: AgentToolUseEvent): string => {
  return `[tool-use] ${stringify(event)}`;
};

export const formatToolUseEventCode = (event: AgentToolUseEvent): string => {
  return formatToolUseAsCode(toToolCall(event));
};

export const formatToolResultEvent = (event: AgentToolResultEvent): string => {
  return `[tool-result] ${stringify(event)}`;
};

export const formatToolResultEventCode = (
  event: AgentToolResultEvent,
  opts?: { suppressOutput?: boolean }
): string => {
  return formatToolResultAsCode(event, opts);
};

export const formatStepEvent = (event: AgentStepEvent): string => {
  const finish = event.finishReason ?? 'unknown';
  return `[step] index=${event.stepIndex} finishReason=${finish} toolCalls=${event.toolCallsCount}`;
};

export const formatLoopEvent = (event: AgentLoopEvent): string => {
  return `[loop] index=${event.loopIndex} steps=${event.steps}`;
};

export const formatStopEvent = (event: AgentStopEvent): string => {
  if (event.message) {
    return `[stop] reason=${event.reason} message=${event.message}`;
  }
  return `[stop] reason=${event.reason}`;
};

export const formatToolStreamEvent = (
  event: AgentToolStreamEvent
): { note?: string; codeChunk?: string; segmentKey?: string } => {
  const prefix = `[tool:${event.toolName}:${event.toolCallId}:${event.type}#${event.sequence}]`;

  if (event.type === 'stdout' || event.type === 'stderr') {
    const channel = event.type === 'stderr' ? 'stderr' : 'stdout';
    const chunk = event.content ?? '';
    return {
      codeChunk: chunk.endsWith('\n') ? chunk : `${chunk}\n`,
      segmentKey: `${event.toolCallId}:${channel}`,
    };
  }

  if (event.content) {
    return { note: `${prefix} ${event.content}` };
  }

  if (event.data !== undefined) {
    return { note: `${prefix} ${stringify(event.data)}` };
  }

  return { note: prefix };
};

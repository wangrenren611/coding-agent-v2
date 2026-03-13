import { ToolExecutionError } from './error';
import type { ToolResult } from './base-tool';

export function buildTaskFailure(
  code: string,
  message: string,
  details?: Record<string, unknown>
): ToolResult {
  const output = `${code}: ${message}`;
  return {
    success: false,
    output,
    error: new ToolExecutionError(output),
    metadata: {
      error: code,
      message,
      ...(details || {}),
    },
  };
}

export function buildTaskSuccess(payload: Record<string, unknown>): ToolResult {
  return {
    success: true,
    output: JSON.stringify(payload),
    metadata: payload,
  };
}

export function parsePrefixedError(message: string): { code: string; detail: string } {
  const matched = message.match(/^([A-Z][A-Z0-9_]{2,}):\s*(.*)$/);
  if (!matched) {
    return {
      code: 'TASK_OPERATION_FAILED',
      detail: message,
    };
  }
  return {
    code: matched[1],
    detail: matched[2],
  };
}

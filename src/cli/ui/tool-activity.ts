import path from 'node:path';
import type { ToolStreamEvent } from '../../tool';

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

export function isSubagentBubbleEvent(event: ToolStreamEvent): boolean {
  const data = toRecord(event.data);
  return data?.source === 'subagent';
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function normalizeText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function toTitle(text: string): string {
  const normalized = text.trim().replace(/[_-]+/g, ' ');
  if (!normalized) {
    return 'Tool';
  }
  return normalized
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function parseStartArgs(event: ToolStreamEvent): Record<string, unknown> {
  const data = toRecord(event.data);
  const raw = data?.arguments;

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return toRecord(parsed) ?? { arguments: raw };
    } catch {
      return { arguments: raw };
    }
  }

  if (toRecord(raw)) {
    return raw as Record<string, unknown>;
  }

  return {};
}

function formatFileCall(args: Record<string, unknown>): string {
  const action = typeof args.action === 'string' ? args.action : 'file';
  const path = typeof args.path === 'string' ? args.path : '';
  const pattern = typeof args.pattern === 'string' ? args.pattern : '';

  const actionMap: Record<string, string> = {
    read: 'Read',
    write: 'Write',
    edit: 'Edit',
    patch: 'Update',
    list: 'List',
    stat: 'Stat',
    search: 'Search',
    head: 'Head',
    tail: 'Tail',
  };

  const name = actionMap[action] ?? 'File';

  if (action === 'search' && path && pattern) {
    return `${name}(${truncate(`${path}, pattern=${pattern}`, 260)})`;
  }

  if (path) {
    return `${name}(${truncate(path, 260)})`;
  }

  return `${name}(${truncate(safeJson(args), 260)})`;
}

function formatTaskCall(args: Record<string, unknown>): string {
  const description =
    typeof args.description === 'string'
      ? normalizeText(args.description).replace(/\s+/g, ' ').trim()
      : '';
  if (description) {
    return `Task(${truncate(description, 180)})`;
  }

  const taskId = typeof args.task_id === 'string' ? args.task_id.trim() : '';
  if (taskId) {
    return `Task(task_id=${truncate(taskId, 120)})`;
  }

  const action =
    typeof args.action === 'string' && args.action.trim().length > 0 ? args.action.trim() : '';
  if (action) {
    return `Task(${truncate(action, 120)})`;
  }

  return 'Task';
}

export function formatToolCallLine(event: ToolStreamEvent): string {
  const args = parseStartArgs(event);

  if (event.toolName === 'bash') {
    const command =
      typeof args.command === 'string'
        ? normalizeText(args.command).replace(/\n+/g, ' && ').trim()
        : '';
    return `Bash(${truncate(command || safeJson(args), 260)})`;
  }

  if (event.toolName === 'file') {
    return formatFileCall(args);
  }

  if (event.toolName === 'task') {
    return formatTaskCall(args);
  }

  const title = toTitle(event.toolName);
  if (Object.keys(args).length === 0) {
    return title;
  }
  return `${title}(${truncate(safeJson(args), 260)})`;
}

export function formatToolOutputLines(
  content: string | undefined,
  transcriptMode: boolean,
  maxLines = 3
): { lines: string[]; hiddenLineCount: number } {
  if (!content) {
    return { lines: [], hiddenLineCount: 0 };
  }

  const lines = normalizeText(content)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return { lines: [], hiddenLineCount: 0 };
  }

  const visible = transcriptMode ? lines : lines.slice(0, maxLines);
  return {
    lines: visible.map((line) => truncate(line, 320)),
    hiddenLineCount: transcriptMode ? 0 : Math.max(0, lines.length - visible.length),
  };
}

export function formatToolOutputTailLines(
  content: string | undefined,
  transcriptMode: boolean,
  maxLines = 3
): { lines: string[]; hiddenLineCount: number } {
  if (!content) {
    return { lines: [], hiddenLineCount: 0 };
  }

  const lines = normalizeText(content)
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return { lines: [], hiddenLineCount: 0 };
  }

  const visible = transcriptMode ? lines : lines.slice(-maxLines);
  return {
    lines: visible.map((line) => truncate(line, 320)),
    hiddenLineCount: transcriptMode ? 0 : Math.max(0, lines.length - visible.length),
  };
}

function getResultRecord(data: unknown): Record<string, unknown> | null {
  const record = toRecord(data);
  return toRecord(record?.result);
}

function findTimeoutText(data: unknown): string | null {
  const record = toRecord(data);
  const candidates: string[] = [];

  if (typeof record?.error === 'string') {
    candidates.push(record.error);
  }

  const result = getResultRecord(data);
  if (typeof result?.error === 'string') {
    candidates.push(result.error);
  }

  const resultData = toRecord(result?.data);
  if (typeof resultData?.message === 'string') {
    candidates.push(resultData.message);
  }

  for (const text of candidates) {
    const matched = text.match(/timed out after\s+(\d+)ms/i);
    if (!matched) {
      continue;
    }
    const ms = Number(matched[1]);
    if (!Number.isFinite(ms) || ms <= 0) {
      continue;
    }
    if (ms % 60000 === 0) {
      return `(timeout ${ms / 60000}m)`;
    }
    if (ms >= 1000 && ms % 1000 === 0) {
      return `(timeout ${ms / 1000}s)`;
    }
    return `(timeout ${ms}ms)`;
  }

  return null;
}

function extractResultText(data: unknown): string {
  const result = getResultRecord(data);
  if (!result) {
    return '';
  }

  const payload = toRecord(result.data);
  if (typeof payload?.output === 'string' && payload.output.trim()) {
    return payload.output.trim();
  }
  if (typeof payload?.content === 'string' && payload.content.trim()) {
    return payload.content.trim();
  }
  if (payload) {
    return safeJson(payload);
  }

  const metadata = toRecord(result.metadata);
  if (typeof metadata?.message === 'string' && metadata.message.trim()) {
    return metadata.message.trim();
  }

  return '';
}

function formatFileEntryName(entry: Record<string, unknown>): string {
  const entryPath = typeof entry.path === 'string' ? entry.path : '';
  const name = entryPath ? path.basename(entryPath) : 'unknown';
  const isDirectory = entry.isDirectory === true;
  return isDirectory ? `${name}/` : name;
}

function formatFileToolResult(data: unknown): string {
  const result = getResultRecord(data);
  const payload = toRecord(result?.data);
  if (!payload) {
    return '';
  }

  if (Array.isArray(payload.entries)) {
    const targetPath = typeof payload.path === 'string' ? payload.path : '.';
    const entries = payload.entries.filter((item) => toRecord(item)) as Array<
      Record<string, unknown>
    >;
    const visible = entries.slice(0, 8).map((entry) => `- ${formatFileEntryName(entry)}`);
    const remaining = entries.length - visible.length;
    const header = `${targetPath} (${entries.length} entries)`;
    return [header, ...visible, remaining > 0 ? `... +${remaining} more` : '']
      .filter(Boolean)
      .join('\n');
  }

  if (Array.isArray(payload.matches)) {
    const targetPath = typeof payload.path === 'string' ? payload.path : '.';
    const matches = payload.matches.filter((item) => typeof item === 'string') as string[];
    const visible = matches.slice(0, 8).map((item) => `- ${item}`);
    const remaining = matches.length - visible.length;
    const header = `${targetPath} (${matches.length} matches)`;
    return [header, ...visible, remaining > 0 ? `... +${remaining} more` : '']
      .filter(Boolean)
      .join('\n');
  }

  if (payload.stats && toRecord(payload.stats)) {
    const stats = toRecord(payload.stats) ?? {};
    const targetPath = typeof payload.path === 'string' ? payload.path : '.';
    const size = typeof stats.size === 'number' ? `${stats.size} bytes` : 'unknown size';
    const kind = stats.isDirectory === true ? 'directory' : stats.isFile === true ? 'file' : 'path';
    return `${targetPath}\n- ${kind}\n- ${size}`;
  }

  return '';
}

function formatTaskToolResult(data: unknown): string {
  const result = getResultRecord(data);
  const payload = toRecord(result?.data);
  if (!payload) {
    return '';
  }

  const taskId = typeof payload.task_id === 'string' ? payload.task_id : '';
  const status = typeof payload.status === 'string' ? payload.status : '';
  const output = typeof payload.output === 'string' ? payload.output.trim() : '';
  const error = typeof payload.error === 'string' ? payload.error.trim() : '';

  const lines: string[] = [];
  if (taskId) {
    lines.push(`task_id=${taskId}`);
  }
  if (status) {
    lines.push(`status=${status}`);
  }
  if (output) {
    lines.push(`output=${truncate(normalizeText(output).replace(/\s+/g, ' '), 220)}`);
  }
  if (error) {
    lines.push(`error=${truncate(normalizeText(error).replace(/\s+/g, ' '), 220)}`);
  }

  return lines.join('\n');
}

function shouldSuppressEmptyBashSuccess(event: ToolStreamEvent): boolean {
  if (event.toolName !== 'bash') {
    return false;
  }
  const result = getResultRecord(event.data);
  if (!result || result.success !== true) {
    return false;
  }
  const payload = toRecord(result.data);
  if (!payload) {
    return false;
  }
  const output = typeof payload.output === 'string' ? payload.output.trim() : '';
  const content = typeof payload.content === 'string' ? payload.content.trim() : '';
  return output.length === 0 && content.length === 0;
}

export function extractToolErrorLine(event: ToolStreamEvent): string | null {
  const data = toRecord(event.data);
  if (typeof data?.error === 'string' && data.error.trim()) {
    return `Error ${truncate(data.error.trim(), 320)}`;
  }

  const result = getResultRecord(event.data);
  if (typeof result?.error === 'string' && result.error.trim()) {
    return `Error ${truncate(result.error.trim(), 320)}`;
  }

  if (event.content && event.content.trim()) {
    return `Error ${truncate(event.content.trim(), 320)}`;
  }

  return null;
}

export function formatToolEndLines(
  event: ToolStreamEvent,
  transcriptMode: boolean
): { lines: string[]; hiddenLineCount: number } {
  const resultLines: string[] = [];
  if (event.content && event.content.trim()) {
    const contentLines = formatToolOutputLines(event.content, transcriptMode, 2);
    resultLines.push(...contentLines.lines);
    return {
      lines: resultLines,
      hiddenLineCount: contentLines.hiddenLineCount,
    };
  }

  const timeoutText = findTimeoutText(event.data);
  if (timeoutText) {
    resultLines.push(timeoutText);
  }

  const result = getResultRecord(event.data);
  const success = typeof result?.success === 'boolean' ? result.success : undefined;

  if (success === false) {
    const errorLine = extractToolErrorLine(event);
    if (errorLine && !resultLines.includes(errorLine)) {
      resultLines.push(errorLine);
    }
    return { lines: resultLines, hiddenLineCount: 0 };
  }

  if (shouldSuppressEmptyBashSuccess(event)) {
    return { lines: resultLines, hiddenLineCount: 0 };
  }

  if (event.toolName === 'file') {
    const fileResultText = formatFileToolResult(event.data);
    if (fileResultText) {
      const formatted = formatToolOutputLines(fileResultText, transcriptMode, 9);
      resultLines.push(...formatted.lines);
      return {
        lines: resultLines,
        hiddenLineCount: formatted.hiddenLineCount,
      };
    }
  }

  if (event.toolName === 'task') {
    const taskResultText = formatTaskToolResult(event.data);
    if (taskResultText) {
      const formatted = formatToolOutputLines(taskResultText, transcriptMode, 6);
      resultLines.push(...formatted.lines);
      return {
        lines: resultLines,
        hiddenLineCount: formatted.hiddenLineCount,
      };
    }
  }

  const resultText = extractResultText(event.data);
  if (resultText) {
    const formatted = formatToolOutputLines(resultText, transcriptMode, 2);
    resultLines.push(...formatted.lines);
    return {
      lines: resultLines,
      hiddenLineCount: formatted.hiddenLineCount,
    };
  }

  return { lines: resultLines, hiddenLineCount: 0 };
}

export function formatGenericToolEventLine(event: ToolStreamEvent): string {
  if (event.content && event.content.trim()) {
    return truncate(event.content.trim(), 320);
  }
  if (event.data !== undefined) {
    return truncate(safeJson(event.data), 320);
  }
  return event.type;
}

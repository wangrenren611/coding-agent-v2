import type { AgentToolConfirmEvent } from '../agent/runtime/types';
import { getToolHiddenArgumentKeys, getToolDisplayName } from './tool-display-config';

export type ToolConfirmDialogContent = {
  summary: string;
  detail?: string;
  reason?: string;
  requestedPath?: string;
  allowedDirectories: string[];
  argumentItems: Array<{
    label: string;
    value: string;
    multiline?: boolean;
  }>;
};

const asRecord = (value: unknown): Record<string, unknown> => {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
};

const readString = (value: unknown): string | undefined => {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
};

const readStringArray = (value: unknown): string[] => {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
};

const stringifyPretty = (value: unknown): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const formatPathTarget = (value: unknown, fallback = '.'): string => {
  return readString(value) ?? fallback;
};

const parseJsonLike = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (
    trimmed.length < 2 ||
    !(
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    )
  ) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

const humanizeKey = (key: string): string => {
  return key
    .split('_')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
};

const formatArgumentValue = (
  value: unknown
): { value: string; multiline?: boolean } | undefined => {
  const normalized = parseJsonLike(value);

  if (typeof normalized === 'string') {
    return normalized.trim().length > 0
      ? {
          value: normalized,
          multiline: normalized.includes('\n'),
        }
      : undefined;
  }

  if (typeof normalized === 'number' || typeof normalized === 'boolean') {
    return { value: String(normalized) };
  }

  const pretty = stringifyPretty(normalized);
  if (!pretty) {
    return undefined;
  }

  return {
    value: pretty,
    multiline: true,
  };
};

const buildArgumentItems = (
  event: AgentToolConfirmEvent
): ToolConfirmDialogContent['argumentItems'] => {
  const hiddenKeys = new Set(getToolHiddenArgumentKeys(event.toolName));

  return Object.entries(asRecord(event.args)).flatMap(([key, value]) => {
    if (hiddenKeys.has(key)) {
      return [];
    }

    const formatted = formatArgumentValue(value);
    if (!formatted) {
      return [];
    }

    return [
      {
        label: humanizeKey(key),
        value: formatted.value,
        multiline: formatted.multiline,
      },
    ];
  });
};

const buildSummary = (event: AgentToolConfirmEvent): { summary: string; detail?: string } => {
  const args = asRecord(event.args);

  switch (event.toolName) {
    case 'bash': {
      const command = readString(args.command) ?? '(empty command)';
      const description = readString(args.description);
      return {
        summary: description ? `Run bash: ${description}` : 'Run bash command',
        detail: `$ ${command}`,
      };
    }
    case 'file_read':
      return { summary: `Read ${formatPathTarget(args.path)}` };
    case 'file_edit':
      return { summary: `Edit ${formatPathTarget(args.path)}` };
    case 'write_file':
      return { summary: `Write ${formatPathTarget(args.path)}` };
    case 'glob':
      return {
        summary: `Glob ${readString(args.pattern) ?? '*'}`,
        detail: `Path: ${formatPathTarget(args.path)}`,
      };
    case 'grep':
      return {
        summary: `Grep ${readString(args.pattern) ?? ''}`,
        detail: `Path: ${formatPathTarget(args.path)}`,
      };
    case 'task':
    case 'agent': {
      const displayName = getToolDisplayName(event.toolName).replace(/\s+run$/i, '');
      return {
        summary: `Run ${displayName} ${(readString(args.subagent_type) ?? 'agent').trim()}`,
        detail: readString(args.description),
      };
    }
    default:
      return { summary: `Call ${event.toolName}` };
  }
};

export const buildToolConfirmDialogContent = (
  event: AgentToolConfirmEvent
): ToolConfirmDialogContent => {
  const metadata = asRecord(event.metadata);
  const { summary, detail } = buildSummary(event);

  return {
    summary,
    detail,
    reason: readString(event.reason),
    requestedPath: readString(metadata.requestedPath),
    allowedDirectories: readStringArray(metadata.allowedDirectories),
    argumentItems: buildArgumentItems(event),
  };
};

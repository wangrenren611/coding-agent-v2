import { useState } from 'react';

import { uiTheme } from '../../ui/theme';
import { getToolDisplayIcon, getToolDisplayName } from '../tool-display-config';
import { CodeBlock } from './code-block';
import type { ToolSegmentGroup } from './segment-groups';

type AssistantToolGroupProps = {
  group: ToolSegmentGroup;
};

type ParsedToolUse = {
  name: string;
  callId: string;
  command?: string;
  details?: string;
  args?: Record<string, unknown> | null;
};

type ParsedToolResult = {
  name: string;
  callId: string;
  status: 'success' | 'error' | 'unknown';
  details?: string;
  summary?: string;
  output?: string;
  payload?: unknown;
  metadata?: unknown;
  error?: string;
};

type ToolSection = {
  label?: string;
  content: string;
  tone?: 'body' | 'code';
};

type SpecialToolPresentation = {
  toolLabel?: string;
  headerDetail?: string;
  sections: ToolSection[];
};

const COLLAPSIBLE_OUTPUT_LINES = 16;
const COLLAPSIBLE_OUTPUT_LABELS = new Set(['output', 'error', 'result', 'details']);

const asObjectLike = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const parseToolArgumentsObject = (raw?: string): Record<string, unknown> | null => {
  if (!raw) {
    return null;
  }
  try {
    return asObjectLike(JSON.parse(raw));
  } catch {
    return null;
  }
};

const parseToolUseFromData = (value: unknown): ParsedToolUse | null => {
  const toolCall = asObjectLike(value);
  const toolFunction = asObjectLike(toolCall?.function);
  if (!toolFunction) {
    return null;
  }
  const name = typeof toolFunction.name === 'string' ? toolFunction.name : undefined;
  const callId = typeof toolCall?.id === 'string' ? toolCall.id : undefined;
  if (!name || !callId) {
    return null;
  }

  const rawArguments =
    typeof toolFunction.arguments === 'string' ? toolFunction.arguments : undefined;
  const args = parseToolArgumentsObject(rawArguments);
  const command = name === 'bash' && typeof args?.command === 'string' ? args.command : undefined;

  return {
    name,
    callId,
    command,
    details: rawArguments,
    args,
  };
};

const parseToolUse = (content?: string, data?: unknown): ParsedToolUse | null => {
  const structured = parseToolUseFromData(data);
  if (structured) {
    return structured;
  }
  if (!content) {
    return null;
  }
  const lines = content.split('\n');
  const header = lines[0]?.trim();
  if (!header) {
    return null;
  }
  const match = header.match(/^# Tool:\s+(.+?)\s+\(([^)]+)\)$/);
  if (!match || !match[1] || !match[2]) {
    return null;
  }

  const [_, name, callId] = match;
  const bodyLines = lines.slice(1);
  const commandLine = bodyLines.find(line => line.trim().startsWith('$ '));
  const command = commandLine ? commandLine.trim().slice(2).trim() : undefined;
  const details = bodyLines
    .filter(line => !line.trim().startsWith('$ '))
    .join('\n')
    .trim();

  return {
    name,
    callId,
    command: command || undefined,
    details: details || undefined,
    args: parseJsonObject(details),
  };
};

const parseToolResultFromData = (value: unknown): ParsedToolResult | null => {
  const event = asObjectLike(value);
  const toolCall = asObjectLike(event?.toolCall);
  const toolFunction = asObjectLike(toolCall?.function);
  const result = asObjectLike(event?.result);
  const data = asObjectLike(result?.data);
  const name = typeof toolFunction?.name === 'string' ? toolFunction.name : undefined;
  const callId = typeof toolCall?.id === 'string' ? toolCall.id : undefined;
  if (!name || !callId) {
    return null;
  }

  const successValue = result?.success;
  const status = successValue === true ? 'success' : successValue === false ? 'error' : 'unknown';
  const summary = typeof data?.summary === 'string' ? data.summary : undefined;
  const output = typeof data?.output === 'string' ? data.output : undefined;
  const error = typeof result?.error === 'string' ? result.error : undefined;

  return {
    name,
    callId,
    status,
    details: output || summary || error,
    summary,
    output,
    payload: data?.payload,
    metadata: data?.metadata,
    error,
  };
};

const parseToolResult = (content?: string, data?: unknown): ParsedToolResult | null => {
  const structured = parseToolResultFromData(data);
  if (structured) {
    return structured;
  }
  if (!content) {
    return null;
  }
  const lines = content.split('\n');
  const header = lines[0]?.trim();
  if (!header) {
    return null;
  }
  const match = header.match(/^# Result:\s+(.+?)\s+\(([^)]+)\)\s+(success|error)$/);
  if (!match || !match[1] || !match[2] || !match[3]) {
    return null;
  }

  const [_, name, callId, status] = match;
  const details = lines.slice(1).join('\n').trim();

  return {
    name,
    callId,
    status: status === 'success' || status === 'error' ? status : 'unknown',
    details: details || undefined,
    ...(status === 'error' ? { error: details || undefined } : {}),
  };
};

const resolveToolIcon = (toolName: string): string => {
  return getToolDisplayIcon(toolName);
};

const mergeOutputLines = (
  group: ToolSegmentGroup,
  parsedResult: ParsedToolResult | null
): string => {
  const streamText = group.streams
    .map(segment => segment.content)
    .join('')
    .trim();
  const resultText = parsedResult?.output?.trim() || parsedResult?.details?.trim();
  if (streamText && resultText && streamText === resultText) {
    return streamText;
  }
  if (streamText && resultText) {
    return `${streamText}\n${resultText}`;
  }
  return streamText || resultText || parsedResult?.summary?.trim() || '';
};

const readObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const readArray = (value: unknown): unknown[] => {
  return Array.isArray(value) ? value : [];
};

const readString = (value: unknown): string | undefined => {
  return typeof value === 'string' ? value : undefined;
};

const readNumber = (value: unknown): number | undefined => {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const readBoolean = (value: unknown): boolean | undefined => {
  return typeof value === 'boolean' ? value : undefined;
};

const parseJsonObject = (content?: string): Record<string, unknown> | null => {
  if (!content) {
    return null;
  }
  try {
    return readObject(JSON.parse(content));
  } catch {
    return null;
  }
};

const parseJsonValue = (content?: string): unknown => {
  if (!content) {
    return undefined;
  }
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
};

const countEscapeMarkers = (value: string): number => {
  return (value.match(/\\r\\n|\\n|\\t|\\"|\\\\/g) ?? []).length;
};

const decodeEscapeSequencesOnce = (value: string): string => {
  return value
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
};

const normalizeToolDisplayText = (value: string): string => {
  let current = value.replace(/\r\n/g, '\n').trimEnd();
  for (let index = 0; index < 2; index += 1) {
    const next = decodeEscapeSequencesOnce(current);
    if (countEscapeMarkers(next) >= countEscapeMarkers(current)) {
      break;
    }
    current = next;
  }

  const parsed = parseJsonValue(current);
  if (parsed !== undefined && typeof parsed !== 'string') {
    try {
      return JSON.stringify(parsed, null, 2);
    } catch {
      return current;
    }
  }

  return current;
};

const resolveSectionLanguageHint = (
  toolName: string,
  section: Pick<ToolSection, 'label' | 'tone'>
): string | undefined => {
  if (section.tone !== 'code') {
    return undefined;
  }
  if (section.label === 'command') {
    return toolName === 'bash' ? 'bash' : undefined;
  }
  if (section.label === 'arguments') {
    return 'json';
  }
  return undefined;
};

const isCollapsibleResultSection = (section: ToolSection): boolean => {
  if (section.tone !== 'code') {
    return false;
  }

  if (!section.label) {
    return false;
  }

  return COLLAPSIBLE_OUTPUT_LABELS.has(section.label.toLowerCase());
};

const resolveStructuredResultObject = (
  result: ParsedToolResult | null
): Record<string, unknown> | null => {
  return (
    readObject(result?.payload) ?? readObject(result?.metadata) ?? parseJsonObject(result?.details)
  );
};

const formatToolName = (toolName: string): string => {
  return getToolDisplayName(toolName);
};

const truncate = (value: string, maxLength = 88): string => {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
};

const compactDetail = (value?: string, maxLength = 72): string | null => {
  if (!value) {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return null;
  }
  return truncate(normalized, maxLength);
};

const formatStatusLabel = (status?: string): string | null => {
  if (!status) {
    return null;
  }
  return status.replace(/_/g, ' ');
};

const formatTaskStatusIcon = (status?: string): string => {
  switch (status) {
    case 'completed':
      return '●';
    case 'in_progress':
    case 'running':
      return '◐';
    case 'pending':
    case 'queued':
      return '○';
    case 'cancelled':
      return '⊘';
    case 'failed':
    case 'timed_out':
      return '×';
    case 'paused':
      return '⏸';
    default:
      return '•';
  }
};

const formatSummaryMeta = (parts: Array<string | null | undefined>): string | null => {
  const filtered = parts.map(part => part?.trim()).filter((part): part is string => Boolean(part));
  return filtered.length > 0 ? filtered.join(' · ') : null;
};

const summarizeTaskRecord = (
  task: Record<string, unknown>,
  options?: { canStart?: Record<string, unknown> | null }
): string[] => {
  const subject =
    readString(task.subject) ?? readString(task.activeForm) ?? readString(task.id) ?? 'task';
  const id = readString(task.id);
  const status = readString(task.status);
  const priority = readString(task.priority);
  const progress = readNumber(task.effective_progress) ?? readNumber(task.progress);
  const owner = readString(task.owner);
  const blockers = readArray(task.blockers).length || readArray(task.blocked_by).length;
  const blocks = readArray(task.blocked_tasks).length || readArray(task.blocks).length;

  const lines = [`${formatTaskStatusIcon(status)} ${truncate(subject)}`];
  const meta = formatSummaryMeta([
    id,
    formatStatusLabel(status),
    priority,
    progress !== undefined ? `${Math.round(progress)}%` : null,
    owner ? `owner ${owner}` : null,
    blockers > 0 ? `${blockers} blocker${blockers === 1 ? '' : 's'}` : null,
    blocks > 0 ? `blocks ${blocks}` : null,
  ]);
  if (meta) {
    lines.push(meta);
  }

  const canStart = options?.canStart;
  if (canStart && readBoolean(canStart.canStart) === false) {
    const reason = readString(canStart.reason);
    if (reason) {
      lines.push(`blocked: ${truncate(reason, 96)}`);
    }
  }

  return lines;
};

const summarizeAgentRun = (
  run: Record<string, unknown>,
  extras?: Record<string, unknown>
): { lines: string[]; output?: string } => {
  const agentId = readString(run.agentId);
  const status = readString(run.status);
  const subagentType = readString(run.subagentType);
  const description = readString(run.description);
  const linkedTaskId = readString(run.linkedTaskId);
  const progress = readNumber(run.progress);
  const error = readString(run.error);
  const output = readString(run.output);

  const headline = description ?? agentId ?? 'agent run';
  const lines = [`${formatTaskStatusIcon(status)} ${truncate(headline)}`];
  const meta = formatSummaryMeta([
    agentId,
    formatStatusLabel(status),
    subagentType,
    progress !== undefined ? `${Math.round(progress)}%` : null,
    linkedTaskId ? `task ${linkedTaskId}` : null,
    readBoolean(extras?.completed) === false ? 'still running' : null,
    readBoolean(extras?.timeout_hit) === true ? 'timeout hit' : null,
    readNumber(extras?.waited_ms) !== undefined
      ? `${Math.round((readNumber(extras?.waited_ms) ?? 0) / 1000)}s waited`
      : null,
  ]);
  if (meta) {
    lines.push(meta);
  }
  if (error && !output) {
    lines.push(`error: ${truncate(error, 96)}`);
  }

  return {
    lines,
    output: output?.trim() ? output : undefined,
  };
};

const buildTaskHeaderDetail = (
  toolName: string,
  args: Record<string, unknown> | null
): string | null => {
  if (!args) {
    return null;
  }

  if (toolName === 'task_create') {
    const subject = readString(args.subject);
    return formatSummaryMeta([
      subject ? `create ${truncate(subject, 56)}` : null,
      readString(args.namespace),
      readString(args.priority),
      readArray(args.checkpoints).length > 0
        ? `${readArray(args.checkpoints).length} checkpoints`
        : null,
    ]);
  }

  if (toolName === 'task_get') {
    return formatSummaryMeta([
      `inspect ${readString(args.task_id) ?? 'task'}`,
      readBoolean(args.include_history) ? 'include history' : null,
    ]);
  }

  if (toolName === 'task_list') {
    const statuses = readArray(args.statuses)
      .map(value => readString(value))
      .filter(Boolean)
      .join(', ');
    return formatSummaryMeta([
      `list${readString(args.namespace) ? ` in ${readString(args.namespace)}` : ''}`,
      statuses ? `status ${statuses}` : null,
      readString(args.owner) ? `owner ${readString(args.owner)}` : null,
      readString(args.tag) ? `tag ${readString(args.tag)}` : null,
    ]);
  }

  if (toolName === 'task_update') {
    const changes: string[] = [`update ${readString(args.task_id) ?? 'task'}`];
    if (readString(args.status))
      changes.push(`status -> ${readString(args.status)?.replace(/_/g, ' ')}`);
    if (readNumber(args.progress) !== undefined)
      changes.push(`progress ${Math.round(readNumber(args.progress) ?? 0)}%`);
    if (readString(args.owner)) changes.push(`owner ${readString(args.owner)}`);
    if (readArray(args.add_blocked_by).length > 0)
      changes.push(`+${readArray(args.add_blocked_by).length} blockers`);
    if (readArray(args.remove_blocked_by).length > 0)
      changes.push(`-${readArray(args.remove_blocked_by).length} blockers`);
    return changes.join(' · ');
  }

  if (toolName === 'task_stop') {
    return formatSummaryMeta([
      `stop ${readString(args.task_id) ?? readString(args.agent_id) ?? 'agent run'}`,
      readBoolean(args.cancel_linked_task) !== false ? 'cancel linked tasks' : null,
    ]);
  }

  if (toolName === 'task_output') {
    return formatSummaryMeta([
      `watch ${readString(args.task_id) ?? readString(args.agent_id) ?? 'agent run'}`,
      readBoolean(args.block) === false ? 'non-blocking poll' : 'wait for completion',
    ]);
  }

  if (toolName === 'agent' || toolName === 'task') {
    const prompt = readString(args.prompt);
    const description = readString(args.description);
    return formatSummaryMeta([
      description ? truncate(description, 56) : prompt ? truncate(prompt, 56) : null,
      readString(args.subagent_type),
      readBoolean(args.run_in_background) ? 'background' : 'foreground',
      readString(args.linked_task_id) ? `task ${readString(args.linked_task_id)}` : null,
    ]);
  }

  return null;
};

const buildTaskResultSections = (
  toolName: string,
  result: ParsedToolResult | null
): ToolSection[] => {
  const resultDetails = result?.details?.trim();
  const summary = result?.summary?.trim();
  if (!resultDetails && !summary && !result?.payload && !result?.metadata) {
    return [];
  }

  if (result?.status === 'error') {
    return [
      {
        label: 'result',
        content: result?.error?.trim() || resultDetails || summary || 'task failed',
        tone: 'body',
      },
    ];
  }

  const payload = resolveStructuredResultObject(result);
  if (!payload) {
    return [
      {
        label: 'result',
        content: resultDetails || summary || '',
        tone: 'body',
      },
    ];
  }

  if (toolName === 'task_list') {
    const namespace = readString(payload.namespace) ?? 'default';
    const tasks = readArray(payload.tasks)
      .map(item => readObject(item))
      .filter((item): item is Record<string, unknown> => Boolean(item));
    const total = readNumber(payload.total) ?? tasks.length;
    const lines = [`${total} task${total === 1 ? '' : 's'} in ${namespace}`];
    tasks.slice(0, 5).forEach(task => {
      const summary = summarizeTaskRecord(task);
      if (summary[0]) {
        lines.push(summary[0]);
      }
      if (summary[1]) {
        lines.push(`  ${summary[1]}`);
      }
    });
    if (tasks.length > 5) {
      lines.push(`+${tasks.length - 5} more`);
    }
    return [{ label: 'result', content: lines.join('\n'), tone: 'body' }];
  }

  if (toolName === 'task_stop') {
    const run = readObject(payload.agent_run);
    const cancelledTaskIds = readArray(payload.cancelled_task_ids)
      .map(item => readString(item))
      .filter(Boolean);
    const sections: ToolSection[] = [];
    if (run) {
      sections.push({
        label: 'result',
        content: summarizeAgentRun(run).lines.join('\n'),
        tone: 'body',
      });
    }
    if (cancelledTaskIds.length > 0) {
      sections.push({
        label: 'cancelled',
        content: cancelledTaskIds.join(', '),
        tone: 'body',
      });
    }
    return sections;
  }

  if (toolName === 'task_output' || toolName === 'task' || toolName === 'agent') {
    const run = readObject(payload.agent_run);
    if (run) {
      const summary = summarizeAgentRun(run, payload);
      const sections: ToolSection[] = [
        {
          label: 'result',
          content: summary.lines.join('\n'),
          tone: 'body',
        },
      ];
      if (summary.output) {
        sections.push({
          label: 'output',
          content: summary.output,
          tone: 'body',
        });
      }
      return sections;
    }
  }

  const task = readObject(payload.task);
  if (task) {
    const canStart = readObject(payload.can_start) ?? readObject(task.can_start);
    return [
      {
        label: 'result',
        content: summarizeTaskRecord(task, { canStart }).join('\n'),
        tone: 'body',
      },
    ];
  }

  return [
    {
      label: 'result',
      content: resultDetails || summary || '',
      tone: 'body',
    },
  ];
};

const buildSearchHeaderDetail = (
  toolName: string,
  args: Record<string, unknown> | null
): string | null => {
  if (!args) {
    return null;
  }

  if (toolName === 'grep') {
    const pattern = readString(args.pattern);
    if (!pattern) {
      return null;
    }

    return formatSummaryMeta([
      JSON.stringify(pattern),
      readString(args.path) ? `in ${readString(args.path)}` : null,
      readString(args.glob) ? `glob ${readString(args.glob)}` : null,
      readNumber(args.max_results) !== undefined
        ? `limit ${Math.round(readNumber(args.max_results) ?? 0)}`
        : null,
      readNumber(args.timeout_ms) !== undefined
        ? `${Math.round((readNumber(args.timeout_ms) ?? 0) / 1000)}s timeout`
        : null,
    ]);
  }

  if (toolName === 'glob') {
    const pattern = readString(args.pattern);
    if (!pattern) {
      return null;
    }

    return formatSummaryMeta([
      pattern,
      readString(args.path) ? `in ${readString(args.path)}` : null,
      readBoolean(args.include_hidden) ? 'include hidden' : null,
      readNumber(args.max_results) !== undefined
        ? `limit ${Math.round(readNumber(args.max_results) ?? 0)}`
        : null,
    ]);
  }

  return null;
};

const buildSearchResultSections = (result: ParsedToolResult | null): ToolSection[] => {
  const summary = result?.summary?.trim();
  const output = result?.output?.trim() || result?.details?.trim();
  const metadata = readObject(result?.metadata) ?? readObject(result?.payload);

  if (!summary && !output && !metadata) {
    return [];
  }

  if (metadata) {
    const matchCount = readNumber(metadata.countMatches);
    const fileCount = readNumber(metadata.countFiles);
    const path = readString(metadata.path);
    const flags = formatSummaryMeta([
      matchCount !== undefined ? `${matchCount} matches` : null,
      fileCount !== undefined ? `${fileCount} files` : null,
      path ? `in ${path}` : null,
      readBoolean(metadata.truncated) ? 'truncated' : null,
      readBoolean(metadata.timed_out) ? 'timed out' : null,
    ]);
    if (summary && output && summary !== output && flags) {
      return [
        { label: 'result', content: summary, tone: 'body' },
        { label: 'details', content: `${flags}\n${output}`, tone: 'body' },
      ];
    }
  }

  return [
    {
      label: 'result',
      content: output || summary || '',
      tone: 'body',
    },
  ];
};

const buildSpecialToolPresentation = (
  toolName: string,
  parsedUse: ParsedToolUse | null,
  parsedResult: ParsedToolResult | null
): SpecialToolPresentation | null => {
  const args = parsedUse?.args ?? parseJsonObject(parsedUse?.details);
  if (toolName === 'agent' || toolName === 'task' || toolName.startsWith('task_')) {
    const sections = buildTaskResultSections(toolName, parsedResult);

    return {
      toolLabel: formatToolName(toolName),
      headerDetail: buildTaskHeaderDetail(toolName, args) ?? undefined,
      sections,
    };
  }

  if (toolName === 'grep' || toolName === 'glob') {
    const sections = buildSearchResultSections(parsedResult);

    return {
      toolLabel: formatToolName(toolName),
      headerDetail: buildSearchHeaderDetail(toolName, args) ?? undefined,
      sections,
    };
  }

  return null;
};

export const AssistantToolGroup = ({ group }: AssistantToolGroupProps) => {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const parsedUse = parseToolUse(group.use?.content, group.use?.data);
  const parsedResult = parseToolResult(group.result?.content, group.result?.data);
  const toolName = parsedUse?.name ?? parsedResult?.name ?? 'tool';
  const commandText = parsedUse?.command;
  const invocationDetails = parsedUse?.details;
  const icon = resolveToolIcon(toolName);
  const outputText = mergeOutputLines(group, parsedResult);
  const _hasInvocationDetails = Boolean(invocationDetails);
  const hasOutput = outputText.length > 0;
  const specialPresentation = buildSpecialToolPresentation(toolName, parsedUse, parsedResult);
  const titleDetail =
    specialPresentation?.headerDetail ??
    compactDetail(commandText, 64) ??
    compactDetail(invocationDetails, 64);
  const defaultSections: ToolSection[] = [];
  if (commandText && !titleDetail) {
    defaultSections.push({
      label: 'command',
      content: `$ ${commandText}`,
      tone: 'code',
    });
  }
  if (invocationDetails && !titleDetail) {
    defaultSections.push({
      label: 'arguments',
      content: invocationDetails,
      tone: 'code',
    });
  }
  if (hasOutput) {
    defaultSections.push({
      label: parsedResult?.status === 'error' ? 'error' : 'output',
      content: outputText,
      tone: 'code',
    });
  }
  const sections = specialPresentation?.sections ?? defaultSections;
  const hasBody = sections.length > 0;
  const statusText =
    parsedResult?.status === 'success'
      ? 'completed'
      : parsedResult?.status === 'error'
        ? 'error'
        : group.result
          ? 'finished'
          : 'running';

  return (
    <box flexDirection="column">
      <box paddingLeft={3}>
        <text fg={uiTheme.text} attributes={uiTheme.typography.note} wrapMode="word">
          <span fg={uiTheme.accent}>{icon}</span>{' '}
          {specialPresentation?.toolLabel ?? formatToolName(toolName)}
          {titleDetail ? <span fg={uiTheme.muted}>({titleDetail})</span> : null}
          <span fg={uiTheme.subtle}> ({statusText})</span>
        </text>
      </box>
      {hasBody ? (
        <box flexDirection="row" marginTop={1}>
          <box width={1} backgroundColor={uiTheme.divider} />
          <box
            flexGrow={1}
            backgroundColor={uiTheme.panel}
            paddingLeft={2}
            paddingRight={1}
            paddingTop={1}
            paddingBottom={1}
          >
            {sections.map((section, index) => {
              const content = normalizeToolDisplayText(section.content);
              const isCode = section.tone === 'code';
              const sectionId = `${toolName}:section:${index}`;
              const collapsible = isCollapsibleResultSection(section);
              const expanded = Boolean(expandedSections[sectionId]);

              return (
                <box
                  key={sectionId}
                  flexDirection="column"
                  paddingBottom={index < sections.length - 1 ? 1 : 0}
                >
                  {section.label ? (
                    isCode ? null : (
                      <text fg={uiTheme.muted} attributes={uiTheme.typography.note}>
                        {section.label}
                      </text>
                    )
                  ) : null}
                  {isCode ? (
                    <box>
                      <CodeBlock
                        content={content}
                        label={section.label}
                        languageHint={resolveSectionLanguageHint(toolName, section)}
                        collapsible={collapsible}
                        collapsedLines={COLLAPSIBLE_OUTPUT_LINES}
                        expanded={expanded}
                        onToggleExpanded={() => {
                          if (!collapsible) {
                            return;
                          }
                          setExpandedSections(previous => ({
                            ...previous,
                            [sectionId]: !previous[sectionId],
                          }));
                        }}
                      />
                    </box>
                  ) : (
                    <box marginTop={section.label ? 1 : 0}>
                      <text fg={uiTheme.text} attributes={uiTheme.typography.body} wrapMode="word">
                        {content}
                      </text>
                    </box>
                  )}
                </box>
              );
            })}
          </box>
        </box>
      ) : null}
    </box>
  );
};

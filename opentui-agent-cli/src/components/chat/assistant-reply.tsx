import { useEffect, useState } from 'react';

import type { AssistantReply as AssistantReplyType } from '../../types/chat';
import { uiTheme } from '../../ui/theme';
import { AssistantSegment } from './assistant-segment';
import { AssistantToolGroup } from './assistant-tool-group';
import { buildReplyRenderItems } from './segment-groups';

type AssistantReplyProps = {
  reply: AssistantReplyType;
};

export type AssistantReplyUsageItem = {
  icon: '↓' | '↑';
  value: string;
};

const renderStatus = (status: AssistantReplyType['status']) => {
  if (status === 'streaming') {
    return 'streaming';
  }
  if (status === 'error') {
    return 'error';
  }
  return undefined;
};

const formatDurationSeconds = (reply: AssistantReplyType, nowMs: number): string => {
  if (reply.status !== 'streaming') {
    return reply.durationSeconds.toFixed(1);
  }
  if (typeof reply.startedAtMs !== 'number') {
    return reply.durationSeconds.toFixed(1);
  }
  const elapsedSeconds = Math.max(0, (nowMs - reply.startedAtMs) / 1000);
  return Math.max(reply.durationSeconds, elapsedSeconds).toFixed(1);
};

const formatTokenCount = (tokens: number): string => {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  return `${(tokens / 1_000).toFixed(1)}k`;
};

const normalizeUsageTokens = (tokens: number | undefined): string | undefined => {
  if (typeof tokens !== 'number' || !Number.isFinite(tokens)) {
    return undefined;
  }
  return formatTokenCount(Math.max(0, Math.round(tokens)));
};

export const buildUsageItems = (
  reply: Pick<AssistantReplyType, 'usagePromptTokens' | 'usageCompletionTokens'>
): AssistantReplyUsageItem[] => {
  const items: AssistantReplyUsageItem[] = [];
  const promptTokens = normalizeUsageTokens(reply.usagePromptTokens);
  const completionTokens = normalizeUsageTokens(reply.usageCompletionTokens);

  if (promptTokens) {
    items.push({ icon: '↓', value: promptTokens });
  }
  if (completionTokens) {
    items.push({ icon: '↑', value: completionTokens });
  }

  return items;
};

export const AssistantReply = ({ reply }: AssistantReplyProps) => {
  const status = renderStatus(reply.status);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const items = buildReplyRenderItems(reply.segments);
  const isStreaming = reply.status === 'streaming';

  useEffect(() => {
    if (reply.status !== 'streaming') {
      return;
    }
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 100);
    return () => {
      clearInterval(timer);
    };
  }, [reply.status]);

  const durationText = formatDurationSeconds(reply, nowMs);
  const usageItems = buildUsageItems(reply);

  return (
    <box flexDirection="column" gap={1}>
      {items.map((item, index) =>
        item.type === 'tool' ? (
          <AssistantToolGroup
            key={`tool-group:${item.group.toolCallId}:${index}`}
            group={item.group}
          />
        ) : (
          <AssistantSegment key={item.segment.id} segment={item.segment} streaming={isStreaming} />
        )
      )}
      <box flexDirection="row" gap={1} paddingLeft={3}>
        <text fg={uiTheme.muted} attributes={uiTheme.typography.muted}>
          <span fg={uiTheme.accent}>▣</span> assistant
          <span fg={uiTheme.muted}> · {reply.modelLabel}</span>
          <span fg={uiTheme.muted}> · {durationText}s</span>
          {usageItems.map((item) => (
            <span key={`${item.icon}:${item.value}`} fg={uiTheme.muted}>
              {' · '}
              {item.icon} {item.value}
            </span>
          ))}
          {status ? <span fg={uiTheme.muted}> · {status}</span> : null}
        </text>
      </box>
    </box>
  );
};

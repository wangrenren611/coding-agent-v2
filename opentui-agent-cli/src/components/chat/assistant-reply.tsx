import { useEffect, useState } from 'react';

import type { AssistantReply as AssistantReplyType } from '../../types/chat';
import { uiTheme } from '../../ui/theme';
import { AssistantSegment } from './assistant-segment';
import { AssistantToolGroup } from './assistant-tool-group';
import { buildReplyRenderItems } from './segment-groups';

type AssistantReplyProps = {
  reply: AssistantReplyType;
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
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return `${tokens}`;
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
  const usageText =
    typeof reply.usageTotalTokens === 'number' && Number.isFinite(reply.usageTotalTokens)
      ? formatTokenCount(Math.max(0, Math.round(reply.usageTotalTokens)))
      : undefined;

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
          {usageText ? <span fg={uiTheme.muted}> · token {usageText}</span> : null}
          {status ? <span fg={uiTheme.muted}> · {status}</span> : null}
        </text>
      </box>
    </box>
  );
};

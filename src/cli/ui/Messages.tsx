import { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { ActivityEvent, ActivityLevel, ChatLine, ChatRole, PanelMode } from './types';

function RoleIcon({ role }: { role: Exclude<ChatRole, 'user'> }) {
  if (role === 'assistant') {
    return <Text color="green">●</Text>;
  }
  return <Text color="gray">●</Text>;
}

function ActivityLine({ event }: { event: ActivityEvent }) {
  const color: Record<ActivityLevel, 'gray' | 'yellow' | 'red' | 'cyan'> = {
    info: 'gray',
    warn: 'yellow',
    error: 'red',
    tool: 'cyan',
  };

  const indent = Math.max(0, event.indent ?? 0);
  const isToolTree = event.kind === 'tool_call' || event.kind === 'tool_output';
  const showTime = !isToolTree && event.level !== 'tool';
  const textColor =
    event.kind === 'tool_output' && event.level === 'tool' ? 'gray' : color[event.level];

  return (
    <Box paddingLeft={indent * 2}>
      {indent > 0 ? <Text color="gray">└ </Text> : <Text color={color[event.level]}>● </Text>}
      {showTime ? <Text color="gray">[{event.time}] </Text> : null}
      <Text color={textColor}>{event.text}</Text>
    </Box>
  );
}

function compressLine(text: string, transcriptMode: boolean): string {
  if (transcriptMode) {
    return text;
  }
  return text.length > 1200 ? `${text.slice(0, 1197)}...` : text;
}

function ChatLineView({ line, transcriptMode }: { line: ChatLine; transcriptMode: boolean }) {
  if (line.role === 'assistant' && line.text.trim().length === 0) {
    return null;
  }

  const lines = compressLine(line.text || ' ', transcriptMode).split('\n');
  const first = lines[0] ?? '';
  const rest = lines.slice(1);
  const isUser = line.role === 'user';
  const iconRole: Exclude<ChatRole, 'user'> = line.role === 'assistant' ? 'assistant' : 'system';
  const detailIndent = 2;

  return (
    <Box flexDirection="column" marginBottom={rest.length > 0 ? 1 : 0}>
      <Box>
        {isUser ? <Text color="gray">&gt;</Text> : <RoleIcon role={iconRole} />}
        <Text>{` ${first}`}</Text>
      </Box>
      {rest.map((item, index) => (
        <Box key={`${line.id}-${index}`} paddingLeft={detailIndent}>
          <Text>{item}</Text>
        </Box>
      ))}
    </Box>
  );
}

type TimelineItem =
  | { kind: 'message'; seq: number; message: ChatLine }
  | { kind: 'activity'; seq: number; activity: ActivityEvent };

export function Messages(props: {
  messages: ChatLine[];
  activities: ActivityEvent[];
  panelMode: PanelMode;
  transcriptMode: boolean;
}) {
  const { messages, activities, panelMode, transcriptMode } = props;

  const timelineItems = useMemo<TimelineItem[]>(() => {
    if (panelMode !== 'split') {
      return [];
    }

    const merged: TimelineItem[] = [
      ...messages.map((message) => ({
        kind: 'message' as const,
        seq: message.seq,
        message,
      })),
      ...activities.map((activity) => ({
        kind: 'activity' as const,
        seq: activity.seq,
        activity,
      })),
    ];

    merged.sort((left, right) => {
      if (left.seq !== right.seq) {
        return left.seq - right.seq;
      }
      if (left.kind === right.kind) {
        return 0;
      }
      return left.kind === 'message' ? -1 : 1;
    });

    return merged;
  }, [activities, messages, panelMode]);

  if (panelMode === 'conversation') {
    return (
      <Box marginTop={1} flexDirection="column">
        {messages.map((item) => (
          <ChatLineView key={item.id} line={item} transcriptMode={transcriptMode} />
        ))}
      </Box>
    );
  }

  if (panelMode === 'activity') {
    return (
      <Box marginTop={1} flexDirection="column">
        {activities.length === 0 ? <Text color="gray">(no activity)</Text> : null}
        {activities.map((event) => (
          <ActivityLine key={event.id} event={event} />
        ))}
      </Box>
    );
  }

  return (
    <Box marginTop={1} flexDirection="column">
      {timelineItems.length === 0 ? <Text color="gray">(no activity)</Text> : null}
      {timelineItems.map((item) => {
        if (item.kind === 'message') {
          return (
            <ChatLineView
              key={item.message.id}
              line={item.message}
              transcriptMode={transcriptMode}
            />
          );
        }
        return <ActivityLine key={item.activity.id} event={item.activity} />;
      })}
    </Box>
  );
}

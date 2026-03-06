import { Box, Text } from 'ink';
import { useMemo } from 'react';
import { DiffViewer, looksLikeDiff } from './DiffViewer';
import { hasTodoList, TodoList } from './Todo';
import { clipTimeline, mergeTimeline, splitTimelineByPendingTools } from './timeline';
import type {
  ActivityEvent,
  ActivityLevel,
  ChatLine,
  ChatRole,
  PanelMode,
  TimelineItem,
} from './types';

function InlineRichText({ text, color }: { text: string; color?: string }) {
  const tokenRegex = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  const parts = text.split(tokenRegex).filter(Boolean);

  return (
    <Text color={color}>
      {parts.map((part, index) => {
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <Text key={`${index}-${part}`} color="blueBright">
              {part.slice(1, -1)}
            </Text>
          );
        }

        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <Text key={`${index}-${part}`} bold>
              {part.slice(2, -2)}
            </Text>
          );
        }

        const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (linkMatch) {
          return (
            <Text key={`${index}-${part}`} color="blueBright">
              {linkMatch[1]}
            </Text>
          );
        }

        return <Text key={`${index}-${part}`}>{part}</Text>;
      })}
    </Text>
  );
}

function BlockLine({ text, color }: { text: string; color?: string }) {
  const bullet = text.match(/^\s*([-*])\s+(.+)$/);
  if (bullet) {
    return (
      <Box>
        <Text color="gray">- </Text>
        <InlineRichText text={bullet[2] ?? ''} color={color} />
      </Box>
    );
  }

  const numbered = text.match(/^\s*(\d+)\.\s+(.+)$/);
  if (numbered) {
    return (
      <Box>
        <Text color="gray">{`${numbered[1]}. `}</Text>
        <InlineRichText text={numbered[2] ?? ''} color={color} />
      </Box>
    );
  }

  return <InlineRichText text={text} color={color} />;
}

function RoleBullet({ role }: { role: Exclude<ChatRole, 'user'> }) {
  if (role === 'assistant') {
    return <Text color="gray">● </Text>;
  }
  return <Text color="yellow">● </Text>;
}

function splitToolCallHeadline(line: string): { toolName: string; detail: string } | null {
  const match = line.match(/^([^(]+)\((.*)\)$/);
  if (!match) {
    return null;
  }
  return {
    toolName: match[1]?.trim() ?? '',
    detail: match[2] ?? '',
  };
}

function ActivityLine({ event }: { event: ActivityEvent }) {
  const color: Record<ActivityLevel, 'yellow' | 'red' | undefined> = {
    info: undefined,
    warn: 'yellow',
    error: 'red',
    tool: undefined,
  };

  const levelColor = color[event.level];
  const lines = event.text.split('\n');
  const firstLine = lines[0] ?? '';
  const rest = lines.slice(1);

  if (event.kind === 'tool_call') {
    const headline = splitToolCallHeadline(firstLine);
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text color="green">⏺ </Text>
          {headline ? (
            <>
              <Text bold>{headline.toolName}</Text>
              <Text>{`(${headline.detail})`}</Text>
            </>
          ) : (
            <InlineRichText text={firstLine} />
          )}
        </Box>
        {rest.map((line, index) => (
          <Box key={`${event.id}-tool-call-${index}`}>
            <Text color="gray"> ⎿ </Text>
            <InlineRichText text={line} />
          </Box>
        ))}
      </Box>
    );
  }

  if (event.kind === 'tool_output') {
    const outputColor = event.level === 'error' ? 'red' : 'gray';
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text color="gray"> ⎿ </Text>
          <InlineRichText text={firstLine} color={outputColor} />
        </Box>
        {rest.map((line, index) => (
          <Box key={`${event.id}-tool-out-${index}`}>
            <Text color="gray"> </Text>
            <InlineRichText text={line} color={outputColor} />
          </Box>
        ))}
      </Box>
    );
  }

  return (
    <Box marginBottom={1}>
      <Text color={levelColor}>● </Text>
      <InlineRichText text={event.text} color={levelColor} />
    </Box>
  );
}

function UserLineView({ line }: { line: ChatLine }) {
  const lines = line.text.split('\n');
  const first = lines[0] ?? '';
  const rest = lines.slice(1);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color="white" backgroundColor="gray">{`› ${first}`}</Text>
      {rest.map((item, index) => (
        <Box key={`${line.id}-user-${index}`} paddingLeft={2}>
          <BlockLine text={item} color="white" />
        </Box>
      ))}
    </Box>
  );
}

function AssistantLineView({ line }: { line: ChatLine }) {
  if (line.role === 'assistant' && line.text.trim().length === 0) {
    return null;
  }

  if (line.role === 'assistant' && looksLikeDiff(line.text)) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <RoleBullet role="assistant" />
          <Text>diff</Text>
        </Box>
        <Box paddingLeft={2}>
          <DiffViewer content={line.text} transcriptMode={false} />
        </Box>
      </Box>
    );
  }

  if (line.role === 'assistant' && hasTodoList(line.text)) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <RoleBullet role="assistant" />
          <Text>checklist</Text>
        </Box>
        <Box paddingLeft={2}>
          <TodoList content={line.text} />
        </Box>
      </Box>
    );
  }

  const lines = line.text.split('\n');
  const first = lines[0] ?? '';
  const rest = lines.slice(1);
  const roleColor = line.role === 'assistant' ? undefined : 'gray';
  const role = line.role === 'assistant' ? 'assistant' : 'system';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <RoleBullet role={role} />
        <BlockLine text={first} color={roleColor} />
      </Box>
      {rest.map((item, index) => (
        <Box key={`${line.id}-detail-${index}`} paddingLeft={2}>
          <BlockLine text={item} color={roleColor} />
        </Box>
      ))}
    </Box>
  );
}

function TimelineView({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <>
      {items.map((item) => {
        if (item.kind === 'message') {
          if (item.message.role === 'user') {
            return <UserLineView key={`message-${item.message.id}`} line={item.message} />;
          }
          return <AssistantLineView key={`message-${item.message.id}`} line={item.message} />;
        }
        return <ActivityLine key={`activity-${item.activity.id}`} event={item.activity} />;
      })}
    </>
  );
}

export function Messages(props: {
  messages: ChatLine[];
  activities: ActivityEvent[];
  panelMode: PanelMode;
  transcriptMode: boolean;
  maxTimelineItems?: number;
}) {
  const { messages, activities, panelMode, transcriptMode, maxTimelineItems = 160 } = props;

  const timeline = useMemo(
    () => clipTimeline(mergeTimeline(messages, activities), maxTimelineItems),
    [activities, maxTimelineItems, messages]
  );

  const splitTimeline = useMemo(() => splitTimelineByPendingTools(timeline), [timeline]);
  const visibleMessages = useMemo(
    () => messages.slice(-(transcriptMode ? maxTimelineItems : 72)),
    [maxTimelineItems, messages, transcriptMode]
  );
  const visibleActivities = useMemo(
    () => activities.slice(-(transcriptMode ? maxTimelineItems : 72)),
    [activities, maxTimelineItems, transcriptMode]
  );

  if (panelMode === 'conversation') {
    return (
      <Box marginTop={1} flexDirection="column">
        {visibleMessages.map((item) =>
          item.role === 'user' ? (
            <UserLineView key={item.id} line={item} />
          ) : (
            <AssistantLineView key={item.id} line={item} />
          )
        )}
      </Box>
    );
  }

  if (panelMode === 'activity') {
    return (
      <Box marginTop={1} flexDirection="column">
        {visibleActivities.length === 0 ? <Text color="gray">(no activity)</Text> : null}
        {visibleActivities.map((event) => (
          <ActivityLine key={event.id} event={event} />
        ))}
      </Box>
    );
  }

  return (
    <Box marginTop={1} flexDirection="column">
      {timeline.length === 0 ? <Text color="gray">(no activity)</Text> : null}
      <TimelineView items={splitTimeline.completedItems} />
      <TimelineView items={splitTimeline.pendingItems} />
    </Box>
  );
}

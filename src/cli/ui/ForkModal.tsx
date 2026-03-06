import { Box, Text, useInput } from 'ink';
import { useMemo, useState } from 'react';
import type { HistoryMessage } from '../../storage';

function previewText(value: unknown): string {
  if (typeof value === 'string') {
    return value.replace(/\s+/g, ' ').trim();
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

export function ForkModal(props: {
  history: HistoryMessage[];
  onClose: () => void;
  onConfirm: (messageId: string) => Promise<void> | void;
}) {
  const { history, onClose, onConfirm } = props;
  const items = useMemo(
    () =>
      history
        .filter((item) => item.role === 'user')
        .map((item) => ({
          messageId: item.messageId,
          sequence: item.sequence,
          text: previewText(item.content),
        })),
    [history]
  );
  const [selectedIndex, setSelectedIndex] = useState(Math.max(0, items.length - 1));

  useInput((input, key) => {
    if (key.escape) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((prev) => Math.min(prev + 1, Math.max(0, items.length - 1)));
      return;
    }
    if (key.return) {
      const selected = items[selectedIndex];
      if (selected) {
        void onConfirm(selected.messageId);
      }
      return;
    }
    if (input.toLowerCase() === 'q') {
      onClose();
    }
  });

  return (
    <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text color="cyan" bold>
        Fork Session
      </Text>
      <Text color="gray">Create a new session from a previous user message.</Text>
      <Box marginTop={1} flexDirection="column">
        {items.length === 0 ? <Text color="gray">(no user messages)</Text> : null}
        {items
          .slice(Math.max(0, selectedIndex - 6), Math.max(0, selectedIndex - 6) + 8)
          .map((item) => {
            const actualIndex = items.findIndex((entry) => entry.messageId === item.messageId);
            const selected = actualIndex === selectedIndex;
            return (
              <Box key={item.messageId}>
                <Text color={selected ? 'cyan' : 'gray'}>{selected ? '❯ ' : '  '}</Text>
                <Text bold={selected}>{`[${item.sequence}] `}</Text>
                <Text>{item.text.length > 88 ? `${item.text.slice(0, 85)}...` : item.text}</Text>
              </Box>
            );
          })}
      </Box>
      <Text color="gray">keys: ↑/↓ choose, Enter fork, Esc cancel</Text>
    </Box>
  );
}

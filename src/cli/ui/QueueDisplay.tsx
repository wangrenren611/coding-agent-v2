import { Box, Text } from 'ink';

export function QueueDisplay(props: { queuedMessages: string[] }) {
  const { queuedMessages } = props;
  if (queuedMessages.length === 0) {
    return null;
  }

  return (
    <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow">Queued Messages ({queuedMessages.length})</Text>
      {queuedMessages.slice(-3).map((item, idx) => (
        <Text key={`${idx}-${item.slice(0, 8)}`} color="gray">
          {idx + 1}. {item.length > 80 ? `${item.slice(0, 77)}...` : item}
        </Text>
      ))}
    </Box>
  );
}

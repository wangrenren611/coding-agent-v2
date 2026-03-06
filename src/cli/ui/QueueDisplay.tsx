import { Box, Text } from 'ink';

export function QueueDisplay(props: { queuedMessages: string[] }) {
  const { queuedMessages } = props;
  if (queuedMessages.length === 0) {
    return null;
  }

  return (
    <Box marginTop={1} flexDirection="column">
      <Text color="yellow">queue</Text>
      {queuedMessages.slice(-3).map((item, index) => (
        <Text key={`${index}-${item.slice(0, 8)}`} color="gray">
          {`${queuedMessages.length - Math.min(queuedMessages.length, 3) + index + 1}. ${
            item.length > 88 ? `${item.slice(0, 85)}...` : item
          }`}
        </Text>
      ))}
    </Box>
  );
}

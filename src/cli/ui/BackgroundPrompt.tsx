import { Box, Text } from 'ink';

export function BackgroundPrompt(props: {
  queuedMessages: string[];
}) {
  const { queuedMessages } = props;

  if (queuedMessages.length === 0) {
    return null;
  }

  return (
    <Box marginTop={1} flexDirection="column">
      {queuedMessages.length > 0 ? (
        <Text color="yellow">{`background: queued=${queuedMessages.length}`}</Text>
      ) : null}
    </Box>
  );
}

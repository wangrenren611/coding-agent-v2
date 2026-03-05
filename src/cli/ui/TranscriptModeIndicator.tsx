import { Box, Text } from 'ink';

export function TranscriptModeIndicator(props: { transcriptMode: boolean }) {
  if (!props.transcriptMode) {
    return null;
  }
  return (
    <Box marginTop={1}>
      <Text color="magenta">Transcript Mode ON (Ctrl+O to toggle)</Text>
    </Box>
  );
}

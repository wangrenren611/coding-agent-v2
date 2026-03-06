import { Box, Text } from 'ink';
import type { AppStatus } from './types';

export function ActivityIndicator(props: {
  status: AppStatus;
  error: string | null;
  running: boolean;
  spinner: string;
  hasMessages: boolean;
  processingStartTime: number | null;
  processingToolCalls: number;
  totalTokens: number;
}) {
  const {
    status,
    error,
    running,
    spinner,
    hasMessages,
    processingStartTime,
    processingToolCalls,
    totalTokens,
  } = props;

  if (!hasMessages && !running && status !== 'failed') {
    return null;
  }

  const elapsedSeconds =
    processingStartTime == null
      ? 0
      : Math.max(0, Math.floor((Date.now() - processingStartTime) / 1000));

  if (status === 'failed') {
    return (
      <Box marginTop={1}>
        <Text color="red">
          failed: {error ?? 'Unknown error'} | tokens~{totalTokens}
        </Text>
      </Box>
    );
  }

  if (running) {
    return (
      <Box marginTop={1}>
        <Text color="cyan">
          {spinner} loading... ({elapsedSeconds}s, tokens~{totalTokens}, tools={processingToolCalls}
          )
        </Text>
      </Box>
    );
  }

  return null;
}

import { Box, Text } from 'ink';
import type { AppStatus } from './types';

export function ExitHint(props: {
  status: AppStatus;
  cwd: string;
  modelId: string;
  sessionId: string;
  totalTokens: number;
}) {
  const { status, cwd, modelId, sessionId, totalTokens } = props;
  if (status !== 'exit') {
    return null;
  }

  return (
    <Box marginTop={1} flexDirection="column">
      <Text color="gray">Session ended</Text>
      <Text color="gray">{`cwd=${cwd}`}</Text>
      <Text color="gray">{`model=${modelId}`}</Text>
      <Text color="gray">{`session=${sessionId}`}</Text>
      <Text color="gray">{`tokens~${totalTokens}`}</Text>
    </Box>
  );
}

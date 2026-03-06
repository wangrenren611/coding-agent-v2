import { Box, Text } from 'ink';

export function StatusLine(props: {
  running: boolean;
  approvalPending: boolean;
  spinner: string;
  modelId: string;
  sessionId: string;
  cwd: string;
  approvalMode: string;
  panelMode: string;
  outputFormat: string;
  historyCount: number;
  messageCount: number;
  activityCount: number;
}) {
  const {
    running,
    approvalPending,
    spinner,
    modelId,
    sessionId,
    cwd,
    approvalMode,
    panelMode,
    outputFormat,
    historyCount,
    messageCount,
    activityCount,
  } = props;

  const stateText = running ? `${spinner} running` : approvalPending ? 'approval pending' : 'idle';
  const color = running || approvalPending ? 'yellow' : 'gray';

  return (
    <Box marginTop={1} flexDirection="column">
      <Text color={color}>
        {stateText} | model={modelId} | session={sessionId} | approval={approvalMode}
      </Text>
      <Text color="gray">
        cwd={cwd} | view={panelMode} | format={outputFormat} | history={historyCount} | messages=
        {messageCount} | activities={activityCount}
      </Text>
    </Box>
  );
}

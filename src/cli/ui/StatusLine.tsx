import path from 'node:path';
import { Box, Text } from 'ink';
import { UI_COLORS } from './constants';

function compactSessionId(sessionId: string): string {
  if (sessionId.length <= 12) {
    return sessionId;
  }
  return `${sessionId.slice(0, 8)}...${sessionId.slice(-4)}`;
}

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
  transcriptMode: boolean;
  debugMode: boolean;
}) {
  const {
    modelId,
    sessionId,
    cwd,
    approvalMode,
    panelMode,
    outputFormat,
    historyCount,
    messageCount,
    activityCount,
    transcriptMode,
    debugMode,
  } = props;

  const folderName = path.basename(cwd);

  return (
    <Box marginTop={1} flexDirection="column">
      <Text color={UI_COLORS.STATUS}>
        <Text color={UI_COLORS.STATUS_ACCENT}>{modelId}</Text> | {folderName} | session{' '}
        {compactSessionId(sessionId)} | approval {approvalMode}
      </Text>
      <Text color={UI_COLORS.STATUS}>
        view {panelMode} | format {outputFormat} | history {historyCount} | messages {messageCount}{' '}
        | activity {activityCount} | transcript {transcriptMode ? 'on' : 'off'} | debug{' '}
        {debugMode ? 'on' : 'off'}
      </Text>
    </Box>
  );
}

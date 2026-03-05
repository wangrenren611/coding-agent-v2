import { Box, Text } from 'ink';
import type { PendingConfirm } from './types';

export function ApprovalModal(props: {
  pendingConfirm: PendingConfirm | null;
  input: string;
  denyInputMode: boolean;
}) {
  const { pendingConfirm, input, denyInputMode } = props;
  if (!pendingConfirm) {
    return null;
  }

  return (
    <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow">Approval required: {pendingConfirm.request.toolName}</Text>
      <Text color="gray">reason: {pendingConfirm.request.reason ?? 'n/a'}</Text>
      <Text color="gray">args: {JSON.stringify(pendingConfirm.request.args)}</Text>
      <Text color="gray">快捷键: y=approve, n=deny, Enter=deny</Text>
      {denyInputMode ? <Text color="red">deny reason: {input}</Text> : null}
    </Box>
  );
}

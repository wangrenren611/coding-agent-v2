import { Box, Text } from 'ink';
import type { ToolConfirmDecision } from '../../tool';
import type { PendingConfirm } from './types';

function formatArgs(args: Record<string, unknown>, maxLines = 10): { lines: string[]; truncated: boolean } {
  const text = JSON.stringify(args, null, 2) ?? '{}';
  const lines = text.split('\n');
  if (lines.length <= maxLines) {
    return { lines, truncated: false };
  }
  return { lines: lines.slice(0, maxLines), truncated: true };
}

export function ApprovalModal(props: {
  pendingConfirm: PendingConfirm | null;
  selectedDecision: ToolConfirmDecision;
}) {
  const { pendingConfirm, selectedDecision } = props;
  if (!pendingConfirm) {
    return null;
  }

  const request = pendingConfirm.request;
  const args = formatArgs(request.args);
  const isApprove = selectedDecision === 'approve';

  return (
    <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow" bold>
        Approval Required
      </Text>
      <Text>{`tool: ${request.toolName}`}</Text>
      <Text color="gray">{`toolCallId: ${request.toolCallId}`}</Text>
      {request.reason ? <Text color="gray">{`reason: ${request.reason}`}</Text> : null}

      <Box marginTop={1} flexDirection="column">
        <Text color="gray">args:</Text>
        {args.lines.map((line, index) => (
          <Text key={`${request.toolCallId}-arg-${index}`} color="gray">
            {line}
          </Text>
        ))}
        {args.truncated ? <Text color="gray">... (truncated)</Text> : null}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color={isApprove ? 'green' : 'gray'}>{`${isApprove ? '❯' : ' '} approve once`}</Text>
        <Text color={!isApprove ? 'red' : 'gray'}>{`${!isApprove ? '❯' : ' '} deny`}</Text>
      </Box>

      <Text color="gray">keys: ↑/↓ choose, Enter confirm, y approve, n deny, Esc deny</Text>
    </Box>
  );
}

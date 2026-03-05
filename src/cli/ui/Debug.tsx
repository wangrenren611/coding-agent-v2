import { Box, Text } from 'ink';

export function Debug(props: { enabled: boolean; logs: string[] }) {
  if (!props.enabled) {
    return null;
  }

  const rows = props.logs.slice(-4);
  if (rows.length === 0) {
    return null;
  }

  return (
    <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text color="gray">debug</Text>
      {rows.map((row, idx) => (
        <Text key={`${idx}-${row.slice(0, 8)}`} color="gray">
          {row}
        </Text>
      ))}
    </Box>
  );
}

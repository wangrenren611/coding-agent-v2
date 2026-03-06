import { Box, Text } from 'ink';

export function ExpandableOutput(props: {
  content: string;
  transcriptMode: boolean;
  maxLines?: number;
  color?: string;
  prefix?: string;
}) {
  const { content, transcriptMode, maxLines = 6, color = 'gray', prefix = '' } = props;
  const lines = content.split('\n');
  const shouldTruncate = !transcriptMode && lines.length > maxLines;
  const visibleLines = shouldTruncate ? lines.slice(0, maxLines) : lines;

  return (
    <Box flexDirection="column">
      {visibleLines.map((line, index) => (
        <Text key={`${index}-${line.slice(0, 16)}`} color={color}>
          {`${prefix}${line}`}
        </Text>
      ))}
      {shouldTruncate ? (
        <Text color="gray">{`... ${lines.length - maxLines} more lines (Ctrl+O for full)`}</Text>
      ) : null}
    </Box>
  );
}

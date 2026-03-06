import { Box, Text } from 'ink';
import { ExpandableOutput } from './ExpandableOutput';

function colorForLine(line: string): 'green' | 'red' | 'cyan' | 'gray' | 'white' {
  if (line.startsWith('+++') || line.startsWith('---')) {
    return 'cyan';
  }
  if (line.startsWith('+')) {
    return 'green';
  }
  if (line.startsWith('-')) {
    return 'red';
  }
  if (line.startsWith('@@')) {
    return 'cyan';
  }
  if (line.startsWith('diff --git')) {
    return 'cyan';
  }
  return 'gray';
}

export function looksLikeDiff(text: string): boolean {
  return (
    text.includes('diff --git') ||
    text.includes('@@ ') ||
    text.includes('@@\t') ||
    text.includes('```diff')
  );
}

export function DiffViewer(props: { content: string; transcriptMode: boolean; maxLines?: number }) {
  const { content, transcriptMode, maxLines = 24 } = props;
  const normalized = content
    .replace(/```diff/g, '')
    .replace(/```/g, '')
    .trim();
  const lines = normalized.split('\n');
  const shouldTruncate = !transcriptMode && lines.length > maxLines;
  const visible = shouldTruncate ? lines.slice(0, maxLines) : lines;
  const hidden = lines.length - visible.length;

  return (
    <Box flexDirection="column">
      {visible.map((line, index) => (
        <Text key={`${index}-${line.slice(0, 16)}`} color={colorForLine(line)}>
          {line}
        </Text>
      ))}
      {shouldTruncate ? (
        <ExpandableOutput
          content={`... ${hidden} more diff lines`}
          transcriptMode={transcriptMode}
          maxLines={1}
          color="gray"
        />
      ) : null}
    </Box>
  );
}

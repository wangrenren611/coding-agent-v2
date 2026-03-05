import { Box, Text } from 'ink';

export function ReverseSearchInput(props: {
  query: string;
  currentMatch: string;
  matchIndex: number;
  totalMatches: number;
}) {
  const { query, currentMatch, matchIndex, totalMatches } = props;
  return (
    <Box marginTop={1} marginLeft={2} flexDirection="column">
      <Text color="gray">reverse-search: {query}</Text>
      <Text color="yellow">
        {totalMatches === 0 ? '(no match)' : `${matchIndex + 1}/${totalMatches}`}
      </Text>
      {currentMatch ? (
        <Text color="cyan">
          {currentMatch.length > 120 ? `${currentMatch.slice(0, 117)}...` : currentMatch}
        </Text>
      ) : null}
    </Box>
  );
}

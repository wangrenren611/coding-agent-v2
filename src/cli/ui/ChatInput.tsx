import { Box, Text } from 'ink';
import type { SuggestionItem, InputMode } from './types';
import { Suggestion } from './Suggestion';
import { ReverseSearchInput } from './ReverseSearchInput';
import { ModeIndicator } from './ModeIndicator';

function renderInputWithCursor(
  raw: string,
  cursor: number
): { before: string; at: string; after: string } {
  const normalized = raw.replace(/\n/g, '↵');
  const safe = Math.max(0, Math.min(cursor, normalized.length));
  return {
    before: normalized.slice(0, safe),
    at: normalized[safe] ?? ' ',
    after: normalized.slice(safe + 1),
  };
}

export function ChatInput(props: {
  input: string;
  inputCursor: number;
  running: boolean;
  mode: InputMode;
  suggestions: SuggestionItem[];
  selectedSuggestionIndex: number;
  reverseSearchActive: boolean;
  reverseSearchQuery: string;
  reverseSearchCurrentMatch: string;
  reverseSearchIndex: number;
  reverseSearchTotalMatches: number;
}) {
  const {
    input,
    inputCursor,
    running,
    mode,
    suggestions,
    selectedSuggestionIndex,
    reverseSearchActive,
    reverseSearchQuery,
    reverseSearchCurrentMatch,
    reverseSearchIndex,
    reverseSearchTotalMatches,
  } = props;

  const prompt = mode === 'bash' ? '!' : mode === 'memory' ? '#' : '>';
  const cursor = renderInputWithCursor(input, inputCursor);

  return (
    <>
      <ModeIndicator mode={mode} />

      {reverseSearchActive ? (
        <ReverseSearchInput
          query={reverseSearchQuery}
          currentMatch={reverseSearchCurrentMatch}
          matchIndex={reverseSearchIndex}
          totalMatches={reverseSearchTotalMatches}
        />
      ) : null}

      {!reverseSearchActive ? (
        <Suggestion
          suggestions={suggestions}
          selectedIndex={selectedSuggestionIndex}
          maxVisible={8}
        />
      ) : null}

      <Box marginTop={1} borderStyle="round" borderColor="white" paddingX={1}>
        <Text color={running ? 'gray' : 'white'}>{running ? '(running) ' : `${prompt} `}</Text>
        <Text>{cursor.before}</Text>
        {!running ? <Text inverse>{cursor.at}</Text> : null}
        <Text>{cursor.after}</Text>
      </Box>
    </>
  );
}

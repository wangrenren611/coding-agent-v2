import { Box, Text } from 'ink';
import type { InputMode, SuggestionItem } from './types';
import { Suggestion } from './Suggestion';
import { ReverseSearchInput } from './ReverseSearchInput';
import { ModeIndicator } from './ModeIndicator';
import { UI_COLORS } from './constants';

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

function getPrompt(mode: InputMode): string {
  if (mode === 'bash') return '!';
  if (mode === 'memory') return '#';
  return '>';
}

function getBorderColor(mode: InputMode, running: boolean): string {
  if (running) {
    return UI_COLORS.CHAT_BORDER_ACTIVE;
  }
  if (mode === 'bash') {
    return UI_COLORS.CHAT_BORDER_BASH;
  }
  if (mode === 'memory') {
    return UI_COLORS.CHAT_BORDER_MEMORY;
  }
  return UI_COLORS.CHAT_BORDER;
}

function getPlaceholder(mode: InputMode, queuedCount: number): string {
  if (queuedCount > 0) {
    return `queued ${queuedCount} message${queuedCount > 1 ? 's' : ''}`;
  }
  if (mode === 'memory') {
    return 'save a rule to AGENTS.md';
  }
  if (mode === 'bash') {
    return 'run a shell command';
  }
  return '/help commands, @path search, Shift+Tab mode';
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
  queuedCount: number;
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
    queuedCount,
  } = props;
  const prompt = getPrompt(mode);
  const cursor = renderInputWithCursor(input, inputCursor);
  const borderColor = getBorderColor(mode, running);
  const placeholder = getPlaceholder(mode, queuedCount);
  const divider = '─'.repeat(Math.max(24, process.stdout.columns ?? 80));

  return (
    <Box marginTop={1} flexDirection="column">
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

      <Text color={borderColor}>{divider}</Text>
      <Box>
        <Text color={input ? UI_COLORS.CHAT_ARROW_ACTIVE : UI_COLORS.CHAT_ARROW}>{prompt}</Text>
        <Text> </Text>
        {input.length === 0 && !running ? (
          <Text color={UI_COLORS.CHAT_PLACEHOLDER}>{placeholder}</Text>
        ) : (
          <>
            <Text>{cursor.before}</Text>
            {!running ? <Text inverse>{cursor.at}</Text> : null}
            <Text>{cursor.after}</Text>
          </>
        )}
        {running ? <Text color={UI_COLORS.CHAT_PLACEHOLDER}> running...</Text> : null}
      </Box>
      <Text color={borderColor}>{divider}</Text>
    </Box>
  );
}

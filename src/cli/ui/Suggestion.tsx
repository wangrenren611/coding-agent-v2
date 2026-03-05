import { Box, Text } from 'ink';
import type { SuggestionItem } from './types';

export function Suggestion(props: {
  suggestions: SuggestionItem[];
  selectedIndex: number;
  maxVisible?: number;
}) {
  const { suggestions, selectedIndex, maxVisible = 8 } = props;
  if (suggestions.length === 0) {
    return null;
  }

  const start = Math.max(
    0,
    Math.min(
      selectedIndex - Math.floor(maxVisible / 2),
      Math.max(0, suggestions.length - maxVisible)
    )
  );
  const visible = suggestions.slice(start, start + maxVisible);

  return (
    <Box marginTop={1} marginLeft={2} flexDirection="column">
      {visible.map((item, idx) => {
        const actualIndex = start + idx;
        const selected = actualIndex === selectedIndex;
        return (
          <Box key={`${item.type}-${item.value}-${actualIndex}`}>
            <Text color={selected ? 'cyan' : 'gray'}>
              {selected ? '> ' : '  '}
              {item.title}
            </Text>
            {item.description ? <Text color="gray"> - {item.description}</Text> : null}
          </Box>
        );
      })}
    </Box>
  );
}

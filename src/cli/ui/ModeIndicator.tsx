import { Box, Text } from 'ink';
import type { InputMode } from './types';
import { UI_COLORS } from './constants';

export function ModeIndicator(props: { mode: InputMode }) {
  const { mode } = props;
  if (mode === 'prompt') {
    return null;
  }

  const label =
    mode === 'bash'
      ? 'bash mode'
      : mode === 'memory'
        ? 'memory mode'
        : mode === 'plan'
          ? 'plan mode'
          : 'brainstorm mode';

  return (
    <Box marginTop={1}>
      <Text color={UI_COLORS.MODE_TEXT}>{label}</Text>
      <Text color={UI_COLORS.MODE_HINT}> (Shift+Tab to toggle)</Text>
    </Box>
  );
}

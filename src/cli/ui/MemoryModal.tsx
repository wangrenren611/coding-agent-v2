import { Box, Text } from 'ink';
import type { PendingMemory } from './types';

const OPTIONS = [
  {
    value: 'project' as const,
    label: 'Project memory',
    hint: './AGENTS.md',
  },
  {
    value: 'global' as const,
    label: 'Global memory',
    hint: '~/.coding-agent-v2/AGENTS.md',
  },
];

export function MemoryModal(props: { pendingMemory: PendingMemory | null }) {
  const { pendingMemory } = props;
  if (!pendingMemory) {
    return null;
  }

  return (
    <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text color="cyan" bold>
        Save Memory Rule
      </Text>
      <Box marginTop={1}>
        <Text>{pendingMemory.rule}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {OPTIONS.map((option, index) => {
          const selected = pendingMemory.selection === option.value;
          return (
            <Box key={option.value}>
              <Text color={selected ? 'cyan' : 'gray'}>{selected ? '❯ ' : '  '}</Text>
              <Text bold={selected}>{`${index + 1}. ${option.label}`}</Text>
              <Text color="gray">{`  ${option.hint}`}</Text>
            </Box>
          );
        })}
      </Box>
      <Text color="gray">keys: ↑/↓ choose, Enter confirm, 1/2 select, Esc cancel</Text>
    </Box>
  );
}

import { Box, Text } from 'ink';

type TodoItem = {
  done: boolean;
  text: string;
};

function parseTodoItems(text: string): TodoItem[] {
  const lines = text.split('\n');
  const items: TodoItem[] = [];
  for (const line of lines) {
    const matched = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.+)$/);
    if (!matched) {
      continue;
    }
    items.push({
      done: matched[1].toLowerCase() === 'x',
      text: matched[2].trim(),
    });
  }
  return items;
}

export function hasTodoList(text: string): boolean {
  return parseTodoItems(text).length > 0;
}

export function TodoList(props: { content: string }) {
  const items = parseTodoItems(props.content);
  if (items.length === 0) {
    return null;
  }

  const completed = items.filter((item) => item.done).length;
  return (
    <Box flexDirection="column">
      <Text color="cyan">{`todo ${completed}/${items.length}`}</Text>
      {items.map((item, index) => (
        <Text key={`${index}-${item.text.slice(0, 16)}`} color={item.done ? 'green' : 'yellow'}>
          {item.done ? '[x]' : '[ ]'} {item.text}
        </Text>
      ))}
    </Box>
  );
}

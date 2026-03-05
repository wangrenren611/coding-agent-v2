export interface SlashCommandMeta {
  command: string;
  description: string;
}

export const SLASH_COMMANDS: SlashCommandMeta[] = [
  { command: 'help', description: 'show command help' },
  { command: 'exit', description: 'exit interactive cli' },
  { command: 'quit', description: 'exit interactive cli' },
  { command: 'model', description: 'get/set current model' },
  { command: 'models', description: 'list models' },
  { command: 'tool', description: 'toggle one tool on/off' },
  { command: 'tools', description: 'list enabled tools' },
  { command: 'session', description: 'show or switch session' },
  { command: 'sessions', description: 'list recent sessions' },
  { command: 'new', description: 'new session' },
  { command: 'resume', description: 'resume session by id' },
  { command: 'history', description: 'print recent history' },
  { command: 'log', description: 'print recent history' },
  { command: 'approval', description: 'set approval mode' },
  { command: 'cwd', description: 'show or set working directory' },
  { command: 'workspace', description: 'manage workspace profiles' },
  { command: 'clear', description: 'clear current session context' },
  { command: 'stats', description: 'show runtime stats' },
  { command: 'format', description: 'set output format' },
  { command: 'system', description: 'show or set system prompt' },
  { command: 'config', description: 'show/set persisted cli config' },
  { command: 'skill', description: 'list/show skills' },
  { command: 'panel', description: 'switch panel layout' },
  { command: 'mode', description: 'switch input mode' },
  { command: 'debug', description: 'toggle debug logs' },
  { command: 'transcript', description: 'toggle transcript mode' },
];

export function matchSlashCommands(input: string): SlashCommandMeta[] {
  if (!input.startsWith('/')) {
    return [];
  }

  const body = input.slice(1);
  if (body.includes(' ')) {
    return [];
  }

  const q = body.trim().toLowerCase();
  if (!q) {
    return SLASH_COMMANDS;
  }

  const starts = SLASH_COMMANDS.filter((item) => item.command.startsWith(q));
  const includes = SLASH_COMMANDS.filter(
    (item) =>
      !item.command.startsWith(q) && (item.command.includes(q) || item.description.includes(q))
  );

  return [...starts, ...includes];
}

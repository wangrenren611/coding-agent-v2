export type LocalReplySegment = {
  id: string;
  type: 'thinking' | 'text';
  content: string;
};

export const extractErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  try {
    return String(error);
  } catch {
    return Object.prototype.toString.call(error);
  }
};

export const buildHelpSegments = (turnId: number): LocalReplySegment[] => {
  return [
    {
      id: `${turnId}:thinking`,
      type: 'thinking',
      content: 'This is the command help for OpenTUI Agent CLI.',
    },
    {
      id: `${turnId}:text`,
      type: 'text',
      content: [
        'Available commands:',
        '/help (/commands) - show help',
        '/clear (/new) - clear all turns',
        '/exit (/quit /q) - exit app',
        '/models (/model) - open model selector',
        '/files (/file) - attach workspace files',
        'Type @/ to attach workspace files inline',
        '',
        'Keyboard shortcuts:',
        'Esc - stop current response when the agent is thinking',
        'Ctrl+L - clear conversation panel',
        'Use /files to attach local workspace files',
        'Use @/path to search and attach files inline',
      ].join('\n'),
    },
  ];
};

export const buildUnsupportedSegments = (
  turnId: number,
  commandName: string
): LocalReplySegment[] => {
  return [
    {
      id: `${turnId}:thinking`,
      type: 'thinking',
      content: `The user selected /${commandName}. This command is not implemented in current demo.`,
    },
    {
      id: `${turnId}:text`,
      type: 'text',
      content: `Command /${commandName} is not implemented yet in this CLI demo.`,
    },
  ];
};

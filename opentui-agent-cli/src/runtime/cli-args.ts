type CliArgsResult = {
  ok: boolean;
  error?: string;
};

const CONVERSATION_ID_FLAGS = new Set(['--conversationId', '--conversation-id']);
const SESSION_ID_FLAGS = new Set(['--sessionId', '--session-id']);

const readFlagValue = (argv: string[], index: number): string | null => {
  const inline = argv[index]?.split('=', 2)[1];
  if (inline && inline.trim().length > 0) {
    return inline.trim();
  }

  const next = argv[index + 1];
  if (!next || next.startsWith('-')) {
    return null;
  }

  return next.trim();
};

export const applyCliArgsToEnv = (
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): CliArgsResult => {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) {
      continue;
    }

    const normalized = token.split('=', 1)[0] ?? token;

    if (CONVERSATION_ID_FLAGS.has(normalized)) {
      const value = readFlagValue(argv, index);
      if (!value) {
        return {
          ok: false,
          error: `Missing value for ${normalized}. Example: renx --conversationId my-session`,
        };
      }
      env.AGENT_CONVERSATION_ID = value;
      if (!token.includes('=')) {
        index += 1;
      }
      continue;
    }

    if (SESSION_ID_FLAGS.has(normalized)) {
      const value = readFlagValue(argv, index);
      if (!value) {
        return {
          ok: false,
          error: `Missing value for ${normalized}. Example: renx --sessionId my-session`,
        };
      }
      env.AGENT_SESSION_ID = value;
      if (!token.includes('=')) {
        index += 1;
      }
    }
  }

  return { ok: true };
};

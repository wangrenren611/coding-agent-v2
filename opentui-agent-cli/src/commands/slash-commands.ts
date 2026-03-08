export type SlashCommandAction = "help" | "clear" | "exit" | "models" | "unsupported";

export type SlashCommandDefinition = {
  name: string;
  description: string;
  action: SlashCommandAction;
  aliases?: string[];
};

export const SLASH_COMMANDS: SlashCommandDefinition[] = [
  { name: "help", description: "Help", action: "help", aliases: ["commands"] },
  { name: "clear", description: "Clear conversation", action: "clear", aliases: ["new"] },
  { name: "exit", description: "Exit app", action: "exit", aliases: ["quit", "q"] },
  { name: "export", description: "Export session transcript", action: "unsupported" },
  { name: "fork", description: "Fork from message", action: "unsupported" },
  { name: "init", description: "create/update AGENTS.md", action: "unsupported" },
  { name: "mcps", description: "Toggle MCPs", action: "unsupported", aliases: ["mcp"] },
  { name: "models", description: "Switch model", action: "models", aliases: ["model"] },
  { name: "rename", description: "Rename session", action: "unsupported" },
  { name: "review", description: "Review changes", action: "unsupported" },
  { name: "sessions", description: "Switch session", action: "unsupported", aliases: ["session"] },
];

const normalize = (value: string) => value.trim().toLowerCase();

const getCommandToken = (value: string): string => {
  const normalized = normalize(value);
  const token = normalized.split(/\s+/, 1)[0] ?? "";
  return token.startsWith("/") ? token.slice(1) : token;
};

export const resolveSlashCommand = (value: string): SlashCommandDefinition | null => {
  const token = getCommandToken(value);
  if (!token) {
    return null;
  }

  return (
    SLASH_COMMANDS.find((command) => {
      if (command.name === token) {
        return true;
      }
      return command.aliases?.includes(token) ?? false;
    }) ?? null
  );
};

export const filterSlashCommands = (query: string): SlashCommandDefinition[] => {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return SLASH_COMMANDS;
  }

  return SLASH_COMMANDS.filter((command) => {
    if (command.name.startsWith(normalizedQuery)) {
      return true;
    }
    if (command.name.includes(normalizedQuery)) {
      return true;
    }
    return command.aliases?.some((alias) => alias.includes(normalizedQuery)) ?? false;
  });
};


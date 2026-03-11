export type ToolDisplayConfig = {
  aliases?: string[];
  displayName?: string;
  icon?: string;
  hiddenArgumentKeys?: string[];
};

const TOOL_DISPLAY_CONFIG: Record<string, ToolDisplayConfig> = {
  agent: {
    aliases: ['task'],
    displayName: 'task run',
    icon: '◉',
    hiddenArgumentKeys: ['subagent_type', 'description'],
  },
  task: {
    displayName: 'task run',
    icon: '◉',
    hiddenArgumentKeys: ['subagent_type', 'description'],
  },
  bash: {
    icon: '$',
    hiddenArgumentKeys: ['command', 'description'],
  },
  file_read: {
    icon: '→',
    hiddenArgumentKeys: ['path'],
  },
  file_edit: {
    icon: '←',
    hiddenArgumentKeys: ['path'],
  },
  write_file: {
    icon: '←',
    hiddenArgumentKeys: ['path'],
  },
  glob: {
    icon: '✱',
    hiddenArgumentKeys: ['pattern', 'path'],
  },
  grep: {
    icon: '✱',
    hiddenArgumentKeys: ['pattern', 'path'],
  },
  webfetch: {
    icon: '%',
  },
};

const TOOL_NAME_PREFIX_DISPLAY: Array<{ prefix: string; displayPrefix: string; icon?: string }> = [
  {
    prefix: 'task_',
    displayPrefix: 'task ',
    icon: '◉',
  },
];

export function getToolDisplayConfig(toolName: string): ToolDisplayConfig {
  return TOOL_DISPLAY_CONFIG[toolName] ?? {};
}

export function getToolDisplayName(toolName: string): string {
  const direct = getToolDisplayConfig(toolName).displayName;
  if (direct) {
    return direct;
  }

  for (const entry of TOOL_NAME_PREFIX_DISPLAY) {
    if (toolName.startsWith(entry.prefix)) {
      return toolName.replace(entry.prefix, entry.displayPrefix).replace(/_/g, ' ');
    }
  }

  const aliased = Object.entries(TOOL_DISPLAY_CONFIG).find(([, config]) =>
    (config.aliases ?? []).includes(toolName)
  );
  if (aliased?.[1].displayName) {
    return aliased[1].displayName as string;
  }

  return toolName;
}

export function getToolDisplayIcon(toolName: string): string {
  const direct = getToolDisplayConfig(toolName).icon;
  if (direct) {
    return direct;
  }

  for (const entry of TOOL_NAME_PREFIX_DISPLAY) {
    if (toolName.startsWith(entry.prefix) && entry.icon) {
      return entry.icon;
    }
  }

  const aliased = Object.entries(TOOL_DISPLAY_CONFIG).find(([, config]) =>
    (config.aliases ?? []).includes(toolName)
  );
  if (aliased?.[1].icon) {
    return aliased[1].icon as string;
  }

  return '⚙';
}

export function getToolHiddenArgumentKeys(toolName: string): string[] {
  const direct = getToolDisplayConfig(toolName).hiddenArgumentKeys;
  if (direct) {
    return [...direct];
  }

  const aliased = Object.entries(TOOL_DISPLAY_CONFIG).find(([, config]) =>
    (config.aliases ?? []).includes(toolName)
  );
  if (aliased?.[1].hiddenArgumentKeys) {
    return [...(aliased[1].hiddenArgumentKeys as string[])];
  }

  return [];
}

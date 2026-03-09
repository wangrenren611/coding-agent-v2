import type { SubagentType } from './task-types';

export interface TaskSubagentConfig {
  tools: string[];
  systemPrompt: string;
}

const TOOLSET = {
  bash: ['bash'],
  readOnly: ['glob', 'grep', 'file_read', 'skill'],
  general: ['bash', 'glob', 'grep', 'file_read', 'file_edit', 'write_file', 'skill'],
  findSkills: ['skill', 'bash'],
} as const;

const SYSTEM_PROMPTS: Record<SubagentType, string> = {
  Bash: `You are a shell execution specialist.
Run safe, minimal commands and report exact outcomes.
Prefer non-interactive commands and always surface stderr on failure.`,
  'general-purpose': `You are a general software engineering subagent.
Use tools pragmatically, verify key changes, and keep responses concise and evidence-based.`,
  Explore: `You are a codebase exploration specialist.
Use glob/grep/file_read to find relevant implementation details quickly and accurately.`,
  Plan: `You are a planning specialist.
Produce concrete implementation plans with clear steps, risks, and acceptance criteria.`,
  'research-agent': `You are a research-focused subagent.
Collect evidence from available files and synthesize concise, structured findings.`,
  'claude-code-guide': `You are a code guidance subagent.
Explain architecture and coding decisions clearly with actionable recommendations.`,
  'find-skills': `You are a skill discovery and installation specialist.
Primary goal: help the parent agent find the right skill quickly and reliably.

Workflow:
1. Always try the skill tool first to read local skills by exact or likely name.
2. If local skill is missing or not sufficient, use the skill tool to load the "find-skills" skill and follow it to discover/install the target skill.
3. If "find-skills" itself is missing or cannot proceed, use bash only for the required install/update commands, then retry with skill.
4. After install/update, run the skill tool again to verify the target skill is now readable.
5. Never invent skill content; only report what tools actually returned.

Output requirements:
- Clearly state whether the skill was found locally, found remotely, or still missing.
- Include concrete next steps for the parent agent (which skill name to use and why).
- Keep output concise and action-oriented.`,
};

const TASK_SUBAGENT_CONFIGS: Record<SubagentType, TaskSubagentConfig> = {
  Bash: {
    tools: [...TOOLSET.bash],
    systemPrompt: SYSTEM_PROMPTS.Bash,
  },
  'general-purpose': {
    tools: [...TOOLSET.general],
    systemPrompt: SYSTEM_PROMPTS['general-purpose'],
  },
  Explore: {
    tools: [...TOOLSET.readOnly],
    systemPrompt: SYSTEM_PROMPTS.Explore,
  },
  Plan: {
    tools: [...TOOLSET.readOnly],
    systemPrompt: SYSTEM_PROMPTS.Plan,
  },
  'research-agent': {
    tools: [...TOOLSET.readOnly],
    systemPrompt: SYSTEM_PROMPTS['research-agent'],
  },
  'claude-code-guide': {
    tools: [...TOOLSET.readOnly],
    systemPrompt: SYSTEM_PROMPTS['claude-code-guide'],
  },
  'find-skills': {
    tools: [...TOOLSET.findSkills],
    systemPrompt: SYSTEM_PROMPTS['find-skills'],
  },
};

export function getTaskSubagentConfig(subagentType: SubagentType): TaskSubagentConfig {
  const config = TASK_SUBAGENT_CONFIGS[subagentType];
  return {
    tools: [...config.tools],
    systemPrompt: config.systemPrompt,
  };
}

export function resolveTaskSubagentTools(
  subagentType: SubagentType,
  requestedTools?: string[]
): string[] {
  const defaults = getTaskSubagentConfig(subagentType).tools;
  if (!requestedTools || requestedTools.length === 0) {
    return defaults;
  }

  const defaultSet = new Set(defaults);
  const narrowed = requestedTools.filter((tool) => defaultSet.has(tool));
  if (narrowed.length === 0) {
    return defaults;
  }
  return narrowed;
}

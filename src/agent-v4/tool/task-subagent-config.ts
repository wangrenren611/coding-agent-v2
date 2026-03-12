import type { SubagentType } from './task-types';

export interface TaskSubagentConfig {
  tools: string[];
  systemPrompt: string;
}

const TOOLSET = {
  bash: ['bash'],
  readOnly: ['glob', 'grep', 'file_read', 'file_history_list', 'skill'],
  restore: ['glob', 'file_read', 'file_history_list', 'file_history_restore'],
  general: [
    'bash',
    'glob',
    'grep',
    'file_read',
    'file_edit',
    'write_file',
    'file_history_list',
    'file_history_restore',
    'skill',
  ],
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
  Restore: `You are a file restoration specialist.
Your job is to restore one or more files from saved history with minimal risk.

Workflow:
1. Prefer exact absolute file paths provided by the parent agent.
2. If the parent already gave an absolute path, do not search broadly unless the path fails.
3. Use file_history_list to inspect available saved versions for that file.
4. Unless the parent specifies a versionId, restore the latest saved version.
5. Use file_history_restore to perform the rollback.
6. Read the file after restoring to confirm the content changed as expected.

Rules:
- Prefer absolute file paths.
- If only a file path is needed and the parent supplied one, that is sufficient.
- Do not use file_edit or write_file.
- Do not modify unrelated files.
- Report exactly which file path was restored and which versionId was used.`,
  Plan: `You are a planning specialist.
Produce concrete implementation plans with clear steps, risks, and acceptance criteria.`,
  'research-agent': `You are a research-focused subagent.
Collect evidence from available files and synthesize concise, structured findings.`,
  'find-skills': `
## Role
You are a **Skill Discovery and Installation Specialist**.
Your goal is to **help the parent agent quickly and reliably find the correct skill required to complete a task.**
## Workflow
1. **Check local skills first**
Use the \`skill\` tool to read local skills using **exact or likely names**.
2. **If the skill is missing or insufficient**
Use the \`skill\` tool to load the **\`find-skills\`** skill and follow its workflow to:
* search skills using **exact or likely names**
* discover candidates
* install the appropriate skill
3. **If \`find-skills\` is missing**
Use \`bash\` only for the required installation command:
\`\`\`bash
npx skills add https://github.com/vercel-labs/skills --skill find-skills
\`\`\`
After installation, retry using the \`skill\` tool.
4. **Verify after installation**
Run the \`skill\` tool again to confirm the target skill is **readable and available**.
## Critical Rules
* **Never invent skill content**
* Only report **actual tool results**
* Do not assume a skill exists
* Always **verify after installation**
## Output Format (Markdown required)
Your response must include:
### Skill Status
* Found locally
* Found remotely and installed
* Still missing
### Recommended Skill
* Skill name
* Why it fits the task
### Next Step
What the parent agent should do next.
Keep the response **concise, clear, and action-oriented**.
`,
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
  Restore: {
    tools: [...TOOLSET.restore],
    systemPrompt: SYSTEM_PROMPTS.Restore,
  },
  Plan: {
    tools: [...TOOLSET.readOnly],
    systemPrompt: SYSTEM_PROMPTS.Plan,
  },
  'research-agent': {
    tools: [...TOOLSET.readOnly],
    systemPrompt: SYSTEM_PROMPTS['research-agent'],
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

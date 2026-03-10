import { describe, expect, it } from 'vitest';
import { getTaskSubagentConfig, resolveTaskSubagentTools } from '../task-subagent-config';
import type { SubagentType } from '../task-types';

const ALL_TYPES: SubagentType[] = [
  'Bash',
  'general-purpose',
  'Explore',
  'Plan',
  'research-agent',
  'claude-code-guide',
  'find-skills',
];

describe('task-subagent-config', () => {
  it('returns config for every supported subagent type', () => {
    for (const type of ALL_TYPES) {
      const config = getTaskSubagentConfig(type);
      expect(config.tools.length).toBeGreaterThan(0);
      expect(config.systemPrompt.length).toBeGreaterThan(0);
    }
  });

  it('returns cloned tool arrays to avoid accidental shared mutation', () => {
    const first = getTaskSubagentConfig('Plan');
    const second = getTaskSubagentConfig('Plan');
    first.tools.push('unexpected_tool');
    expect(second.tools).not.toContain('unexpected_tool');
  });

  it('uses defaults when requested tools are empty or undefined', () => {
    const defaults = getTaskSubagentConfig('general-purpose').tools;
    expect(resolveTaskSubagentTools('general-purpose')).toEqual(defaults);
    expect(resolveTaskSubagentTools('general-purpose', [])).toEqual(defaults);
  });

  it('narrows requested tools by config whitelist and falls back to defaults', () => {
    expect(resolveTaskSubagentTools('Plan', ['glob', 'bash'])).toEqual(['glob']);

    const defaults = getTaskSubagentConfig('Plan').tools;
    expect(resolveTaskSubagentTools('Plan', ['bash', 'write_file'])).toEqual(defaults);
  });

  it('defines find-skills as local-first skill workflow with bash fallback', () => {
    const config = getTaskSubagentConfig('find-skills');

    expect(config.tools).toEqual(['skill', 'bash']);
    expect(config.systemPrompt).toContain('Check local skills first');
    expect(config.systemPrompt).toContain('load the **`find-skills`** skill');
    expect(config.systemPrompt).toContain('Use `bash` only for the required installation command');
    expect(config.systemPrompt).toContain('retry using the `skill` tool');
  });
});

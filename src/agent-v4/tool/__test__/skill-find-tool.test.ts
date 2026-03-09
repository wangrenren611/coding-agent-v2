import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SkillFindTool } from '../skill-find-tool';
import { initializeSkillLoader, resetSkillLoader } from '../skill/loader';
import * as loaderModule from '../skill/loader';

function parseArgs(
  tool: SkillFindTool,
  args: Record<string, unknown>
): {
  query: string;
  top_k: number;
  auto_load: boolean;
  min_score: number;
} {
  const parsed = tool.safeValidateArgs(args);
  if (!parsed.success) {
    throw parsed.error;
  }
  return parsed.data;
}

describe('SkillFindTool', () => {
  let rootDir: string;
  let skillsRoot: string;

  beforeEach(async () => {
    resetSkillLoader();
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-v4-skill-find-tool-'));
    skillsRoot = path.join(rootDir, 'skills');

    await fs.mkdir(path.join(skillsRoot, 'auto-refactor'), { recursive: true });
    await fs.mkdir(path.join(skillsRoot, 'plain-skill'), { recursive: true });
    await fs.mkdir(path.join(skillsRoot, 'docs-helper'), { recursive: true });

    await fs.writeFile(
      path.join(skillsRoot, 'auto-refactor', 'SKILL.md'),
      `---
name: auto-refactor
description: Refactor TypeScript modules and improve tests
---
# Auto Refactor

Use @src/refactor.ts.
Run !\`pnpm test\`.
`,
      'utf8'
    );

    await fs.writeFile(
      path.join(skillsRoot, 'plain-skill', 'SKILL.md'),
      `# Plain Skill

Helps with plain matching scenarios.`,
      'utf8'
    );

    await fs.writeFile(
      path.join(skillsRoot, 'docs-helper', 'SKILL.md'),
      `---
name: docs-helper
description: Write docs and API guides
---
# Docs Helper

Use @docs/README.md.
Run !\`pnpm lint\`.
`,
      'utf8'
    );
  });

  afterEach(async () => {
    resetSkillLoader();
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('matches and auto-loads the best skill by default', async () => {
    const tool = new SkillFindTool({ loaderOptions: { skillRoots: [skillsRoot] } });
    const args = parseArgs(tool, {
      query: 'auto-refactor',
      top_k: 3,
      auto_load: true,
      min_score: 0.1,
    });

    const result = await tool.execute(args);

    expect(result.success).toBe(true);
    expect(result.output).toContain('Best matched skill: auto-refactor');
    expect(result.output).toContain('## Skill: auto-refactor');

    const metadata = result.metadata as {
      best_match: { name: string; reason: string; score: number };
      selected_skill: {
        name: string;
        content: string;
        fileRefs: string[];
        shellCommands: string[];
      };
    };

    expect(metadata.best_match.name).toBe('auto-refactor');
    expect(metadata.best_match.score).toBeGreaterThan(0.9);
    expect(metadata.best_match.reason).toContain('exact skill name match');
    expect(metadata.selected_skill.name).toBe('auto-refactor');
    expect(metadata.selected_skill.content).toContain('Use @src/refactor.ts.');
    expect(metadata.selected_skill.fileRefs).toContain('src/refactor.ts');
    expect(metadata.selected_skill.shellCommands).toContain('pnpm test');
  });

  it('returns ranked candidates without loading content when auto_load is false', async () => {
    const tool = new SkillFindTool({ loaderOptions: { skillRoots: [skillsRoot] } });
    const args = parseArgs(tool, {
      query: 'plain',
      top_k: 2,
      auto_load: false,
      min_score: 0.1,
    });

    const result = await tool.execute(args);

    expect(result.success).toBe(true);
    expect(result.output).toContain('Top candidates:');
    expect(result.output).not.toContain('## Skill:');

    const metadata = result.metadata as {
      best_match: { name: string; reason: string };
      selected_skill?: unknown;
      candidates: Array<{ name: string }>;
    };

    expect(metadata.best_match.name).toBe('plain-skill');
    expect(metadata.best_match.reason).toContain('skill name contains query');
    expect(metadata.selected_skill).toBeUndefined();
    expect(metadata.candidates).toHaveLength(2);
  });

  it('returns SKILL_UNAVAILABLE when no skills are found', async () => {
    const emptyRoot = path.join(rootDir, 'empty-skills');
    await fs.mkdir(emptyRoot, { recursive: true });

    const tool = new SkillFindTool({ loaderOptions: { skillRoots: [emptyRoot] } });
    const args = parseArgs(tool, {
      query: 'anything',
      top_k: 3,
      auto_load: true,
      min_score: 0.1,
    });

    const result = await tool.execute(args);

    expect(result.success).toBe(false);
    expect(result.output).toContain('SKILL_UNAVAILABLE');
    expect((result.metadata as { error: string }).error).toBe('SKILL_UNAVAILABLE');
  });

  it('returns SKILL_MATCH_NOT_FOUND when no candidate reaches min_score', async () => {
    const tool = new SkillFindTool({ loaderOptions: { skillRoots: [skillsRoot] } });
    const args = parseArgs(tool, {
      query: '   ',
      top_k: 2,
      auto_load: false,
      min_score: 0.6,
    });

    const result = await tool.execute(args);

    expect(result.success).toBe(false);
    expect(result.output).toContain('SKILL_MATCH_NOT_FOUND');

    const metadata = result.metadata as {
      error: string;
      query: string;
      best_match: { score: number; reason: string } | null;
      candidates: Array<{ reason: string; score: number }>;
    };

    expect(metadata.error).toBe('SKILL_MATCH_NOT_FOUND');
    expect(metadata.query).toBe('');
    expect(metadata.best_match).not.toBeNull();
    expect(metadata.best_match?.score).toBe(0);
    expect(metadata.candidates[0].reason).toBe('weak metadata similarity');
  });

  it('returns SKILL_MATCH_NOT_FOUND with best_match=null when top_k is zero at runtime', async () => {
    const tool = new SkillFindTool({ loaderOptions: { skillRoots: [skillsRoot] } });

    const result = await tool.execute({
      query: 'unknown',
      top_k: 0,
      auto_load: false,
      min_score: 0.1,
    } as unknown as {
      query: string;
      top_k: number;
      auto_load: boolean;
      min_score: number;
    });

    expect(result.success).toBe(false);
    expect(result.output).toContain('SKILL_MATCH_NOT_FOUND');

    const metadata = result.metadata as {
      best_match: null;
      candidates: unknown[];
    };
    expect(metadata.best_match).toBeNull();
    expect(metadata.candidates).toHaveLength(0);
  });

  it('returns SKILL_LOAD_FAILED when a matched skill cannot be loaded', async () => {
    await initializeSkillLoader({ skillRoots: [skillsRoot] });
    await fs.rm(path.join(skillsRoot, 'auto-refactor', 'SKILL.md'));

    const tool = new SkillFindTool({ loaderOptions: { skillRoots: [skillsRoot] } });
    const args = parseArgs(tool, {
      query: 'auto-refactor',
      top_k: 3,
      auto_load: true,
      min_score: 0.1,
    });
    const result = await tool.execute(args);

    expect(result.success).toBe(false);
    expect(result.output).toContain('SKILL_LOAD_FAILED');
    expect((result.metadata as { error: string }).error).toBe('SKILL_LOAD_FAILED');
  });

  it('exposes parallel-safe concurrency policy and normalized lock key', () => {
    const tool = new SkillFindTool({ loaderOptions: { skillRoots: [skillsRoot] } });

    expect(tool.description).toContain('Automatically find the most relevant skill');
    expect(
      tool.getConcurrencyMode({
        query: 'abc',
        top_k: 5,
        auto_load: true,
        min_score: 0.1,
      })
    ).toBe('parallel-safe');
    expect(
      tool.getConcurrencyLockKey({
        query: '  My Query  ',
        top_k: 5,
        auto_load: true,
        min_score: 0.1,
      })
    ).toBe('skill_find:my query');
  });

  it('maps initialize loader Error failures to ToolExecutionError', async () => {
    const initSpy = vi
      .spyOn(loaderModule, 'initializeSkillLoader')
      .mockRejectedValueOnce(new Error('loader exploded'));

    const tool = new SkillFindTool({ loaderOptions: { skillRoots: [skillsRoot] } });
    const args = parseArgs(tool, {
      query: 'auto-refactor',
      top_k: 3,
      auto_load: true,
      min_score: 0.1,
    });

    const result = await tool.execute(args);

    expect(result.success).toBe(false);
    expect(result.output).toBe('loader exploded');
    expect(result.error?.name).toBe('ToolExecutionError');
    initSpy.mockRestore();
  });

  it('maps non-Error failures using String(error)', async () => {
    const initSpy = vi
      .spyOn(loaderModule, 'initializeSkillLoader')
      .mockRejectedValueOnce('loader string failure');

    const tool = new SkillFindTool({ loaderOptions: { skillRoots: [skillsRoot] } });
    const args = parseArgs(tool, {
      query: 'auto-refactor',
      top_k: 3,
      auto_load: true,
      min_score: 0.1,
    });

    const result = await tool.execute(args);

    expect(result.success).toBe(false);
    expect(result.output).toBe('loader string failure');
    expect(result.error?.name).toBe('ToolExecutionError');
    initSpy.mockRestore();
  });
});

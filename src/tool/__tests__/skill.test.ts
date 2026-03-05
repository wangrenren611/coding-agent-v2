import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fsp } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { SkillTool } from '../skill-tool';
import { initializeSkillLoader, resetSkillLoader } from '../skill';
import type { ToolExecutionContext } from '../types';

const mockContext: ToolExecutionContext = {
  toolCallId: 'skill-test-call',
  loopIndex: 0,
  stepIndex: 0,
  agent: {} as ToolExecutionContext['agent'],
};

describe('SkillTool', () => {
  let rootDir: string;
  let skillsRoot: string;

  beforeEach(async () => {
    resetSkillLoader();
    rootDir = await fsp.mkdtemp(path.join(tmpdir(), 'skill-tool-'));
    skillsRoot = path.join(rootDir, 'skills');
    await fsp.mkdir(path.join(skillsRoot, 'test-skill'), { recursive: true });
    await fsp.mkdir(path.join(skillsRoot, 'plain-skill'), { recursive: true });

    await fsp.writeFile(
      path.join(skillsRoot, 'test-skill', 'SKILL.md'),
      `---
name: test-skill
description: Test workflow skill
---
# Test Skill

Use @src/app.ts.

Run !\`pnpm test\`.`,
      'utf-8'
    );

    await fsp.writeFile(
      path.join(skillsRoot, 'plain-skill', 'SKILL.md'),
      `# Plain Skill

This is a plain skill without frontmatter.`,
      'utf-8'
    );
  });

  afterEach(async () => {
    resetSkillLoader();
    await fsp.rm(rootDir, { recursive: true, force: true });
  });

  it('should include available skills in description after loader initialization', async () => {
    await initializeSkillLoader({ skillRoots: [skillsRoot] });
    const tool = new SkillTool({ loaderOptions: { skillRoots: [skillsRoot] } });
    expect(tool.description).toContain('Available skills');
    expect(tool.description).toContain('test-skill');
    expect(tool.description).toContain('plain-skill');
  });

  it('should load skill content by name', async () => {
    const tool = new SkillTool({ loaderOptions: { skillRoots: [skillsRoot] } });
    const result = await tool.execute({ name: 'test-skill' }, mockContext);

    expect(result.success).toBe(true);
    expect((result.data as { name: string }).name).toBe('test-skill');
    expect((result.data as { fileRefs: string[] }).fileRefs).toContain('src/app.ts');
    expect((result.data as { shellCommands: string[] }).shellCommands).toContain('pnpm test');
    expect(String(result.metadata?.message ?? '') || String(result.data)).toBeDefined();
  });

  it('should return SKILL_NOT_FOUND with available skills suggestion', async () => {
    const tool = new SkillTool({ loaderOptions: { skillRoots: [skillsRoot] } });
    const result = await tool.execute({ name: 'missing-skill' }, mockContext);

    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('SKILL_NOT_FOUND');
    expect((result.data as { suggestion: string }).suggestion).toContain('test-skill');
  });

  it('should support simple mode without skill list in description', () => {
    const tool = new SkillTool({
      includeSkillList: false,
      loaderOptions: { skillRoots: [skillsRoot] },
    });
    expect(tool.description).not.toContain('Available skills');
  });
});

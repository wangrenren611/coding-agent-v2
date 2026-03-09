import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SkillTool } from '../skill-tool';
import { initializeSkillLoader, resetSkillLoader } from '../skill/loader';
import * as loaderModule from '../skill/loader';

describe('SkillTool', () => {
  let rootDir: string;
  let skillsRoot: string;

  beforeEach(async () => {
    resetSkillLoader();
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-v4-skill-tool-'));
    skillsRoot = path.join(rootDir, 'skills');

    await fs.mkdir(path.join(skillsRoot, 'test-skill'), { recursive: true });
    await fs.mkdir(path.join(skillsRoot, 'plain-skill'), { recursive: true });

    await fs.writeFile(
      path.join(skillsRoot, 'test-skill', 'SKILL.md'),
      `---
name: test-skill
description: Test workflow skill
---
# Test Skill

Use @src/app.ts.

Run !\`pnpm test\`.`,
      'utf8'
    );

    await fs.writeFile(
      path.join(skillsRoot, 'plain-skill', 'SKILL.md'),
      `# Plain Skill

This is a plain skill without frontmatter.`,
      'utf8'
    );
  });

  afterEach(async () => {
    resetSkillLoader();
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('includes available skills in description after loader initialization', async () => {
    await initializeSkillLoader({ skillRoots: [skillsRoot] });
    const tool = new SkillTool({ loaderOptions: { skillRoots: [skillsRoot] } });

    expect(tool.description).toContain('Available skills');
    expect(tool.description).toContain('test-skill');
    expect(tool.description).toContain('plain-skill');
  });

  it('loads skill content by name', async () => {
    const tool = new SkillTool({ loaderOptions: { skillRoots: [skillsRoot] } });
    const result = await tool.execute({ name: 'test-skill' });

    expect(result.success).toBe(true);
    expect(result.output).toContain('## Skill: test-skill');

    const metadata = result.metadata as {
      name: string;
      fileRefs: string[];
      shellCommands: string[];
    };

    expect(metadata.name).toBe('test-skill');
    expect(metadata.fileRefs).toContain('src/app.ts');
    expect(metadata.shellCommands).toContain('pnpm test');
  });

  it('returns SKILL_NOT_FOUND with available skills suggestion', async () => {
    const tool = new SkillTool({ loaderOptions: { skillRoots: [skillsRoot] } });
    const result = await tool.execute({ name: 'missing-skill' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('SKILL_NOT_FOUND');
    expect((result.metadata as { suggestion: string }).suggestion).toContain('test-skill');
  });

  it('supports simple mode without skill list in description', () => {
    const tool = new SkillTool({
      includeSkillList: false,
      loaderOptions: { skillRoots: [skillsRoot] },
    });

    expect(tool.description).not.toContain('Available skills');
  });

  it('exposes parallel-safe concurrency policy and lock key', () => {
    const tool = new SkillTool({ loaderOptions: { skillRoots: [skillsRoot] } });

    expect(tool.getConcurrencyMode({ name: 'test-skill' })).toBe('parallel-safe');
    expect(tool.getConcurrencyLockKey({ name: 'test-skill' })).toBe('skill:test-skill');
  });

  it('refreshDescription invalidates cache', async () => {
    await initializeSkillLoader({ skillRoots: [skillsRoot] });
    const tool = new SkillTool({ loaderOptions: { skillRoots: [skillsRoot] } });
    const before = tool.description;
    tool.refreshDescription();
    const after = tool.description;

    expect(before).toContain('Available skills');
    expect(after).toContain('Available skills');
  });

  it('returns SKILL_LOAD_FAILED when metadata exists but file cannot be loaded', async () => {
    await initializeSkillLoader({ skillRoots: [skillsRoot] });
    await fs.rm(path.join(skillsRoot, 'test-skill', 'SKILL.md'));

    const tool = new SkillTool({ loaderOptions: { skillRoots: [skillsRoot] } });
    const result = await tool.execute({ name: 'test-skill' });

    expect(result.success).toBe(false);
    expect(result.output).toContain('SKILL_LOAD_FAILED');
  });

  it('maps unexpected initialize errors to ToolExecutionError', async () => {
    const initSpy = vi
      .spyOn(loaderModule, 'initializeSkillLoader')
      .mockRejectedValueOnce(new Error('loader exploded'));

    const tool = new SkillTool({ loaderOptions: { skillRoots: [skillsRoot] } });
    const result = await tool.execute({ name: 'test-skill' });

    expect(result.success).toBe(false);
    expect(result.output).toBe('loader exploded');
    expect(result.error?.name).toBe('ToolExecutionError');
    initSpy.mockRestore();
  });

  it('shows empty-skill suggestions when no skills are available', async () => {
    const emptyRoot = path.join(rootDir, 'empty-skills');
    await fs.mkdir(emptyRoot, { recursive: true });

    const tool = new SkillTool({ loaderOptions: { skillRoots: [emptyRoot] } });
    const result = await tool.execute({ name: 'missing-skill' });

    expect(result.success).toBe(false);
    expect((result.metadata as { suggestion: string }).suggestion).toBe(
      'No skills are currently available.'
    );
    expect(result.output).toContain('No skills are currently available.');
  });

  it('renders description with no available skills', async () => {
    const emptyRoot = path.join(rootDir, 'description-empty');
    await fs.mkdir(emptyRoot, { recursive: true });
    await initializeSkillLoader({ skillRoots: [emptyRoot] });

    const tool = new SkillTool({ loaderOptions: { skillRoots: [emptyRoot] } });
    expect(tool.description).toContain('No skills are currently available.');
  });

  it('maps non-error loader failures using String(error)', async () => {
    const initSpy = vi
      .spyOn(loaderModule, 'initializeSkillLoader')
      .mockRejectedValueOnce('loader string failure');

    const tool = new SkillTool({ loaderOptions: { skillRoots: [skillsRoot] } });
    const result = await tool.execute({ name: 'test-skill' });

    expect(result.success).toBe(false);
    expect(result.output).toBe('loader string failure');
    initSpy.mockRestore();
  });
});

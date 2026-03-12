import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  SkillLoader,
  getSkillLoader,
  initializeSkillLoader,
  resetSkillLoader,
} from '../skill/loader';

describe('SkillLoader', () => {
  let tempDir: string;
  let skillDir: string;
  let skillFile: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-loader-test-'));
    skillDir = path.join(tempDir, 'test-skill');
    await fs.mkdir(skillDir, { recursive: true });
    skillFile = path.join(skillDir, 'SKILL.md');

    await fs.writeFile(
      skillFile,
      `---
name: test-skill
description: A test skill
---
# Test Skill
This is a test skill.`
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
    resetSkillLoader();
  });

  describe('constructor', () => {
    it('creates loader with default options', () => {
      const loader = new SkillLoader();
      expect(loader).toBeDefined();
    });

    it('creates loader with custom skill roots', () => {
      const loader = new SkillLoader({ skillRoots: [tempDir] });
      expect(loader).toBeDefined();
    });

    it('creates loader with custom working directory', () => {
      const loader = new SkillLoader({ workingDir: tempDir });
      expect(loader).toBeDefined();
    });

    it('creates loader with both custom options', () => {
      const loader = new SkillLoader({
        skillRoots: [tempDir],
        workingDir: tempDir,
      });
      expect(loader).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('initializes loader and discovers skills', async () => {
      const loader = new SkillLoader({ skillRoots: [tempDir] });
      await loader.initialize();

      const metadata = loader.getAllMetadata();
      expect(metadata).toHaveLength(1);
      expect(metadata[0].name).toBe('test-skill');
      expect(metadata[0].description).toBe('A test skill');
    });

    it('does not reinitialize if already initialized', async () => {
      const loader = new SkillLoader({ skillRoots: [tempDir] });
      await loader.initialize();

      // Add another skill after initialization
      const skillDir2 = path.join(tempDir, 'test-skill-2');
      await fs.mkdir(skillDir2, { recursive: true });
      await fs.writeFile(
        path.join(skillDir2, 'SKILL.md'),
        `---
name: test-skill-2
description: Another test skill
---
# Test Skill 2`
      );

      // Should not discover the new skill
      const metadata = loader.getAllMetadata();
      expect(metadata).toHaveLength(1);
    });

    it('handles empty skill roots', async () => {
      // When skillRoots is empty array, it should use default skill roots
      const loader = new SkillLoader({ skillRoots: [] });
      await loader.initialize();

      const metadata = loader.getAllMetadata();
      // Should discover skills from default roots (if any exist)
      expect(Array.isArray(metadata)).toBe(true);
    });

    it('handles non-existent skill roots', async () => {
      const loader = new SkillLoader({ skillRoots: ['/non/existent/path'] });
      await loader.initialize();

      const metadata = loader.getAllMetadata();
      expect(metadata).toHaveLength(0);
    });

    it('handles skill roots that are files', async () => {
      const filePath = path.join(tempDir, 'file.txt');
      await fs.writeFile(filePath, 'test');

      const loader = new SkillLoader({ skillRoots: [filePath] });
      await loader.initialize();

      const metadata = loader.getAllMetadata();
      expect(metadata).toHaveLength(0);
    });

    it('handles skill roots with permission errors', async () => {
      const restrictedDir = path.join(tempDir, 'restricted');
      await fs.mkdir(restrictedDir, { recursive: true });
      await fs.chmod(restrictedDir, 0o000);

      try {
        const loader = new SkillLoader({ skillRoots: [restrictedDir] });
        await loader.initialize();

        const metadata = loader.getAllMetadata();
        expect(metadata).toHaveLength(0);
      } finally {
        await fs.chmod(restrictedDir, 0o755);
      }
    });

    it('handles skill files with invalid frontmatter', async () => {
      const invalidSkillDir = path.join(tempDir, 'invalid-skill');
      await fs.mkdir(invalidSkillDir, { recursive: true });
      await fs.writeFile(
        path.join(invalidSkillDir, 'SKILL.md'),
        `---
name: invalid-skill
---
# Invalid Skill`
      );

      const loader = new SkillLoader({ skillRoots: [tempDir] });
      await loader.initialize();

      const metadata = loader.getAllMetadata();
      // When frontmatter is invalid, it uses fallback name (directory name) and derives description
      expect(metadata).toHaveLength(2); // Both skills
      expect(metadata.map((m) => m.name)).toContain('test-skill');
      expect(metadata.map((m) => m.name)).toContain('invalid-skill');
    });

    it('handles skill files with invalid names', async () => {
      const invalidNameDir = path.join(tempDir, 'Invalid-Name');
      await fs.mkdir(invalidNameDir, { recursive: true });
      await fs.writeFile(
        path.join(invalidNameDir, 'SKILL.md'),
        `---
name: Invalid-Name
description: Invalid name skill
---
# Invalid Name Skill`
      );

      const loader = new SkillLoader({ skillRoots: [tempDir] });
      await loader.initialize();

      const metadata = loader.getAllMetadata();
      expect(metadata).toHaveLength(1); // Only the valid skill
      expect(metadata[0].name).toBe('test-skill');
    });

    it('handles skill files with empty descriptions', async () => {
      const emptyDescDir = path.join(tempDir, 'empty-desc');
      await fs.mkdir(emptyDescDir, { recursive: true });
      await fs.writeFile(
        path.join(emptyDescDir, 'SKILL.md'),
        `---
name: empty-desc
description: 
---
# Empty Description Skill`
      );

      const loader = new SkillLoader({ skillRoots: [tempDir] });
      await loader.initialize();

      const metadata = loader.getAllMetadata();
      // When description is empty, it derives description from markdown
      expect(metadata).toHaveLength(2); // Both skills
      expect(metadata.map((m) => m.name)).toContain('test-skill');
      expect(metadata.map((m) => m.name)).toContain('empty-desc');
    });

    it('handles skill files that cannot be read', async () => {
      // Skip on Windows as chmod doesn't work the same way
      if (process.platform === 'win32') {
        return;
      }
      const unreadableDir = path.join(tempDir, 'unreadable');
      await fs.mkdir(unreadableDir, { recursive: true });
      const unreadableFile = path.join(unreadableDir, 'SKILL.md');
      await fs.writeFile(
        unreadableFile,
        `---
name: unreadable
description: Unreadable skill
---
# Unreadable Skill`
      );
      await fs.chmod(unreadableFile, 0o000);

      try {
        const loader = new SkillLoader({ skillRoots: [tempDir] });
        await loader.initialize();

        const metadata = loader.getAllMetadata();
        expect(metadata).toHaveLength(1); // Only the valid skill
        expect(metadata[0].name).toBe('test-skill');
      } finally {
        await fs.chmod(unreadableFile, 0o644);
      }
    });

    it('handles duplicate skill names', async () => {
      const duplicateDir = path.join(tempDir, 'duplicate');
      await fs.mkdir(duplicateDir, { recursive: true });
      await fs.writeFile(
        path.join(duplicateDir, 'SKILL.md'),
        `---
name: test-skill
description: Duplicate skill
---
# Duplicate Skill`
      );

      const loader = new SkillLoader({ skillRoots: [tempDir] });
      await loader.initialize();

      const metadata = loader.getAllMetadata();
      expect(metadata).toHaveLength(1); // Only the first skill
      expect(metadata[0].name).toBe('test-skill');
      // The first discovered skill's description is kept
      // Note: The order of discovery depends on directory traversal order
      expect(['A test skill', 'Duplicate skill']).toContain(metadata[0].description);
    });

    it('handles nested skill directories', async () => {
      const nestedDir = path.join(tempDir, 'nested', 'deep', 'skill');
      await fs.mkdir(nestedDir, { recursive: true });
      await fs.writeFile(
        path.join(nestedDir, 'SKILL.md'),
        `---
name: nested-skill
description: Nested skill
---
# Nested Skill`
      );

      const loader = new SkillLoader({ skillRoots: [tempDir] });
      await loader.initialize();

      const metadata = loader.getAllMetadata();
      expect(metadata).toHaveLength(2); // Both skills
      expect(metadata.map((m) => m.name)).toContain('test-skill');
      expect(metadata.map((m) => m.name)).toContain('nested-skill');
    });

    it('handles circular symlinks', async () => {
      const symlinkDir = path.join(tempDir, 'symlink');
      await fs.symlink(tempDir, symlinkDir);

      const loader = new SkillLoader({ skillRoots: [tempDir] });
      await loader.initialize();

      const metadata = loader.getAllMetadata();
      expect(metadata).toHaveLength(1); // Should not hang or crash
    });
  });

  describe('getAllMetadata', () => {
    it('returns empty array when no skills', async () => {
      // Create a new empty directory for this test
      const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'empty-skill-'));
      try {
        const loader = new SkillLoader({ skillRoots: [emptyDir] });
        await loader.initialize();

        const metadata = loader.getAllMetadata();
        expect(metadata).toHaveLength(0);
      } finally {
        await fs.rm(emptyDir, { recursive: true, force: true });
      }
    });

    it('returns skills sorted by name', async () => {
      // Create another skill
      const skillDir2 = path.join(tempDir, 'another-skill');
      await fs.mkdir(skillDir2, { recursive: true });
      await fs.writeFile(
        path.join(skillDir2, 'SKILL.md'),
        `---
name: another-skill
description: Another test skill
---
# Another Test Skill`
      );

      const loader = new SkillLoader({ skillRoots: [tempDir] });
      await loader.initialize();

      const metadata = loader.getAllMetadata();
      expect(metadata).toHaveLength(2);
      expect(metadata[0].name).toBe('another-skill');
      expect(metadata[1].name).toBe('test-skill');
    });
  });

  describe('hasSkill', () => {
    it('returns true for existing skill', async () => {
      const loader = new SkillLoader({ skillRoots: [tempDir] });
      await loader.initialize();

      expect(loader.hasSkill('test-skill')).toBe(true);
    });

    it('returns false for non-existing skill', async () => {
      const loader = new SkillLoader({ skillRoots: [tempDir] });
      await loader.initialize();

      expect(loader.hasSkill('non-existing')).toBe(false);
    });

    it('returns false before initialization', () => {
      const loader = new SkillLoader({ skillRoots: [tempDir] });

      expect(loader.hasSkill('test-skill')).toBe(false);
    });
  });

  describe('loadSkill', () => {
    it('loads skill content', async () => {
      const loader = new SkillLoader({ skillRoots: [tempDir] });
      await loader.initialize();

      const skill = await loader.loadSkill('test-skill');
      expect(skill).toBeDefined();
      expect(skill!.metadata.name).toBe('test-skill');
      expect(skill!.content).toContain('# Test Skill');
      expect(skill!.content).toContain('This is a test skill.');
      expect(skill!.loadedAt).toBeGreaterThan(0);
    });

    it('caches loaded skills', async () => {
      const loader = new SkillLoader({ skillRoots: [tempDir] });
      await loader.initialize();

      const skill1 = await loader.loadSkill('test-skill');
      const skill2 = await loader.loadSkill('test-skill');

      expect(skill1).toBe(skill2); // Same object reference
    });

    it('returns null for non-existing skill', async () => {
      const loader = new SkillLoader({ skillRoots: [tempDir] });
      await loader.initialize();

      const skill = await loader.loadSkill('non-existing');
      expect(skill).toBeNull();
    });

    it('returns null for skill that cannot be read', async () => {
      const loader = new SkillLoader({ skillRoots: [tempDir] });
      await loader.initialize();

      // Remove the skill file
      await fs.rm(skillFile);

      const skill = await loader.loadSkill('test-skill');
      expect(skill).toBeNull();
    });

    it('returns null before initialization', async () => {
      const loader = new SkillLoader({ skillRoots: [tempDir] });

      const skill = await loader.loadSkill('test-skill');
      expect(skill).toBeNull();
    });

    it('extracts file refs and shell commands', async () => {
      // Create a skill with file refs and shell commands
      const skillDir2 = path.join(tempDir, 'rich-skill');
      await fs.mkdir(skillDir2, { recursive: true });
      await fs.writeFile(
        path.join(skillDir2, 'SKILL.md'),
        `---
name: rich-skill
description: Rich skill
---
# Rich Skill
Check @file.txt and run !\`ls -la\`.`
      );

      const loader = new SkillLoader({ skillRoots: [tempDir] });
      await loader.initialize();

      const skill = await loader.loadSkill('rich-skill');
      expect(skill).toBeDefined();
      expect(skill!.fileRefs).toContain('file.txt');
      expect(skill!.shellCommands).toContain('ls -la');
    });
  });
});

describe('getSkillLoader', () => {
  afterEach(() => {
    resetSkillLoader();
  });

  it('returns same loader for same options', () => {
    const loader1 = getSkillLoader({ workingDir: '/tmp' });
    const loader2 = getSkillLoader({ workingDir: '/tmp' });

    expect(loader1).toBe(loader2);
  });

  it('returns different loader for different options', () => {
    const loader1 = getSkillLoader({ workingDir: '/tmp' });
    const loader2 = getSkillLoader({ workingDir: '/var' });

    expect(loader1).not.toBe(loader2);
  });

  it('returns different loader for different skill roots', () => {
    const loader1 = getSkillLoader({ skillRoots: ['/tmp'] });
    const loader2 = getSkillLoader({ skillRoots: ['/var'] });

    expect(loader1).not.toBe(loader2);
  });

  it('returns same loader for equivalent options', () => {
    const loader1 = getSkillLoader({ skillRoots: ['/tmp', '/var'] });
    const loader2 = getSkillLoader({ skillRoots: ['/var', '/tmp'] });

    expect(loader1).toBe(loader2);
  });
});

describe('initializeSkillLoader', () => {
  afterEach(() => {
    resetSkillLoader();
  });

  it('initializes and returns loader', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-init-test-'));
    try {
      const skillDir = path.join(tempDir, 'test-skill');
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(
        path.join(skillDir, 'SKILL.md'),
        `---
name: test-skill
description: A test skill
---
# Test Skill`
      );

      const loader = await initializeSkillLoader({ skillRoots: [tempDir] });
      expect(loader).toBeDefined();
      expect(loader.hasSkill('test-skill')).toBe(true);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe('resetSkillLoader', () => {
  it('resets global loader', () => {
    const loader1 = getSkillLoader();
    resetSkillLoader();
    const loader2 = getSkillLoader();

    expect(loader1).not.toBe(loader2);
  });
});

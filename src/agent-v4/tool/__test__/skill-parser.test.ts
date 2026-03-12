import { describe, expect, it } from 'vitest';
import {
  parseFrontmatter,
  stripFrontmatter,
  extractFileRefs,
  extractShellCommands,
  deriveDescriptionFromMarkdown,
  formatSkillForContext,
  isValidSkillName,
} from '../skill/parser';

describe('parseFrontmatter', () => {
  it('parses valid frontmatter', () => {
    const content = `---
name: test-skill
description: A test skill
license: MIT
version: 1.0.0
author: Test Author
---
# Test Skill
This is a test skill.`;

    const result = parseFrontmatter(content);
    expect(result).toEqual({
      name: 'test-skill',
      description: 'A test skill',
      license: 'MIT',
      version: '1.0.0',
      author: 'Test Author',
    });
  });

  it('parses frontmatter with quoted values', () => {
    const content = `---
name: "test-skill"
description: 'A test skill'
---
Content`;

    const result = parseFrontmatter(content);
    expect(result).toEqual({
      name: 'test-skill',
      description: 'A test skill',
    });
  });

  it('returns null for missing frontmatter', () => {
    const content = `# Test Skill
This is a test skill.`;

    const result = parseFrontmatter(content);
    expect(result).toBeNull();
  });

  it('returns null for incomplete frontmatter', () => {
    const content = `---
name: test-skill
---
Content`;

    const result = parseFrontmatter(content);
    expect(result).toBeNull();
  });

  it('returns null for frontmatter without name', () => {
    const content = `---
description: A test skill
---
Content`;

    const result = parseFrontmatter(content);
    expect(result).toBeNull();
  });

  it('returns null for frontmatter without description', () => {
    const content = `---
name: test-skill
---
Content`;

    const result = parseFrontmatter(content);
    expect(result).toBeNull();
  });

  it('handles frontmatter with extra whitespace', () => {
    const content = `---  
name: test-skill  
description: A test skill  
---
Content`;

    const result = parseFrontmatter(content);
    expect(result).toEqual({
      name: 'test-skill',
      description: 'A test skill',
    });
  });

  it('handles frontmatter with empty lines', () => {
    const content = `---
name: test-skill

description: A test skill
---
Content`;

    const result = parseFrontmatter(content);
    expect(result).toEqual({
      name: 'test-skill',
      description: 'A test skill',
    });
  });

  it('handles frontmatter with colons in values', () => {
    const content = `---
name: test-skill
description: A test skill: with colons
---
Content`;

    const result = parseFrontmatter(content);
    expect(result).toEqual({
      name: 'test-skill',
      description: 'A test skill: with colons',
    });
  });

  it('handles frontmatter with special characters', () => {
    const content = `---
name: test-skill
description: A test skill with special chars: !@#$%^&*()
---
Content`;

    const result = parseFrontmatter(content);
    expect(result).toEqual({
      name: 'test-skill',
      description: 'A test skill with special chars: !@#$%^&*()',
    });
  });
});

describe('stripFrontmatter', () => {
  it('strips frontmatter from content', () => {
    const content = `---
name: test-skill
description: A test skill
---
# Test Skill
This is a test skill.`;

    const result = stripFrontmatter(content);
    expect(result).toBe(`# Test Skill
This is a test skill.`);
  });

  it('returns original content when no frontmatter', () => {
    const content = `# Test Skill
This is a test skill.`;

    const result = stripFrontmatter(content);
    expect(result).toBe(content);
  });

  it('handles frontmatter with trailing newline', () => {
    const content = `---
name: test-skill
description: A test skill
---

# Test Skill`;

    const result = stripFrontmatter(content);
    expect(result).toBe(`# Test Skill`);
  });

  it('handles frontmatter without trailing newline', () => {
    const content = `---
name: test-skill
description: A test skill
---
# Test Skill`;

    const result = stripFrontmatter(content);
    expect(result).toBe(`# Test Skill`);
  });

  it('handles empty content', () => {
    const result = stripFrontmatter('');
    expect(result).toBe('');
  });

  it('handles content with only frontmatter', () => {
    const content = `---
name: test-skill
description: A test skill
---`;

    const result = stripFrontmatter(content);
    expect(result).toBe('');
  });
});

describe('extractFileRefs', () => {
  it('extracts file references', () => {
    const content = `Check @file.txt and @./path/to/file.js for details.`;
    const result = extractFileRefs(content);
    expect(result).toEqual(['file.txt', './path/to/file.js']);
  });

  it('extracts file references with different extensions', () => {
    const content = `Files: @file.txt, @file.js, @file.ts, @file.json, @file.md`;
    const result = extractFileRefs(content);
    expect(result).toEqual(['file.txt', 'file.js', 'file.ts', 'file.json', 'file.md']);
  });

  it('extracts file references with paths', () => {
    const content = `Files: @./relative/path.txt, @../parent/path.txt, @/absolute/path.txt`;
    const result = extractFileRefs(content);
    expect(result).toEqual(['./relative/path.txt', '../parent/path.txt', '/absolute/path.txt']);
  });

  it('extracts file references with backslashes', () => {
    const content = `Files: @.\\relative\\path.txt, @..\\parent\\path.txt`;
    const result = extractFileRefs(content);
    expect(result).toEqual(['.\\relative\\path.txt', '..\\parent\\path.txt']);
  });

  it('does not extract file references in code blocks', () => {
    const content = `\`@file.txt\` is in code block.`;
    const result = extractFileRefs(content);
    expect(result).toEqual([]);
  });

  it('does not extract file references in words', () => {
    const content = `email@example.com is not a file reference.`;
    const result = extractFileRefs(content);
    expect(result).toEqual([]);
  });

  it('handles empty content', () => {
    const result = extractFileRefs('');
    expect(result).toEqual([]);
  });

  it('handles content with no file references', () => {
    const content = `This is just text without any file references.`;
    const result = extractFileRefs(content);
    expect(result).toEqual([]);
  });

  it('deduplicates file references', () => {
    const content = `@file.txt and @file.txt again.`;
    const result = extractFileRefs(content);
    expect(result).toEqual(['file.txt']);
  });

  it('extracts file references with complex paths', () => {
    const content = `@./path/to/file-name_123.txt and @../other/path/file.name.js`;
    const result = extractFileRefs(content);
    expect(result).toEqual(['./path/to/file-name_123.txt', '../other/path/file.name.js']);
  });
});

describe('extractShellCommands', () => {
  it('extracts shell commands', () => {
    const content = `Run !\`ls -la\` and !\`pwd\` commands.`;
    const result = extractShellCommands(content);
    expect(result).toEqual(['ls -la', 'pwd']);
  });

  it('extracts shell commands with arguments', () => {
    const content = `Run !\`git status\` and !\`npm install --save\`.`;
    const result = extractShellCommands(content);
    expect(result).toEqual(['git status', 'npm install --save']);
  });

  it('extracts shell commands with pipes', () => {
    const content = `Run !\`ls -la | grep test\`.`;
    const result = extractShellCommands(content);
    expect(result).toEqual(['ls -la | grep test']);
  });

  it('extracts shell commands with redirections', () => {
    const content = `Run !\`echo "test" > file.txt\`.`;
    const result = extractShellCommands(content);
    expect(result).toEqual(['echo "test" > file.txt']);
  });

  it('does not extract shell commands in regular backticks', () => {
    const content = `\`ls -la\` is not a shell command.`;
    const result = extractShellCommands(content);
    expect(result).toEqual([]);
  });

  it('handles empty content', () => {
    const result = extractShellCommands('');
    expect(result).toEqual([]);
  });

  it('handles content with no shell commands', () => {
    const content = `This is just text without any shell commands.`;
    const result = extractShellCommands(content);
    expect(result).toEqual([]);
  });

  it('deduplicates shell commands', () => {
    const content = `!\`ls -la\` and !\`ls -la\` again.`;
    const result = extractShellCommands(content);
    expect(result).toEqual(['ls -la']);
  });

  it('extracts shell commands with special characters', () => {
    const content = `Run !\`echo "Hello, World!"\` and !\`ls -la | grep "test"\`.`;
    const result = extractShellCommands(content);
    expect(result).toEqual(['echo "Hello, World!"', 'ls -la | grep "test"']);
  });
});

describe('deriveDescriptionFromMarkdown', () => {
  it('derives description from first non-heading line', () => {
    const content = `# Test Skill
This is a test skill description.
More content here.`;

    const result = deriveDescriptionFromMarkdown(content);
    expect(result).toBe('This is a test skill description.');
  });

  it('skips heading lines', () => {
    const content = `# Test Skill
## Subheading
This is the actual description.`;

    const result = deriveDescriptionFromMarkdown(content);
    expect(result).toBe('This is the actual description.');
  });

  it('truncates long descriptions', () => {
    const longText = 'A'.repeat(200);
    const content = `# Test Skill
${longText}`;

    const result = deriveDescriptionFromMarkdown(content);
    expect(result).toBe('A'.repeat(177) + '...');
  });

  it('handles empty content', () => {
    const result = deriveDescriptionFromMarkdown('');
    expect(result).toBe('No description provided');
  });

  it('handles content with only headings', () => {
    const content = `# Test Skill
## Subheading
### Another heading`;

    const result = deriveDescriptionFromMarkdown(content);
    expect(result).toBe('No description provided');
  });

  it('handles content with frontmatter', () => {
    const content = `---
name: test-skill
description: A test skill
---
# Test Skill
This is the actual content.`;

    const result = deriveDescriptionFromMarkdown(content);
    expect(result).toBe('This is the actual content.');
  });

  it('handles content with empty lines', () => {
    const content = `# Test Skill

This is the description after empty lines.`;

    const result = deriveDescriptionFromMarkdown(content);
    expect(result).toBe('This is the description after empty lines.');
  });

  it('handles content with whitespace', () => {
    const content = `# Test Skill
   
   This is the description with whitespace.`;

    const result = deriveDescriptionFromMarkdown(content);
    expect(result).toBe('This is the description with whitespace.');
  });
});

describe('formatSkillForContext', () => {
  it('formats skill with all fields', () => {
    const skill = {
      metadata: {
        name: 'test-skill',
        description: 'A test skill',
        path: '/path/to/skill',
      },
      content: 'Skill content here.',
      fileRefs: ['file1.txt', 'file2.js'],
      shellCommands: ['ls -la', 'pwd'],
    };

    const result = formatSkillForContext(skill);
    expect(result).toContain('## Skill: test-skill');
    expect(result).toContain('Description: A test skill');
    expect(result).toContain('Base directory: /path/to/skill');
    expect(result).toContain('Referenced files:');
    expect(result).toContain('- file1.txt');
    expect(result).toContain('- file2.js');
    expect(result).toContain('Shell commands:');
    expect(result).toContain('- !`ls -la`');
    expect(result).toContain('- !`pwd`');
    expect(result).toContain('Skill content here.');
  });

  it('formats skill without file refs', () => {
    const skill = {
      metadata: {
        name: 'test-skill',
        description: 'A test skill',
        path: '/path/to/skill',
      },
      content: 'Skill content here.',
      fileRefs: [],
      shellCommands: ['ls -la'],
    };

    const result = formatSkillForContext(skill);
    expect(result).not.toContain('Referenced files:');
    expect(result).toContain('Shell commands:');
  });

  it('formats skill without shell commands', () => {
    const skill = {
      metadata: {
        name: 'test-skill',
        description: 'A test skill',
        path: '/path/to/skill',
      },
      content: 'Skill content here.',
      fileRefs: ['file1.txt'],
      shellCommands: [],
    };

    const result = formatSkillForContext(skill);
    expect(result).toContain('Referenced files:');
    expect(result).not.toContain('Shell commands:');
  });

  it('formats skill without file refs and shell commands', () => {
    const skill = {
      metadata: {
        name: 'test-skill',
        description: 'A test skill',
        path: '/path/to/skill',
      },
      content: 'Skill content here.',
      fileRefs: [],
      shellCommands: [],
    };

    const result = formatSkillForContext(skill);
    expect(result).not.toContain('Referenced files:');
    expect(result).not.toContain('Shell commands:');
  });
});

describe('isValidSkillName', () => {
  it('returns true for valid skill names', () => {
    expect(isValidSkillName('test-skill')).toBe(true);
    expect(isValidSkillName('test.skill')).toBe(true);
    expect(isValidSkillName('test_skill')).toBe(true);
    expect(isValidSkillName('test123')).toBe(true);
    expect(isValidSkillName('test-skill-123')).toBe(true);
    expect(isValidSkillName('test.skill.123')).toBe(true);
    expect(isValidSkillName('test_skill_123')).toBe(true);
  });

  it('returns false for empty name', () => {
    expect(isValidSkillName('')).toBe(false);
  });

  it('returns false for name longer than 64 characters', () => {
    const longName = 'a'.repeat(65);
    expect(isValidSkillName(longName)).toBe(false);
  });

  it('returns false for name with invalid characters', () => {
    expect(isValidSkillName('Test-Skill')).toBe(false); // uppercase
    expect(isValidSkillName('test skill')).toBe(false); // space
    expect(isValidSkillName('test@skill')).toBe(false); // @
    expect(isValidSkillName('test#skill')).toBe(false); // #
    expect(isValidSkillName('test$skill')).toBe(false); // $
    expect(isValidSkillName('test%skill')).toBe(false); // %
    expect(isValidSkillName('test^skill')).toBe(false); // ^
    expect(isValidSkillName('test&skill')).toBe(false); // &
    expect(isValidSkillName('test*skill')).toBe(false); // *
    expect(isValidSkillName('test(skill')).toBe(false); // (
    expect(isValidSkillName('test)skill')).toBe(false); // )
    expect(isValidSkillName('test+skill')).toBe(false); // +
    expect(isValidSkillName('test=skill')).toBe(false); // =
    expect(isValidSkillName('test[skill')).toBe(false); // [
    expect(isValidSkillName('test]skill')).toBe(false); // ]
    expect(isValidSkillName('test{skill')).toBe(false); // {
    expect(isValidSkillName('test}skill')).toBe(false); // }
    expect(isValidSkillName('test|skill')).toBe(false); // |
    expect(isValidSkillName('test\\skill')).toBe(false); // \
    expect(isValidSkillName('test/skill')).toBe(false); // /
    expect(isValidSkillName('test:skill')).toBe(false); // :
    expect(isValidSkillName('test;skill')).toBe(false); // ;
    expect(isValidSkillName('test"skill')).toBe(false); // "
    expect(isValidSkillName("test'skill")).toBe(false); // '
    expect(isValidSkillName('test<skill')).toBe(false); // <
    expect(isValidSkillName('test>skill')).toBe(false); // >
    expect(isValidSkillName('test,skill')).toBe(false); // ,
    expect(isValidSkillName('test--skill')).toBe(false); // double dash
  });

  it('returns false for name starting or ending with special characters', () => {
    expect(isValidSkillName('-test-skill')).toBe(false); // leading dash
    expect(isValidSkillName('test-skill-')).toBe(false); // trailing dash
    // Note: dots and underscores are allowed at start/end
    expect(isValidSkillName('.test.skill')).toBe(true); // leading dot is allowed
    expect(isValidSkillName('test.skill.')).toBe(true); // trailing dot is allowed
    expect(isValidSkillName('_test_skill')).toBe(true); // leading underscore is allowed
    expect(isValidSkillName('test_skill_')).toBe(true); // trailing underscore is allowed
  });

  it('returns true for name with exactly 64 characters', () => {
    const validName = 'a'.repeat(64);
    expect(isValidSkillName(validName)).toBe(true);
  });

  it('returns true for name with mixed valid characters', () => {
    expect(isValidSkillName('test-skill_123.456')).toBe(true);
    expect(isValidSkillName('test.skill-123_456')).toBe(true);
    expect(isValidSkillName('test_skill-123.456')).toBe(true);
  });
});

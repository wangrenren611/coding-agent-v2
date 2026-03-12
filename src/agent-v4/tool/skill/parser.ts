import type { SkillFrontmatter } from './types';

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---/;
const FILE_REF_REGEX = /(?<![`\w])@(\.{0,2}[/\\]?[^\s`,.*!?()]+(?:\.[^\s`,.*!?()]+)+)/g;
const SHELL_COMMAND_REGEX = /!`([^`]+)`/g;

export function parseFrontmatter(content: string): SkillFrontmatter | null {
  const matched = content.match(FRONTMATTER_REGEX);
  if (!matched) {
    return null;
  }

  const frontmatter: Partial<SkillFrontmatter> = {};
  for (const line of matched[1].split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex < 0) {
      continue;
    }

    const key = line.slice(0, colonIndex).trim();
    let value = line.slice(colonIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key === 'name') {
      frontmatter.name = value;
    }
    if (key === 'description') {
      frontmatter.description = value;
    }
    if (key === 'license') {
      frontmatter.license = value;
    }
    if (key === 'version') {
      frontmatter.version = value;
    }
    if (key === 'author') {
      frontmatter.author = value;
    }
  }

  if (!frontmatter.name || !frontmatter.description) {
    return null;
  }

  return frontmatter as SkillFrontmatter;
}

export function stripFrontmatter(content: string): string {
  const matched = content.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  if (!matched) {
    return content;
  }
  return content.slice(matched[0].length);
}

export function extractFileRefs(content: string): string[] {
  const matches = Array.from(content.matchAll(FILE_REF_REGEX), (match) => match[1]);
  return Array.from(new Set(matches));
}

export function extractShellCommands(content: string): string[] {
  const matches = Array.from(content.matchAll(SHELL_COMMAND_REGEX), (match) => match[1]);
  return Array.from(new Set(matches));
}

export function deriveDescriptionFromMarkdown(content: string): string {
  const stripped = stripFrontmatter(content);
  const lines = stripped
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    if (line.startsWith('#')) {
      continue;
    }
    return line.length > 180 ? `${line.slice(0, 177)}...` : line;
  }

  return 'No description provided';
}

export function formatSkillForContext(skill: {
  metadata: { name: string; description: string; path: string };
  content: string;
  fileRefs: string[];
  shellCommands: string[];
}): string {
  const lines: string[] = [
    `## Skill: ${skill.metadata.name}`,
    '',
    `Description: ${skill.metadata.description}`,
    `Base directory: ${skill.metadata.path}`,
  ];

  if (skill.fileRefs.length > 0) {
    lines.push('', 'Referenced files:');
    for (const fileRef of skill.fileRefs) {
      lines.push(`- ${fileRef}`);
    }
  }

  if (skill.shellCommands.length > 0) {
    lines.push('', 'Shell commands:');
    for (const shellCommand of skill.shellCommands) {
      lines.push(`- !\`${shellCommand}\``);
    }
  }

  lines.push('', '---', '', skill.content);
  return lines.join('\n');
}

export function isValidSkillName(name: string): boolean {
  if (name.length === 0 || name.length > 64) {
    return false;
  }
  return /^[a-z0-9._]+(?:-[a-z0-9._]+)*$/.test(name);
}

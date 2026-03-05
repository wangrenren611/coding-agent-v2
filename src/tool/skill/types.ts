export interface SkillMetadata {
  readonly name: string;
  readonly description: string;
  readonly path: string;
  readonly skillFilePath: string;
}

export interface Skill {
  readonly metadata: SkillMetadata;
  readonly content: string;
  readonly fileRefs: string[];
  readonly shellCommands: string[];
  readonly loadedAt: number;
}

export interface SkillLoaderOptions {
  skillRoots?: string[];
  workingDir?: string;
}

export interface SkillToolResult {
  name: string;
  description: string;
  baseDir: string;
  content: string;
  fileRefs?: string[];
  shellCommands?: string[];
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  version?: string;
  author?: string;
}

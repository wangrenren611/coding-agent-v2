import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  deriveDescriptionFromMarkdown,
  extractFileRefs,
  extractShellCommands,
  isValidSkillName,
  parseFrontmatter,
  stripFrontmatter,
} from './parser';
import type { Skill, SkillLoaderOptions, SkillMetadata } from './types';

const SKILL_FILE_NAME = 'SKILL.md';

function getDefaultSkillRoots(workingDir: string): string[] {
  const roots: string[] = [];
  const codexHome = process.env.CODEX_HOME?.trim();
  if (codexHome) {
    roots.push(path.join(codexHome, 'skills'));
  }

  roots.push(path.join(workingDir, '.agents', 'skills'));
  roots.push(path.join(os.homedir(), '.agents', 'skills'));
  roots.push(path.join(os.homedir(), '.codex', 'skills'));

  return Array.from(new Set(roots.map((dir) => path.resolve(dir))));
}

function toLoaderKey(options?: SkillLoaderOptions): string {
  const roots = options?.skillRoots?.map((root) => path.resolve(root)).sort() || [];
  const workingDir = path.resolve(options?.workingDir || process.cwd());
  return JSON.stringify({ roots, workingDir });
}

export class SkillLoader {
  private readonly roots: string[];
  private readonly metadataMap = new Map<string, SkillMetadata>();
  private readonly skillCache = new Map<string, Skill>();
  private initialized = false;

  constructor(options: SkillLoaderOptions = {}) {
    const workingDir = options.workingDir ?? process.cwd();
    this.roots = options.skillRoots?.length
      ? options.skillRoots.map((dir) => path.resolve(dir))
      : getDefaultSkillRoots(workingDir);
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.metadataMap.clear();
    const skillFiles = await this.discoverSkillFiles();

    for (const skillFilePath of skillFiles) {
      const metadata = await this.loadMetadata(skillFilePath);
      if (!metadata) {
        continue;
      }
      if (!this.metadataMap.has(metadata.name)) {
        this.metadataMap.set(metadata.name, metadata);
      }
    }

    this.initialized = true;
  }

  getAllMetadata(): SkillMetadata[] {
    return Array.from(this.metadataMap.values()).sort((left, right) =>
      left.name.localeCompare(right.name)
    );
  }

  hasSkill(name: string): boolean {
    return this.metadataMap.has(name);
  }

  async loadSkill(name: string): Promise<Skill | null> {
    const cached = this.skillCache.get(name);
    if (cached) {
      return cached;
    }

    const metadata = this.metadataMap.get(name);
    if (!metadata) {
      return null;
    }

    let rawContent: string;
    try {
      rawContent = await fs.readFile(metadata.skillFilePath, 'utf-8');
    } catch {
      return null;
    }

    const content = stripFrontmatter(rawContent).trim();
    const skill: Skill = {
      metadata,
      content,
      fileRefs: extractFileRefs(content),
      shellCommands: extractShellCommands(content),
      loadedAt: Date.now(),
    };

    this.skillCache.set(name, skill);
    return skill;
  }

  private async discoverSkillFiles(): Promise<string[]> {
    const files: string[] = [];
    for (const root of this.roots) {
      const discovered = await this.walkSkillFiles(root);
      files.push(...discovered);
    }
    return files;
  }

  private async walkSkillFiles(rootDirectory: string): Promise<string[]> {
    let stats: Awaited<ReturnType<typeof fs.stat>>;
    try {
      stats = await fs.stat(rootDirectory);
    } catch {
      return [];
    }

    if (!stats.isDirectory()) {
      return [];
    }

    const queue = [rootDirectory];
    const skillFiles: string[] = [];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      let realCurrent: string;
      try {
        realCurrent = await fs.realpath(current);
      } catch {
        continue;
      }

      if (visited.has(realCurrent)) {
        continue;
      }
      visited.add(realCurrent);

      let entries: Dirent[];
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const entryPath = path.join(current, entry.name);
        if (entry.isFile() && entry.name === SKILL_FILE_NAME) {
          skillFiles.push(entryPath);
          continue;
        }

        if (entry.isDirectory()) {
          queue.push(entryPath);
        }
      }
    }

    return skillFiles;
  }

  private async loadMetadata(skillFilePath: string): Promise<SkillMetadata | null> {
    let content: string;
    try {
      content = await fs.readFile(skillFilePath, 'utf-8');
    } catch {
      return null;
    }

    const frontmatter = parseFrontmatter(content);
    const skillDirectory = path.dirname(skillFilePath);
    const fallbackName = path.basename(skillDirectory).toLowerCase();
    const name = (frontmatter?.name || fallbackName).trim();
    if (!isValidSkillName(name)) {
      return null;
    }

    const description = (frontmatter?.description || deriveDescriptionFromMarkdown(content)).trim();
    if (!description) {
      return null;
    }

    return {
      name,
      description,
      path: skillDirectory,
      skillFilePath,
    };
  }
}

let globalLoader: SkillLoader | null = null;
let globalLoaderKey: string | null = null;

export function getSkillLoader(options?: SkillLoaderOptions): SkillLoader {
  const nextKey = toLoaderKey(options);
  if (!globalLoader || globalLoaderKey !== nextKey) {
    globalLoader = new SkillLoader(options);
    globalLoaderKey = nextKey;
  }
  return globalLoader;
}

export async function initializeSkillLoader(options?: SkillLoaderOptions): Promise<SkillLoader> {
  const loader = getSkillLoader(options);
  await loader.initialize();
  return loader;
}

export function resetSkillLoader(): void {
  globalLoader = null;
  globalLoaderKey = null;
}

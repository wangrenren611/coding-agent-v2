import { z } from 'zod';
import { BaseTool } from './base';
import type { ToolExecutionContext, ToolResult } from './types';
import { formatSkillForContext } from './skill/parser';
import { getSkillLoader, initializeSkillLoader } from './skill/loader';
import type { SkillLoaderOptions, SkillToolResult } from './skill/types';

const schema = z
  .object({
    name: z.string().min(1).describe('Skill identifier from available skills list'),
  })
  .strict();

export interface SkillToolOptions {
  includeSkillList?: boolean;
  loaderOptions?: SkillLoaderOptions;
}

export class SkillTool extends BaseTool<typeof schema> {
  private readonly includeSkillList: boolean;
  private readonly loaderOptions?: SkillLoaderOptions;
  private cachedDescription: string | null = null;

  constructor(options: SkillToolOptions = {}) {
    super();
    this.includeSkillList = options.includeSkillList ?? true;
    this.loaderOptions = options.loaderOptions;
  }

  get meta() {
    return {
      name: 'skill',
      description: this.descriptionText,
      parameters: schema,
      category: 'workflow',
      tags: ['skill', 'knowledge', 'instructions'],
    };
  }

  refreshDescription(): void {
    this.cachedDescription = null;
  }

  async execute(args: z.infer<typeof schema>, _context: ToolExecutionContext): Promise<ToolResult> {
    await initializeSkillLoader(this.loaderOptions);
    const loader = getSkillLoader(this.loaderOptions);

    if (!loader.hasSkill(args.name)) {
      const availableSkills = loader.getAllMetadata().map((item) => item.name);
      const suggestion =
        availableSkills.length > 0
          ? `Available skills: ${availableSkills.join(', ')}`
          : 'No skills are currently available.';
      return this.failure(`SKILL_NOT_FOUND: Skill "${args.name}" not found. ${suggestion}`, {
        error: 'SKILL_NOT_FOUND',
        suggestion,
        requested_name: args.name,
      });
    }

    const skill = await loader.loadSkill(args.name);
    if (!skill) {
      return this.failure(`SKILL_LOAD_FAILED: Failed to load skill "${args.name}"`, {
        error: 'SKILL_LOAD_FAILED',
        requested_name: args.name,
      });
    }

    const metadata: SkillToolResult = {
      name: skill.metadata.name,
      description: skill.metadata.description,
      baseDir: skill.metadata.path,
      content: skill.content,
      fileRefs: skill.fileRefs,
      shellCommands: skill.shellCommands,
    };

    return this.success(metadata, formatSkillForContext(skill));
  }

  private get descriptionText(): string {
    if (this.cachedDescription) {
      return this.cachedDescription;
    }
    this.cachedDescription = this.generateDescription();
    return this.cachedDescription;
  }

  private generateDescription(): string {
    const base = [
      'Load a skill to get detailed task-specific instructions.',
      'Skills contain specialized workflows and context.',
      '',
    ].join('\n');

    if (!this.includeSkillList) {
      return base;
    }

    const loader = getSkillLoader(this.loaderOptions);
    const skills = loader.getAllMetadata();
    if (skills.length === 0) {
      return `${base}No skills are currently available.`;
    }

    const lines = skills.map((skill) => `- ${skill.name}: ${skill.description}`);
    return `${base}Available skills:\n${lines.join('\n')}`;
  }
}

export function createSkillTool(options: SkillToolOptions = {}): SkillTool {
  return new SkillTool(options);
}

export const defaultSkillTool = createSkillTool();
export const simpleSkillTool = createSkillTool({ includeSkillList: false });

export default SkillTool;

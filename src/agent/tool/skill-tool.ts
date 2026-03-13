import { z } from 'zod';
import { BaseTool, ToolResult } from './base-tool';
import { ToolExecutionError } from './error';
import { formatSkillForContext } from './skill/parser';
import { getSkillLoader, initializeSkillLoader } from './skill/loader';
import type { SkillLoaderOptions } from './skill/types';
import { SKILL_TOOL_BASE_DESCRIPTION } from './tool-prompts';

const schema = z
  .object({
    name: z.string().min(1).describe('Skill identifier from available skills list'),
  })
  .strict();

export interface SkillToolOptions {
  includeSkillList?: boolean;
  loaderOptions?: SkillLoaderOptions;
}

interface SkillToolPayload {
  name: string;
  description: string;
  baseDir: string;
  content: string;
  fileRefs: string[];
  shellCommands: string[];
}

export class SkillTool extends BaseTool<typeof schema> {
  name = 'skill';
  parameters = schema;

  private readonly includeSkillList: boolean;
  private readonly loaderOptions?: SkillLoaderOptions;
  private cachedDescription: string | null = null;

  constructor(options: SkillToolOptions = {}) {
    super();
    this.includeSkillList = options.includeSkillList ?? true;
    this.loaderOptions = options.loaderOptions;
  }

  get description(): string {
    if (!this.cachedDescription) {
      this.cachedDescription = this.buildDescription();
    }
    return this.cachedDescription;
  }

  refreshDescription(): void {
    this.cachedDescription = null;
  }

  override getConcurrencyMode(): 'parallel-safe' {
    return 'parallel-safe';
  }

  override getConcurrencyLockKey(args: z.infer<typeof schema>): string {
    return `skill:${args.name}`;
  }

  async execute(args: z.infer<typeof schema>): Promise<ToolResult> {
    try {
      await initializeSkillLoader(this.loaderOptions);
      const loader = getSkillLoader(this.loaderOptions);

      if (!loader.hasSkill(args.name)) {
        const availableSkills = loader.getAllMetadata().map((item) => item.name);
        const suggestion =
          availableSkills.length > 0
            ? `Available skills: ${availableSkills.join(', ')}`
            : 'No skills are currently available.';
        const message = `SKILL_NOT_FOUND: Skill "${args.name}" not found. ${suggestion}`;

        return {
          success: false,
          output: message,
          error: new ToolExecutionError(message),
          metadata: {
            error: 'SKILL_NOT_FOUND',
            suggestion,
            requested_name: args.name,
          },
        };
      }

      const skill = await loader.loadSkill(args.name);
      if (!skill) {
        const message = `SKILL_LOAD_FAILED: Failed to load skill "${args.name}"`;
        return {
          success: false,
          output: message,
          error: new ToolExecutionError(message),
          metadata: {
            error: 'SKILL_LOAD_FAILED',
            requested_name: args.name,
          },
        };
      }

      const payload: SkillToolPayload = {
        name: skill.metadata.name,
        description: skill.metadata.description,
        baseDir: skill.metadata.path,
        content: skill.content,
        fileRefs: skill.fileRefs,
        shellCommands: skill.shellCommands,
      };

      return {
        success: true,
        output: formatSkillForContext(skill),
        metadata: payload as unknown as Record<string, unknown>,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        output: message,
        error: new ToolExecutionError(message),
      };
    }
  }

  private buildDescription(): string {
    const base = `${SKILL_TOOL_BASE_DESCRIPTION}\n\n`;

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

export default SkillTool;

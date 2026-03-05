import { z } from 'zod';
import { BaseTool } from './base';
import type { ToolExecutionContext, ToolResult } from './types';
import {
  DEFAULT_IGNORE_GLOBS,
  collectFilesByGlob,
  resolveSearchRoot,
  normalizeAllowedDirectories,
} from './search/common';

const schema = z
  .object({
    pattern: z.string().min(1).describe('Glob pattern like **/*.ts or src/**/*.test.ts'),
    path: z
      .string()
      .optional()
      .describe('Search root directory, default current working directory'),
    include_hidden: z
      .boolean()
      .optional()
      .default(false)
      .describe('Include hidden files/directories'),
    ignore_patterns: z
      .array(z.string())
      .optional()
      .describe('Additional ignore patterns applied before matching'),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(10000)
      .optional()
      .default(200)
      .describe('Maximum number of matched files to return'),
  })
  .strict();

export interface GlobToolOptions {
  allowedDirectories?: string[];
}

export class GlobTool extends BaseTool<typeof schema> {
  private readonly allowedDirectories: string[];

  constructor(options: GlobToolOptions = {}) {
    super();
    this.allowedDirectories = normalizeAllowedDirectories(
      options.allowedDirectories ?? [process.cwd()]
    );
  }

  get meta() {
    return {
      name: 'glob',
      description:
        'Find files by glob pattern. Use this when you need path-level discovery before reading or grepping.',
      parameters: schema,
      category: 'filesystem',
      tags: ['search', 'glob', 'files'],
    };
  }

  async execute(args: z.infer<typeof schema>, _context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const { rootPath } = await resolveSearchRoot({
        requestedPath: args.path,
        allowedDirectories: this.allowedDirectories,
      });

      const ignorePatterns = [...DEFAULT_IGNORE_GLOBS, ...(args.ignore_patterns ?? [])];
      const { files, truncated } = await collectFilesByGlob({
        rootPath,
        pattern: args.pattern,
        includeHidden: args.include_hidden,
        ignorePatterns,
        maxResults: args.max_results,
      });

      if (files.length === 0) {
        return this.success(
          {
            pattern: args.pattern,
            path: rootPath,
            files: [],
            total: 0,
            truncated: false,
          },
          `No files found matching pattern: ${args.pattern}`
        );
      }

      return this.success(
        {
          pattern: args.pattern,
          path: rootPath,
          files: files.map((file) => file.absolutePath),
          relative_files: files.map((file) => file.relativePath),
          total: files.length,
          truncated,
        },
        `Found ${files.length} file(s) matching pattern: ${args.pattern}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.failure(message, {
        error: this.extractErrorCode(message),
        message,
      });
    }
  }

  private extractErrorCode(message: string): string {
    const matched = message.match(/^([A-Z][A-Z0-9_]{2,})(?::|$)/);
    if (matched) {
      return matched[1];
    }
    return 'GLOB_OPERATION_FAILED';
  }
}

export default GlobTool;

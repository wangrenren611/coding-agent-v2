import { z } from 'zod';
import { BaseTool, ToolConfirmDetails, ToolResult } from './base-tool';
import { ToolExecutionError } from './error';
import { collectFilesByGlob, DEFAULT_IGNORE_GLOBS, resolveSearchRoot } from './search/common';
import {
  assessPathAccess,
  ensurePathWithinAllowed,
  normalizeAllowedDirectories,
  resolveRequestedPath,
} from './path-security';
import { GLOB_TOOL_DESCRIPTION } from './tool-prompts';
import type { ToolExecutionContext } from './types';

const schema = z
  .object({
    pattern: z.string().min(1).describe('Glob pattern like **/*.ts or src/**/*.test.ts'),
    path: z.string().optional().describe('Base directory (default: current working directory)'),
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

interface GlobSuccessPayload {
  pattern: string;
  path: string;
  files: string[];
  relative_files?: string[];
  total: number;
  truncated: boolean;
}

export class GlobTool extends BaseTool<typeof schema> {
  name = 'glob';
  description = GLOB_TOOL_DESCRIPTION;
  parameters = schema;

  private readonly allowedDirectories: string[];

  constructor(options: GlobToolOptions = {}) {
    super();
    this.allowedDirectories = normalizeAllowedDirectories(options.allowedDirectories);
  }

  override getConcurrencyMode(): 'parallel-safe' {
    return 'parallel-safe';
  }

  override getConcurrencyLockKey(args: z.infer<typeof schema>): string {
    return `glob:${args.path || process.cwd()}`;
  }

  override getConfirmDetails(args: z.infer<typeof schema>): ToolConfirmDetails | null {
    const requestedPath = args.path?.trim().length ? args.path : process.cwd();
    const absolute = resolveRequestedPath(requestedPath);
    const assessment = assessPathAccess(
      absolute,
      this.allowedDirectories,
      'SEARCH_PATH_NOT_ALLOWED'
    );
    if (assessment.allowed) {
      return null;
    }
    return {
      reason: assessment.message,
      metadata: {
        requestedPath: absolute,
        allowedDirectories: this.allowedDirectories,
        errorCode: 'SEARCH_PATH_NOT_ALLOWED',
      },
    };
  }

  async execute(args: z.infer<typeof schema>, context?: ToolExecutionContext): Promise<ToolResult> {
    try {
      let rootPath: string;
      if (context?.confirmationApproved === true) {
        const requestedPath = args.path?.trim().length ? args.path : process.cwd();
        const absolute = resolveRequestedPath(requestedPath);
        rootPath = ensurePathWithinAllowed(
          absolute,
          this.allowedDirectories,
          'SEARCH_PATH_NOT_ALLOWED',
          true
        );
      } else {
        ({ rootPath } = await resolveSearchRoot({
          requestedPath: args.path,
          allowedDirectories: this.allowedDirectories,
        }));
      }

      const ignorePatterns = [...DEFAULT_IGNORE_GLOBS, ...(args.ignore_patterns || [])];
      const { files, truncated } = await collectFilesByGlob({
        rootPath,
        pattern: args.pattern,
        includeHidden: args.include_hidden,
        ignorePatterns,
        maxResults: args.max_results,
      });

      if (files.length === 0) {
        return {
          success: true,
          output: `No files found matching pattern: ${args.pattern}`,
          metadata: {
            pattern: args.pattern,
            path: rootPath,
            files: [],
            total: 0,
            truncated: false,
          } as unknown as Record<string, unknown>,
        };
      }

      const payload: GlobSuccessPayload = {
        pattern: args.pattern,
        path: rootPath,
        files: files.map((file) => file.absolutePath),
        relative_files: files.map((file) => file.relativePath),
        total: files.length,
        truncated,
      };

      return {
        success: true,
        output: `Found ${files.length} file(s) matching pattern: ${args.pattern}`,
        metadata: payload as unknown as Record<string, unknown>,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        output: message,
        error: new ToolExecutionError(message),
        metadata: {
          error: this.extractErrorCode(message),
          message,
        },
      };
    }
  }

  private extractErrorCode(message: string): string {
    const matched = message.match(/^([A-Z][A-Z0-9_]{2,})(?::|$)/);
    if (matched?.[1]) {
      return matched[1];
    }
    return 'GLOB_OPERATION_FAILED';
  }
}

export default GlobTool;

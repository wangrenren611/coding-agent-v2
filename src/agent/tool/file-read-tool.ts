import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { BaseTool, ToolConfirmDetails, ToolResult } from './base-tool';
import { ToolExecutionError } from './error';
import {
  assessPathAccess,
  ensurePathWithinAllowed,
  normalizeAllowedDirectories,
  resolveRequestedPath,
} from './path-security';
import { FILE_READ_TOOL_DESCRIPTION } from './tool-prompts';
import type { ToolExecutionContext } from './types';

const schema = z
  .object({
    path: z.string().min(1).describe('The absolute or relative path to the file'),
    // 起始行号（0-based）
    startLine: z.coerce
      .number()
      .min(0)
      .describe('The line number to start reading from (0-based)')
      .optional(),
    // 读取行数
    limit: z.coerce
      .number()
      .min(1)
      .describe('The number of lines to read (defaults to 1000)')
      .optional(),
  })
  .strict();

export interface FileReadToolOptions {
  allowedDirectories?: string[];
  maxOutputLength?: number;
}

interface FileReadPayload {
  path: string;
  content: string;
  etag: string;
  truncated: boolean;
  originalLength?: number;
}

export class FileReadTool extends BaseTool<typeof schema> {
  name = 'file_read';
  description = FILE_READ_TOOL_DESCRIPTION;
  parameters = schema;

  private readonly allowedDirectories: string[];
  private readonly maxOutputLength: number;

  constructor(options: FileReadToolOptions = {}) {
    super();
    this.allowedDirectories = normalizeAllowedDirectories(options.allowedDirectories);
    this.maxOutputLength =
      options.maxOutputLength && options.maxOutputLength > 0 ? options.maxOutputLength : 2000;
  }

  override getConcurrencyMode(): 'parallel-safe' {
    return 'parallel-safe';
  }

  override getConcurrencyLockKey(args: z.infer<typeof schema>): string {
    return `file_read:${args.path}`;
  }

  override getConfirmDetails(args: z.infer<typeof schema>): ToolConfirmDetails | null {
    const absolute = resolveRequestedPath(args.path);
    const assessment = assessPathAccess(absolute, this.allowedDirectories, 'PATH_NOT_ALLOWED');
    if (assessment.allowed) {
      return null;
    }
    return {
      reason: assessment.message,
      metadata: {
        requestedPath: absolute,
        allowedDirectories: this.allowedDirectories,
        errorCode: 'PATH_NOT_ALLOWED',
      },
    };
  }

  async execute(args: z.infer<typeof schema>, context?: ToolExecutionContext): Promise<ToolResult> {
    const limit = args.limit ?? 1000;
    if (limit < 1) {
      const message = 'FILE_READ_INVALID_LIMIT: limit must be >= 1';
      return {
        success: false,
        output: message,
        error: new ToolExecutionError(message),
        metadata: {
          error: 'FILE_READ_INVALID_LIMIT',
          message: 'limit must be greater than or equal to 1',
          path: args.path,
          limit,
        },
      };
    }

    try {
      const absolute = resolveRequestedPath(args.path);
      const validatedPath = ensurePathWithinAllowed(
        absolute,
        this.allowedDirectories,
        'PATH_NOT_ALLOWED',
        context?.confirmationApproved === true
      );

      const stats = await fs.stat(validatedPath);
      if (!stats.isFile()) {
        throw new Error(`FILE_READ_NOT_FILE: ${validatedPath}`);
      }

      const fullContent = await fs.readFile(validatedPath, 'utf8');
      const slicedContent = this.sliceContentByLines(fullContent, args.startLine, limit);
      const truncatedResult = this.truncateOutput(slicedContent);

      const payload: FileReadPayload = {
        path: validatedPath,
        content: truncatedResult.output,
        etag: this.createEtag(fullContent),
        truncated: truncatedResult.truncated,
        originalLength: truncatedResult.truncated ? slicedContent.length : undefined,
      };

      return {
        success: true,
        output: payload.content,
        metadata: payload as unknown as Record<string, unknown>,
      };
    } catch (error) {
      const message = this.toFailureMessage(args.path, error);
      return {
        success: false,
        output: message,
        error: new ToolExecutionError(message),
      };
    }
  }

  private toFailureMessage(requestPath: string, error: unknown): string {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.message?.startsWith('PATH_NOT_ALLOWED:')) {
      return nodeError.message;
    }

    if (nodeError?.code === 'ENOENT') {
      return `FILE_READ_NOT_FOUND: ${requestPath}`;
    }
    if (nodeError?.code === 'EACCES' || nodeError?.code === 'EPERM') {
      return `FILE_READ_NO_PERMISSION: ${requestPath}`;
    }

    const message = error instanceof Error ? error.message : String(error);
    return `FILE_READ_FAILED: ${message}`;
  }

  private sliceContentByLines(content: string, startLine?: number, limit?: number): string {
    if (startLine === undefined && limit === undefined) {
      return content;
    }

    const normalized = content.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    const start = Math.max(startLine ?? 0, 0);
    const endExclusive = limit === undefined ? lines.length : Math.min(start + limit, lines.length);
    if (start >= lines.length || endExclusive <= start) {
      return '';
    }

    return lines.slice(start, endExclusive).join('\n');
  }

  private truncateOutput(input: string): { output: string; truncated: boolean } {
    if (input.length <= this.maxOutputLength) {
      return { output: input, truncated: false };
    }

    const marker = '\n\n[... Output Truncated ...]';
    const available = this.maxOutputLength - marker.length;
    if (available <= 20) {
      return {
        output: input.slice(0, this.maxOutputLength),
        truncated: true,
      };
    }

    const head = input.slice(0, available);
    const tailLineBreak = head.lastIndexOf('\n');
    const safeTailBreakThreshold = Math.floor(available * 0.6);
    const trimmedHead =
      tailLineBreak > safeTailBreakThreshold ? head.slice(0, tailLineBreak) : head;

    return {
      output: `${trimmedHead}${marker}`,
      truncated: true,
    };
  }

  private createEtag(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }
}

export default FileReadTool;

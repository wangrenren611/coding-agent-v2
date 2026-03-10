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
    startLine: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('The line number to start reading from (1-based, defaults to 1)'),
    endLine: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('The ending line number to read to (1-based, inclusive)'),
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
      options.maxOutputLength && options.maxOutputLength > 0 ? options.maxOutputLength : 30000;
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
    if (
      typeof args.startLine === 'number' &&
      typeof args.endLine === 'number' &&
      args.endLine < args.startLine
    ) {
      const message = 'FILE_READ_INVALID_LINE_RANGE: endLine must be >= startLine';
      return {
        success: false,
        output: message,
        error: new ToolExecutionError(message),
        metadata: {
          error: 'FILE_READ_INVALID_LINE_RANGE',
          message: 'endLine must be greater than or equal to startLine',
          path: args.path,
          startLine: args.startLine,
          endLine: args.endLine,
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
      const slicedContent = this.sliceContentByLines(fullContent, args.startLine, args.endLine);
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

  private sliceContentByLines(content: string, startLine?: number, endLine?: number): string {
    if (startLine === undefined && endLine === undefined) {
      return content;
    }

    const normalized = content.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }

    const start = Math.max((startLine ?? 1) - 1, 0);
    const endExclusive = endLine === undefined ? lines.length : Math.min(endLine, lines.length);
    if (start >= lines.length || endExclusive <= start) {
      return '';
    }

    return lines.slice(start, endExclusive).join('\n');
  }

  private truncateOutput(input: string): { output: string; truncated: boolean } {
    if (input.length <= this.maxOutputLength) {
      return { output: input, truncated: false };
    }

    const marker = '[... Output Truncated ...]';
    const separator = '\n\n';
    const reserved = marker.length + separator.length * 2;
    const available = this.maxOutputLength - reserved;
    if (available <= 20) {
      return {
        output: input.slice(0, this.maxOutputLength),
        truncated: true,
      };
    }

    const headLength = Math.floor(available / 2);
    const tailLength = available - headLength;

    return {
      output:
        input.slice(0, headLength) +
        `${separator}${marker}${separator}` +
        input.slice(Math.max(0, input.length - tailLength)),
      truncated: true,
    };
  }

  private createEtag(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }
}

export default FileReadTool;

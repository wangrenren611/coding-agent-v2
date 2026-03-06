import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { BaseTool } from './base';
import type { ToolExecutionContext, ToolResult } from './types';
import type { ExecutionTarget, FileBackend, FileBackendRouter } from './runtime';
import { LocalFileBackend, StaticFileBackendRouter } from './runtime';
import { setAllowedDirectories, validatePath } from './file/lib';

const schema = z.object({
  path: z.string().min(1).describe('File path to read'),
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
});

export interface FileReadToolOptions {
  fileBackendRouter?: FileBackendRouter;
  defaultExecutionTarget?: ExecutionTarget;
  allowedDirectories?: string[];
}

interface FileReadDataShape {
  path: string;
  content: string;
  etag?: string;
  truncated: boolean;
  originalLength?: number;
}

export class FileReadTool extends BaseTool<typeof schema> {
  private readonly fileBackendRouter: FileBackendRouter;
  private readonly defaultExecutionTarget?: ExecutionTarget;
  private readonly allowedDirectories: string[];

  constructor(options: FileReadToolOptions = {}) {
    super();
    const defaultAllowed = options.allowedDirectories?.length
      ? options.allowedDirectories
      : [process.cwd()];
    this.allowedDirectories = defaultAllowed.map((dir) => this.normalizeAllowedDirectory(dir));

    this.fileBackendRouter =
      options.fileBackendRouter ??
      new StaticFileBackendRouter({
        defaultTarget: 'local',
        backends: [
          new LocalFileBackend({
            rootDir: this.allowedDirectories[0],
          }),
        ],
      });

    this.defaultExecutionTarget =
      options.defaultExecutionTarget ?? this.getConfiguredExecutionTarget();
    this.syncAllowedDirectories();
  }

  get meta() {
    return {
      name: 'file_read',
      description: 'Read full text content from a file inside allowed directories.',
      parameters: schema,
      category: 'filesystem',
      tags: ['file', 'read', 'fs'],
      dangerous: false,
    };
  }

  async execute(args: z.infer<typeof schema>, _context: ToolExecutionContext): Promise<ToolResult> {
    if (
      typeof args.startLine === 'number' &&
      typeof args.endLine === 'number' &&
      args.endLine < args.startLine
    ) {
      return this.failure('FILE_READ_INVALID_LINE_RANGE: endLine must be >= startLine', {
        error: 'FILE_READ_INVALID_LINE_RANGE',
        message: 'endLine must be greater than or equal to startLine',
        path: args.path,
        startLine: args.startLine,
        endLine: args.endLine,
      });
    }

    try {
      const resolvedPath = await this.resolvePath(args.path);
      const backend = this.resolveBackend(resolvedPath);
      const result = await backend.readText(resolvedPath);
      const slicedContent = this.sliceContentByLines(result.content, args.startLine, args.endLine);
      const truncation = this.resultTruncation(slicedContent);

      return this.success(
        {
          path: resolvedPath,
          content: truncation.output,
          etag: result.etag,
          truncated: truncation.truncated,
          originalLength: truncation.truncated ? slicedContent.length : undefined,
        } satisfies FileReadDataShape,
        truncation.truncated
          ? 'File read successfully (content truncated)'
          : 'File read successfully'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.failure(`FILE_READ_FAILED: ${message}`, {
        error: 'FILE_READ_FAILED',
        message,
        path: args.path,
      });
    }
  }

  private sliceContentByLines(content: string, startLine?: number, endLine?: number): string {
    if (startLine === undefined && endLine === undefined) {
      return content;
    }

    const normalizedContent = content.replace(/\r\n/g, '\n');
    const lines = normalizedContent.split('\n');
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

  private getConfiguredExecutionTarget(): ExecutionTarget | undefined {
    const raw = process.env.FILE_TOOL_EXECUTION_TARGET?.trim().toLowerCase();
    if (!raw) return undefined;
    if (raw === 'local' || raw === 'remote' || raw === 'sandbox' || raw === 'custom') {
      return raw;
    }
    return undefined;
  }

  private syncAllowedDirectories(): void {
    setAllowedDirectories(this.allowedDirectories);
  }

  private normalizeAllowedDirectory(inputDir: string): string {
    const resolved = path.resolve(inputDir);
    try {
      return fs.realpathSync(resolved);
    } catch {
      return resolved;
    }
  }

  private async resolvePath(inputPath: string): Promise<string> {
    this.syncAllowedDirectories();
    return validatePath(inputPath);
  }

  private resolveBackend(validatedPath: string): FileBackend {
    return this.fileBackendRouter.route({
      path: validatedPath,
      mode: 'read',
      target: this.defaultExecutionTarget,
      profile: 'trusted',
    });
  }
}

export default FileReadTool;

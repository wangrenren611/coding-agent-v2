import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { BaseTool } from './base';
import type { ToolExecutionContext, ToolResult } from './types';
import type { ExecutionTarget, FileBackend, FileBackendRouter } from './runtime';
import { LocalFileBackend, StaticFileBackendRouter } from './runtime';
import { setAllowedDirectories, validatePath } from './file/lib';

const schema = z.object({
  path: z.string().min(1).describe('File or directory path to stat'),
});

export interface FileStatToolOptions {
  fileBackendRouter?: FileBackendRouter;
  defaultExecutionTarget?: ExecutionTarget;
  allowedDirectories?: string[];
}

interface FileStatDataShape {
  path: string;
  stats: unknown;
}

export class FileStatTool extends BaseTool<typeof schema> {
  private readonly fileBackendRouter: FileBackendRouter;
  private readonly defaultExecutionTarget?: ExecutionTarget;
  private readonly allowedDirectories: string[];

  constructor(options: FileStatToolOptions = {}) {
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
      name: 'file_stat',
      description: 'Get file or directory metadata for a path inside allowed directories.',
      parameters: schema,
      category: 'filesystem',
      tags: ['file', 'stat', 'fs'],
      dangerous: false,
    };
  }

  async execute(args: z.infer<typeof schema>, _context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const resolvedPath = await this.resolvePath(args.path);
      const backend = this.resolveBackend(resolvedPath);
      const stats = await backend.stat(resolvedPath);

      return this.success(
        {
          path: resolvedPath,
          stats,
        } satisfies FileStatDataShape,
        'Path stat fetched successfully'
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.failure(`FILE_STAT_FAILED: ${message}`, {
        error: 'FILE_STAT_FAILED',
        message,
        path: args.path,
      });
    }
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
      mode: 'stat',
      target: this.defaultExecutionTarget,
      profile: 'trusted',
    });
  }
}

export default FileStatTool;

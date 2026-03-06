import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { BaseTool } from './base';
import type { ToolExecutionContext, ToolResult } from './types';
import type { ExecutionTarget, FileBackend, FileBackendRouter } from './runtime';
import { LocalFileBackend, StaticFileBackendRouter } from './runtime';
import {
  applyEditsToContent,
  createUnifiedDiff,
  setAllowedDirectories,
  validatePath,
  type FileEdit,
} from './file/lib';

const fileEditSchema = z.object({
  oldText: z.string().describe('Text to replace'),
  newText: z.string().describe('Replacement text'),
});

const schema = z.object({
  path: z.string().min(1).describe('File path to edit'),
  edits: z.array(fileEditSchema).min(1).describe('Edits to apply'),
  dry_run: z.boolean().optional().describe('If true, only preview edit diff'),
});

export interface FileEditToolOptions {
  fileBackendRouter?: FileBackendRouter;
  defaultExecutionTarget?: ExecutionTarget;
  allowedDirectories?: string[];
}

interface FileEditDataShape {
  path: string;
  diff: string;
  changed: boolean;
  etag?: string;
}

interface ErrorWithCode extends Error {
  code?: string;
}

export class FileEditTool extends BaseTool<typeof schema> {
  private readonly fileBackendRouter: FileBackendRouter;
  private readonly defaultExecutionTarget?: ExecutionTarget;
  private readonly allowedDirectories: string[];

  constructor(options: FileEditToolOptions = {}) {
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
      name: 'file_edit',
      description: 'Apply old/new text edits to a file and return a unified diff.',
      parameters: schema,
      category: 'filesystem',
      tags: ['file', 'edit', 'patch', 'fs'],
      dangerous: true,
    };
  }

  async execute(args: z.infer<typeof schema>, _context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const resolvedPath = await this.resolvePath(args.path);
      const readBackend = this.resolveReadBackend(resolvedPath);
      const original = await readBackend.readText(resolvedPath);

      const edits: FileEdit[] = args.edits.map((edit) => ({
        oldText: edit.oldText,
        newText: edit.newText,
      }));

      const updatedContent = applyEditsToContent(original.content, edits);
      const changed = updatedContent !== original.content;
      const diff = createUnifiedDiff(original.content, updatedContent, resolvedPath);

      if (args.dry_run || !changed) {
        return this.success(
          {
            path: resolvedPath,
            diff,
            changed,
            etag: original.etag,
          } satisfies FileEditDataShape,
          args.dry_run ? 'Edit preview generated' : 'No changes required'
        );
      }

      const patchBackend = this.resolvePatchBackend(resolvedPath);
      await patchBackend.applyPatch(resolvedPath, diff, {
        etag: original.etag,
        profile: 'trusted',
        target: this.defaultExecutionTarget,
      });

      const latest = await this.resolveReadBackend(resolvedPath).readText(resolvedPath);
      return this.success(
        {
          path: resolvedPath,
          diff,
          changed: true,
          etag: latest.etag,
        } satisfies FileEditDataShape,
        'Edits applied successfully'
      );
    } catch (error) {
      return this.mapFailure(args, error);
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

  private resolveReadBackend(validatedPath: string): FileBackend {
    return this.fileBackendRouter.route({
      path: validatedPath,
      mode: 'read',
      target: this.defaultExecutionTarget,
      profile: 'trusted',
    });
  }

  private resolvePatchBackend(validatedPath: string): FileBackend {
    return this.fileBackendRouter.route({
      path: validatedPath,
      mode: 'patch',
      target: this.defaultExecutionTarget,
      profile: 'trusted',
    });
  }

  private mapFailure(args: z.infer<typeof schema>, rawError: unknown): ToolResult {
    const error: ErrorWithCode =
      rawError instanceof Error
        ? (rawError as ErrorWithCode)
        : (new Error(String(rawError)) as ErrorWithCode);

    if (
      error.code === 'EDIT_CONFLICT' ||
      error.message.includes('Could not find exact match for edit')
    ) {
      return this.failure(`EDIT_CONFLICT: ${error.message}`, {
        error: 'EDIT_CONFLICT',
        code: 'EDIT_CONFLICT',
        conflict: true,
        recoverable: true,
        message: error.message,
        agent_hint:
          'Edit oldText was not found in latest file content. Read latest content, update oldText anchor, then retry edit.',
        next_actions: ['file_read', 'file_edit'],
        path: args.path,
      });
    }

    return this.failure(`FILE_EDIT_FAILED: ${error.message}`, {
      error: 'FILE_EDIT_FAILED',
      message: error.message,
      path: args.path,
    });
  }
}

export default FileEditTool;

import path from 'path';
import fs from 'fs';
import { minimatch } from 'minimatch';
import { z } from 'zod';
import { BaseTool } from './base';
import type { ToolExecutionContext, ToolResult } from './types';
import type { ExecutionTarget, FileAccessMode, FileBackend, FileBackendRouter } from './runtime';
import { LocalFileBackend, StaticFileBackendRouter } from './runtime';
import FILE_DESCRIPTION from './file.description';
import {
  applyEditsToContent,
  createUnifiedDiff,
  setAllowedDirectories,
  validatePath,
  type FileEdit,
} from './file/lib';

const fileActionSchema = z.enum([
  'read',
  'write',
  'edit',
  'patch',
  'list',
  'stat',
  'search',
  'head',
  'tail',
]);

const fileEditSchema = z.object({
  oldText: z.string().describe('Text to replace'),
  newText: z.string().describe('Replacement text'),
});

const schema = z.object({
  action: fileActionSchema.describe('File operation action'),
  path: z.string().min(1).describe('File or directory path'),
  content: z.string().optional().describe('Full content used by write action'),
  edits: z.array(fileEditSchema).optional().describe('Edits used by edit action'),
  diff: z.string().optional().describe('Unified diff patch used by patch action'),
  dry_run: z.boolean().optional().describe('If true, only preview edit diff without writing'),
  pattern: z.string().optional().describe('Glob pattern used by search action'),
  exclude_patterns: z
    .array(z.string())
    .optional()
    .describe('Glob exclude patterns used by search action'),
  num_lines: z.number().int().min(1).max(10000).optional().describe('Line count for head/tail'),
  recursive: z.boolean().optional().describe('Whether search should recurse, default true'),
  max_results: z.number().int().min(1).max(10000).optional().describe('Max search results'),
  atomic: z.boolean().optional().describe('Atomic write for write action, default true'),
  etag: z.string().optional().describe('Optimistic concurrency tag for write/patch actions'),
});

export interface FileToolOptions {
  fileBackendRouter?: FileBackendRouter;
  defaultExecutionTarget?: ExecutionTarget;
  allowedDirectories?: string[];
}

interface FileToolDataShape {
  path?: string;
  content?: string;
  diff?: string;
  etag?: string;
  changed?: boolean;
  entries?: unknown[];
  stats?: unknown;
  matches?: string[];
  total?: number;
}

interface ErrorWithCode extends Error {
  code?: string;
  conflict?: boolean;
  path?: string;
}

export class FileTool extends BaseTool<typeof schema> {
  private readonly fileBackendRouter: FileBackendRouter;
  private readonly defaultExecutionTarget?: ExecutionTarget;
  private readonly allowedDirectories: string[];

  constructor(options: FileToolOptions = {}) {
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
      name: 'file',
      description: FILE_DESCRIPTION,
      parameters: schema,
      category: 'filesystem',
      tags: ['file', 'fs', 'read', 'write', 'edit', 'search'],
      dangerous: true,
    };
  }

  async execute(args: z.infer<typeof schema>, _context: ToolExecutionContext): Promise<ToolResult> {
    try {
      switch (args.action) {
        case 'read':
          return await this.handleRead(args);
        case 'write':
          return await this.handleWrite(args);
        case 'edit':
          return await this.handleEdit(args);
        case 'patch':
          return await this.handlePatch(args);
        case 'list':
          return await this.handleList(args);
        case 'stat':
          return await this.handleStat(args);
        case 'search':
          return await this.handleSearch(args);
        case 'head':
          return await this.handleHeadOrTail(args, 'head');
        case 'tail':
          return await this.handleHeadOrTail(args, 'tail');
        default:
          return this.failure(`UNSUPPORTED_ACTION: ${String(args.action)}`);
      }
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

  private resolveBackend(validatedPath: string, mode: FileAccessMode): FileBackend {
    return this.fileBackendRouter.route({
      path: validatedPath,
      mode,
      target: this.defaultExecutionTarget,
      profile: 'trusted',
    });
  }

  private async handleRead(args: z.infer<typeof schema>): Promise<ToolResult> {
    const resolvedPath = await this.resolvePath(args.path);
    const backend = this.resolveBackend(resolvedPath, 'read');
    const result = await backend.readText(resolvedPath);

    return this.success(
      {
        path: resolvedPath,
        content: result.content,
        etag: result.etag,
      } satisfies FileToolDataShape,
      'File read successfully'
    );
  }

  private async handleWrite(args: z.infer<typeof schema>): Promise<ToolResult> {
    if (typeof args.content !== 'string') {
      throw new Error('`content` is required for write action');
    }

    const resolvedPath = await this.resolvePath(args.path);
    const backend = this.resolveBackend(resolvedPath, 'write');
    await backend.writeText(resolvedPath, args.content, {
      atomic: args.atomic ?? true,
      etag: args.etag,
      profile: 'trusted',
      target: this.defaultExecutionTarget,
    });

    const latest = await backend.readText(resolvedPath);
    return this.success(
      {
        path: resolvedPath,
        etag: latest.etag,
      } satisfies FileToolDataShape,
      'File written successfully'
    );
  }

  private async handleEdit(args: z.infer<typeof schema>): Promise<ToolResult> {
    if (!Array.isArray(args.edits) || args.edits.length === 0) {
      throw new Error('`edits` is required for edit action');
    }

    const resolvedPath = await this.resolvePath(args.path);
    const backend = this.resolveBackend(resolvedPath, 'read');
    const original = await backend.readText(resolvedPath);

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
        } satisfies FileToolDataShape,
        args.dry_run ? 'Edit preview generated' : 'No changes required'
      );
    }

    const patchBackend = this.resolveBackend(resolvedPath, 'patch');
    await patchBackend.applyPatch(resolvedPath, diff, {
      etag: original.etag,
      profile: 'trusted',
      target: this.defaultExecutionTarget,
    });

    const latest = await this.resolveBackend(resolvedPath, 'read').readText(resolvedPath);
    return this.success(
      {
        path: resolvedPath,
        diff,
        changed: true,
        etag: latest.etag,
      } satisfies FileToolDataShape,
      'Edits applied successfully'
    );
  }

  private async handlePatch(args: z.infer<typeof schema>): Promise<ToolResult> {
    if (typeof args.diff !== 'string' || args.diff.trim().length === 0) {
      throw new Error('`diff` is required for patch action');
    }

    const resolvedPath = await this.resolvePath(args.path);
    const backend = this.resolveBackend(resolvedPath, 'patch');
    await backend.applyPatch(resolvedPath, args.diff, {
      etag: args.etag,
      profile: 'trusted',
      target: this.defaultExecutionTarget,
    });

    const latest = await this.resolveBackend(resolvedPath, 'read').readText(resolvedPath);
    return this.success(
      {
        path: resolvedPath,
        etag: latest.etag,
      } satisfies FileToolDataShape,
      'Patch applied successfully'
    );
  }

  private async handleList(args: z.infer<typeof schema>): Promise<ToolResult> {
    const resolvedPath = await this.resolvePath(args.path);
    const backend = this.resolveBackend(resolvedPath, 'list');
    const entries = await backend.list(resolvedPath);
    return this.success(
      {
        path: resolvedPath,
        entries,
        total: entries.length,
      } satisfies FileToolDataShape,
      'Directory listed successfully'
    );
  }

  private async handleStat(args: z.infer<typeof schema>): Promise<ToolResult> {
    const resolvedPath = await this.resolvePath(args.path);
    const backend = this.resolveBackend(resolvedPath, 'stat');
    const stats = await backend.stat(resolvedPath);
    return this.success(
      {
        path: resolvedPath,
        stats,
      } satisfies FileToolDataShape,
      'Path stat fetched successfully'
    );
  }

  private async handleSearch(args: z.infer<typeof schema>): Promise<ToolResult> {
    if (typeof args.pattern !== 'string' || args.pattern.trim().length === 0) {
      throw new Error('`pattern` is required for search action');
    }

    const resolvedRoot = await this.resolvePath(args.path);
    const recursive = args.recursive ?? true;
    const maxResults = args.max_results ?? 200;
    const excludePatterns = args.exclude_patterns ?? [];

    const matches = await this.searchWithBackend(
      resolvedRoot,
      args.pattern,
      excludePatterns,
      recursive,
      maxResults
    );

    return this.success(
      {
        path: resolvedRoot,
        matches,
        total: matches.length,
      } satisfies FileToolDataShape,
      'Search completed successfully'
    );
  }

  private async searchWithBackend(
    resolvedRoot: string,
    pattern: string,
    excludePatterns: string[],
    recursive: boolean,
    maxResults: number
  ): Promise<string[]> {
    const backend = this.resolveBackend(resolvedRoot, 'list');
    const directories = [resolvedRoot];
    const visited = new Set<string>();
    const matches: string[] = [];

    while (directories.length > 0 && matches.length < maxResults) {
      const currentDir = directories.shift();
      if (!currentDir || visited.has(currentDir)) {
        continue;
      }
      visited.add(currentDir);

      const entries = await backend.list(currentDir);
      for (const entry of entries) {
        const relativePath = path.relative(resolvedRoot, entry.path);
        const excluded = excludePatterns.some((excludePattern) =>
          minimatch(relativePath, excludePattern, { dot: true })
        );
        if (excluded) {
          continue;
        }

        if (entry.isDirectory) {
          if (recursive) {
            directories.push(entry.path);
          }
          continue;
        }

        if (minimatch(relativePath, pattern, { dot: true })) {
          matches.push(entry.path);
          if (matches.length >= maxResults) {
            break;
          }
        }
      }
    }

    return matches;
  }

  private async handleHeadOrTail(
    args: z.infer<typeof schema>,
    action: 'head' | 'tail'
  ): Promise<ToolResult> {
    const resolvedPath = await this.resolvePath(args.path);
    const backend = this.resolveBackend(resolvedPath, 'read');
    const result = await backend.readText(resolvedPath);
    const normalizedContent = result.content.replace(/\r\n/g, '\n');
    const lines = normalizedContent.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') {
      lines.pop();
    }
    const count = args.num_lines ?? 20;
    const sliced = action === 'head' ? lines.slice(0, count) : lines.slice(-count);
    const content = sliced.join('\n');

    return this.success(
      {
        path: resolvedPath,
        content,
        etag: result.etag,
      } satisfies FileToolDataShape,
      `${action.toUpperCase()} read successfully`
    );
  }

  private mapFailure(args: z.infer<typeof schema>, rawError: unknown): ToolResult {
    const err = this.toErrorWithCode(rawError);

    if (args.action === 'patch' && this.isPatchConflict(err)) {
      return this.failure(`PATCH_CONFLICT: ${err.message}`, {
        error: 'PATCH_CONFLICT',
        code: 'PATCH_CONFLICT',
        conflict: true,
        recoverable: true,
        message: err.message,
        agent_hint:
          'Patch does not match latest file content. Read the file again, regenerate patch from latest content, then retry.',
        next_actions: ['read', 'patch'],
        action: args.action,
        path: args.path,
      });
    }

    if (args.action === 'edit' && this.isEditConflict(err)) {
      return this.failure(`EDIT_CONFLICT: ${err.message}`, {
        error: 'EDIT_CONFLICT',
        code: 'EDIT_CONFLICT',
        conflict: true,
        recoverable: true,
        message: err.message,
        agent_hint:
          'Edit oldText was not found in latest file content. Read latest content, update oldText anchor, then retry edit.',
        next_actions: ['read', 'edit'],
        action: args.action,
        path: args.path,
      });
    }

    return this.failure(`FILE_OPERATION_FAILED: ${err.message}`, {
      error: 'FILE_OPERATION_FAILED',
      message: err.message,
      action: args.action,
      path: args.path,
    });
  }

  private toErrorWithCode(rawError: unknown): ErrorWithCode {
    if (rawError instanceof Error) {
      return rawError as ErrorWithCode;
    }
    return new Error(String(rawError));
  }

  private isPatchConflict(error: ErrorWithCode): boolean {
    return (
      error.code === 'PATCH_CONFLICT' ||
      error.conflict === true ||
      error.message.includes('PATCH_APPLY_FAILED')
    );
  }

  private isEditConflict(error: ErrorWithCode): boolean {
    return (
      error.code === 'EDIT_CONFLICT' ||
      error.message.includes('Could not find exact match for edit')
    );
  }
}

export default FileTool;

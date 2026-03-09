import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createTwoFilesPatch } from 'diff';
import { z } from 'zod';
import { BaseTool, ToolResult } from './base-tool';
import { ToolExecutionError } from './error';
import {
  ensurePathWithinAllowed,
  normalizeAllowedDirectories,
  resolveRequestedPath,
} from './path-security';
import { FILE_EDIT_TOOL_DESCRIPTION } from './tool-prompts';

const fileEditSchema = z.object({
  oldText: z.string().describe('The exact text segment to replace'),
  newText: z.string().describe('The replacement text'),
});

const schema = z
  .object({
    path: z.string().min(1).describe('Path to the file to modify'),
    edits: z.array(fileEditSchema).min(1).describe('Array of replacements to apply in order'),
    dry_run: z.boolean().optional().describe('If true, only preview edit diff'),
  })
  .strict();

interface FileEdit {
  oldText: string;
  newText: string;
}

export interface FileEditToolOptions {
  allowedDirectories?: string[];
}

interface FileEditPayload {
  path: string;
  diff: string;
  changed: boolean;
  etag: string;
}

function normalizeLineEndings(input: string): string {
  return input.replace(/\r\n/g, '\n');
}

function createUnifiedDiff(originalContent: string, newContent: string, filePath: string): string {
  const normalizedOriginal = normalizeLineEndings(originalContent);
  const normalizedNew = normalizeLineEndings(newContent);

  return createTwoFilesPatch(
    filePath,
    filePath,
    normalizedOriginal,
    normalizedNew,
    'original',
    'modified'
  );
}

function applyEditsToContent(content: string, edits: FileEdit[]): string {
  let modifiedContent = normalizeLineEndings(content);

  for (const edit of edits) {
    const normalizedOld = normalizeLineEndings(edit.oldText);
    const normalizedNew = normalizeLineEndings(edit.newText);

    if (modifiedContent.includes(normalizedOld)) {
      modifiedContent = modifiedContent.replace(normalizedOld, normalizedNew);
      continue;
    }

    const oldLines = normalizedOld.split('\n');
    const contentLines = modifiedContent.split('\n');
    let matched = false;

    for (let index = 0; index <= contentLines.length - oldLines.length; index += 1) {
      const window = contentLines.slice(index, index + oldLines.length);
      const isMatch = oldLines.every(
        (oldLine, lineIndex) => oldLine.trim() === window[lineIndex].trim()
      );
      if (!isMatch) {
        continue;
      }

      const originalIndent = /^\s*/.exec(contentLines[index])![0];
      const replacementLines = normalizedNew.split('\n').map((line, lineIndex) => {
        if (lineIndex === 0) {
          return originalIndent + line.trimStart();
        }

        const oldIndent = oldLines[lineIndex]?.match(/^\s*/)?.[0] || '';
        const newIndent = line.match(/^\s*/)?.[0] || '';
        if (oldIndent && newIndent) {
          const relativeIndent = newIndent.length - oldIndent.length;
          return originalIndent + ' '.repeat(Math.max(0, relativeIndent)) + line.trimStart();
        }
        return line;
      });

      contentLines.splice(index, oldLines.length, ...replacementLines);
      modifiedContent = contentLines.join('\n');
      matched = true;
      break;
    }

    if (!matched) {
      throw new Error(`Could not find exact match for edit:\n${edit.oldText}`);
    }
  }

  return modifiedContent;
}

export class FileEditTool extends BaseTool<typeof schema> {
  name = 'file_edit';
  description = FILE_EDIT_TOOL_DESCRIPTION;
  parameters = schema;

  private readonly allowedDirectories: string[];

  constructor(options: FileEditToolOptions = {}) {
    super();
    this.allowedDirectories = normalizeAllowedDirectories(options.allowedDirectories);
  }

  override shouldConfirm(): boolean {
    return true;
  }

  async execute(args: z.infer<typeof schema>): Promise<ToolResult> {
    try {
      const absolute = resolveRequestedPath(args.path);
      const validatedPath = ensurePathWithinAllowed(
        absolute,
        this.allowedDirectories,
        'PATH_NOT_ALLOWED'
      );

      const stats = await fs.stat(validatedPath);
      if (!stats.isFile()) {
        throw new Error(`FILE_EDIT_NOT_FILE: ${validatedPath}`);
      }

      const originalContent = await fs.readFile(validatedPath, 'utf8');
      const edits: FileEdit[] = args.edits.map((edit) => ({
        oldText: edit.oldText,
        newText: edit.newText,
      }));

      const updatedContent = applyEditsToContent(originalContent, edits);
      const changed = updatedContent !== originalContent;
      const diff = createUnifiedDiff(originalContent, updatedContent, validatedPath);

      if (!changed || args.dry_run) {
        const previewPayload: FileEditPayload = {
          path: validatedPath,
          diff,
          changed,
          etag: this.createEtag(originalContent),
        };
        return {
          success: true,
          output: diff,
          metadata: previewPayload as unknown as Record<string, unknown>,
        };
      }

      await this.writeAtomically(validatedPath, updatedContent);
      const latestContent = await fs.readFile(validatedPath, 'utf8');

      const payload: FileEditPayload = {
        path: validatedPath,
        diff,
        changed: true,
        etag: this.createEtag(latestContent),
      };

      return {
        success: true,
        output: diff,
        metadata: payload as unknown as Record<string, unknown>,
      };
    } catch (error) {
      return this.mapFailure(args.path, error);
    }
  }

  private async writeAtomically(targetPath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const tempPath = `${targetPath}.tmp.${randomUUID().slice(0, 8)}`;
    await fs.writeFile(tempPath, content, 'utf8');
    await fs.rename(tempPath, targetPath);
  }

  private createEtag(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private mapFailure(requestPath: string, error: unknown): ToolResult {
    const message = error instanceof Error ? error.message : String(error);

    if (
      message.includes('Could not find exact match for edit') ||
      message.startsWith('EDIT_CONFLICT:')
    ) {
      const output = `EDIT_CONFLICT: ${message}`;
      return {
        success: false,
        output,
        error: new ToolExecutionError(output),
        metadata: {
          error: 'EDIT_CONFLICT',
          code: 'EDIT_CONFLICT',
          conflict: true,
          recoverable: true,
          message,
          agent_hint:
            'Edit oldText was not found in latest file content. Read latest content, update oldText anchor, then retry edit.',
          next_actions: ['file_read', 'file_edit'],
          path: requestPath,
        },
      };
    }

    const output = `FILE_EDIT_FAILED: ${message}`;
    return {
      success: false,
      output,
      error: new ToolExecutionError(output),
      metadata: {
        error: 'FILE_EDIT_FAILED',
        message,
        path: requestPath,
      },
    };
  }
}

export default FileEditTool;

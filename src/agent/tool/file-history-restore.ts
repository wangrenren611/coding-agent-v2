import { z } from 'zod';
import { BaseTool, type ToolConfirmDetails, type ToolResult } from './base-tool';
import { ToolExecutionError } from './error';
import {
  assessPathAccess,
  ensurePathWithinAllowed,
  normalizeAllowedDirectories,
  resolveRequestedPath,
} from './path-security';
import type { ToolExecutionContext } from './types';
import {
  createConfiguredFileHistoryStore,
  FileHistoryStore,
  type FileHistoryVersion,
} from '../storage/file-history-store';
import { FILE_HISTORY_RESTORE_TOOL_DESCRIPTION } from './tool-prompts';

const schema = z
  .object({
    path: z.string().min(1).describe('Path to the file that should be restored'),
    versionId: z
      .string()
      .min(1)
      .optional()
      .describe('Specific saved version id to restore; defaults to the latest saved version'),
  })
  .strict();

export interface FileHistoryRestoreToolOptions {
  allowedDirectories?: string[];
  historyStore?: FileHistoryStore;
}

interface FileHistoryRestorePayload {
  path: string;
  restored: boolean;
  version?: FileHistoryVersion;
}

export class FileHistoryRestoreTool extends BaseTool<typeof schema> {
  name = 'file_history_restore';
  description = FILE_HISTORY_RESTORE_TOOL_DESCRIPTION;
  parameters = schema;

  private readonly allowedDirectories: string[];
  private readonly historyStore: FileHistoryStore;

  constructor(options: FileHistoryRestoreToolOptions = {}) {
    super();
    this.allowedDirectories = normalizeAllowedDirectories(options.allowedDirectories);
    this.historyStore = options.historyStore ?? createConfiguredFileHistoryStore();
  }

  override shouldConfirm(): boolean {
    return true;
  }

  override getConfirmDetails(args: z.infer<typeof schema>): ToolConfirmDetails | null {
    const absolute = resolveRequestedPath(args.path);
    const assessment = assessPathAccess(absolute, this.allowedDirectories, 'PATH_NOT_ALLOWED');
    if (assessment.allowed) {
      return {
        reason: `Restore historical content for ${assessment.normalizedCandidate}`,
        metadata: {
          requestedPath: assessment.normalizedCandidate,
        },
      };
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
    try {
      const absolute = resolveRequestedPath(args.path);
      const validatedPath = ensurePathWithinAllowed(
        absolute,
        this.allowedDirectories,
        'PATH_NOT_ALLOWED',
        context?.confirmationApproved === true
      );

      const versions = await this.historyStore.listVersions(validatedPath);
      const version = this.resolveVersion(versions, args.versionId);
      if (!version) {
        const message = args.versionId
          ? `FILE_HISTORY_VERSION_NOT_FOUND: ${args.versionId}`
          : `FILE_HISTORY_EMPTY: ${validatedPath}`;
        return {
          success: false,
          output: message,
          error: new ToolExecutionError(message),
          metadata: {
            path: validatedPath,
            versionId: args.versionId,
          },
        };
      }

      const restored = await this.historyStore.restoreVersion(validatedPath, version.versionId);
      const payload: FileHistoryRestorePayload = {
        path: validatedPath,
        restored,
        version: restored ? version : undefined,
      };

      if (!restored) {
        const message = `FILE_HISTORY_RESTORE_FAILED: ${version.versionId}`;
        return {
          success: false,
          output: message,
          error: new ToolExecutionError(message),
          metadata: payload as unknown as Record<string, unknown>,
        };
      }

      return {
        success: true,
        output: JSON.stringify(payload),
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

  private resolveVersion(
    versions: FileHistoryVersion[],
    versionId?: string
  ): FileHistoryVersion | undefined {
    if (!versionId) {
      return versions[0];
    }
    return versions.find((entry) => entry.versionId === versionId);
  }
}

export default FileHistoryRestoreTool;

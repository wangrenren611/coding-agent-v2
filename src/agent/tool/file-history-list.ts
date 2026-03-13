import { z } from 'zod';
import { BaseTool, ToolConfirmDetails, ToolResult } from './base-tool';
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
import { FILE_HISTORY_LIST_TOOL_DESCRIPTION } from './tool-prompts';

const schema = z
  .object({
    path: z.string().min(1).describe('Path to the file whose saved history should be listed'),
  })
  .strict();

export interface FileHistoryListToolOptions {
  allowedDirectories?: string[];
  historyStore?: FileHistoryStore;
}

interface FileHistoryListPayload {
  path: string;
  versions: FileHistoryVersion[];
}

export class FileHistoryListTool extends BaseTool<typeof schema> {
  name = 'file_history_list';
  description = FILE_HISTORY_LIST_TOOL_DESCRIPTION;
  parameters = schema;

  private readonly allowedDirectories: string[];
  private readonly historyStore: FileHistoryStore;

  constructor(options: FileHistoryListToolOptions = {}) {
    super();
    this.allowedDirectories = normalizeAllowedDirectories(options.allowedDirectories);
    this.historyStore = options.historyStore ?? createConfiguredFileHistoryStore();
  }

  override getConcurrencyMode(): 'parallel-safe' {
    return 'parallel-safe';
  }

  override getConcurrencyLockKey(args: z.infer<typeof schema>): string {
    return `file_history_list:${args.path}`;
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
    try {
      const absolute = resolveRequestedPath(args.path);
      const validatedPath = ensurePathWithinAllowed(
        absolute,
        this.allowedDirectories,
        'PATH_NOT_ALLOWED',
        context?.confirmationApproved === true
      );

      const payload: FileHistoryListPayload = {
        path: validatedPath,
        versions: await this.historyStore.listVersions(validatedPath),
      };

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
}

export default FileHistoryListTool;

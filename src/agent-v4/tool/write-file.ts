import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { BaseTool, type ToolConfirmDetails, type ToolResult } from './base-tool';
import type { ToolExecutionContext } from './types';
import {
  appendContent,
  createWriteBufferSession,
  finalizeWriteBufferSession,
  loadWriteBufferSession,
  cleanupWriteBufferSessionFiles,
} from '../agent/write-buffer';
import { ToolExecutionError } from './error';
import { WRITE_FILE_TOOL_DESCRIPTION } from './tool-prompts';
import { assessPathAccess } from './path-security';

const writeModeSchema = z.enum(['direct', 'finalize']);

const schema = z.object({
  path: z
    .string()
    .min(1)
    .optional()
    .describe('Target path. Required for direct; optional for finalize'),
  content: z.string().optional().describe('Plain text content chunk for this call'),
  mode: writeModeSchema.default('direct').describe('Write mode: direct or finalize'),
  bufferId: z.string().optional().describe('Buffer session id used for finalize'),
});

type WriteFileArgs = z.infer<typeof schema>;
type WriteMode = z.infer<typeof writeModeSchema>;

interface WriteFileToolOptions {
  allowedDirectories?: string[];
  maxChunkBytes?: number;
  bufferBaseDir?: string;
}

interface WriteBufferInfo {
  bufferId: string;
  path: string;
  bufferedBytes: number;
  maxChunkBytes: number;
}

interface WriteFileResponse {
  ok: boolean;
  code:
    | 'OK'
    | 'WRITE_FILE_PARTIAL_BUFFERED'
    | 'WRITE_FILE_NEED_FINALIZE'
    | 'WRITE_FILE_FINALIZE_OK';
  message: string;
  buffer?: WriteBufferInfo;
  nextAction: 'finalize' | 'none';
}

interface SessionPointer {
  metaPath: string;
}

export class WriteFileTool extends BaseTool<typeof schema> {
  name = 'write_file';
  description = WRITE_FILE_TOOL_DESCRIPTION;
  parameters = schema;

  private readonly allowedDirectories: string[];
  private readonly maxChunkBytes: number;
  private readonly bufferBaseDir: string;

  constructor(options: WriteFileToolOptions = {}) {
    super();
    this.allowedDirectories = (
      options.allowedDirectories?.length ? options.allowedDirectories : [process.cwd()]
    ).map((dir) => this.normalizeAllowedDirectory(dir));
    this.maxChunkBytes =
      options.maxChunkBytes && options.maxChunkBytes > 0 ? options.maxChunkBytes : 32768;
    this.bufferBaseDir = path.resolve(
      options.bufferBaseDir || path.join(process.cwd(), '.agent-cache', 'write-file')
    );
    fs.mkdirSync(this.bufferBaseDir, { recursive: true });
  }

  override getConfirmDetails(args: WriteFileArgs): ToolConfirmDetails | null {
    if (!args.path) {
      return null;
    }
    const resolved = path.isAbsolute(args.path)
      ? path.resolve(args.path)
      : path.resolve(process.cwd(), args.path);
    const assessment = assessPathAccess(resolved, this.allowedDirectories, 'PATH_NOT_ALLOWED');
    if (assessment.allowed) {
      return null;
    }
    return {
      reason: assessment.message,
      metadata: {
        requestedPath: resolved,
        allowedDirectories: this.allowedDirectories,
        errorCode: 'PATH_NOT_ALLOWED',
      },
    };
  }

  async execute(args: WriteFileArgs, context?: ToolExecutionContext): Promise<ToolResult> {
    try {
      const mode: WriteMode = args.mode || 'direct';
      const content = args.content || '';

      if (mode === 'direct') {
        const targetPath = this.validateAndResolveRequiredPath(args.path, mode, context);
        return this.handleDirect(targetPath, content, context);
      }
      return this.handleFinalize(args.path, args.bufferId, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: new ToolExecutionError(message),
        output: message,
      };
    }
  }

  private async handleDirect(
    targetPath: string,
    content: string,
    context?: ToolExecutionContext
  ): Promise<ToolResult> {
    const contentBytes = Buffer.byteLength(content, 'utf8');
    if (contentBytes <= this.maxChunkBytes) {
      await this.writeAtomically(targetPath, content);
      return this.successResponse({
        ok: true,
        code: 'OK',
        message: 'File written successfully',
        nextAction: 'none',
      });
    }

    const session = await this.createOrLoadSession(
      targetPath,
      context?.toolCallId,
      undefined,
      targetPath
    );
    await appendContent(session, content);
    const latest = await loadWriteBufferSession(session.metaPath);

    return this.successResponse({
      ok: false,
      code: 'WRITE_FILE_PARTIAL_BUFFERED',
      message: `Content exceeds maxChunkBytes=${this.maxChunkBytes}; buffered full content`,
      buffer: {
        bufferId: latest.bufferId,
        path: targetPath,
        bufferedBytes: latest.contentBytes,
        maxChunkBytes: this.maxChunkBytes,
      },
      nextAction: 'finalize',
    });
  }

  private async handleFinalize(
    inputPath: string | undefined,
    bufferId: string | undefined,
    context?: ToolExecutionContext
  ): Promise<ToolResult> {
    if (!bufferId) {
      return this.successResponse({
        ok: false,
        code: 'WRITE_FILE_NEED_FINALIZE',
        message: 'bufferId is required for finalize mode',
        nextAction: 'finalize',
      });
    }

    const pointer = await this.loadPointer(bufferId);
    if (!pointer) {
      return this.successResponse({
        ok: false,
        code: 'WRITE_FILE_NEED_FINALIZE',
        message: `Buffer session not found for bufferId=${bufferId}`,
        nextAction: 'finalize',
      });
    }

    const session = await loadWriteBufferSession(pointer.metaPath);
    const targetPath = this.resolveFinalizeTargetPath(inputPath, session.targetPath, context);
    if (session.targetPath && path.resolve(session.targetPath) !== path.resolve(targetPath)) {
      return this.successResponse({
        ok: false,
        code: 'WRITE_FILE_NEED_FINALIZE',
        message: 'Target path does not match existing buffer session',
        buffer: {
          bufferId: session.bufferId,
          path: session.targetPath,
          bufferedBytes: session.contentBytes,
          maxChunkBytes: this.maxChunkBytes,
        },
        nextAction: 'finalize',
      });
    }
    await finalizeWriteBufferSession({
      contentPath: session.contentPath,
      metaPath: session.metaPath,
      targetPath,
    });
    await cleanupWriteBufferSessionFiles(session);
    await this.removePointer(session.bufferId);

    return this.successResponse({
      ok: true,
      code: 'WRITE_FILE_FINALIZE_OK',
      message: 'Buffered content finalized to target file',
      nextAction: 'none',
    });
  }

  private async createOrLoadSession(
    targetPath: string,
    sessionSeedId?: string,
    explicitBufferId?: string,
    expectedTargetPath?: string
  ): Promise<{ contentPath: string; metaPath: string; rawArgsPath: string }> {
    if (explicitBufferId) {
      const pointer = await this.loadPointer(explicitBufferId);
      if (pointer) {
        const loaded = await loadWriteBufferSession(pointer.metaPath);
        if (
          expectedTargetPath &&
          loaded.targetPath &&
          path.resolve(loaded.targetPath) !== path.resolve(expectedTargetPath)
        ) {
          throw new Error('bufferId target path mismatch');
        }
        return loaded;
      }
    }

    const requestedId = explicitBufferId || sessionSeedId || `write_file_${randomUUID()}`;
    const session = await createWriteBufferSession({
      messageId: `write_file_${Date.now()}`,
      toolCallId: requestedId,
      targetPath,
      baseDir: this.bufferBaseDir,
    });
    await this.savePointer(session.bufferId, session.metaPath);
    return session;
  }

  private successResponse(payload: WriteFileResponse): ToolResult {
    return {
      success: payload.ok,
      output: JSON.stringify(payload),
      metadata: payload as unknown as Record<string, unknown>,
    };
  }

  private validateAndResolveRequiredPath(
    inputPath: string | undefined,
    mode: 'direct',
    context?: ToolExecutionContext
  ): string {
    if (!inputPath) {
      throw new Error(`path is required for ${mode} mode`);
    }
    return this.validateAndResolvePath(inputPath, context);
  }

  private validateAndResolvePath(inputPath: string, context?: ToolExecutionContext): string {
    const resolved = path.isAbsolute(inputPath)
      ? path.resolve(inputPath)
      : path.resolve(process.cwd(), inputPath);
    const assessment = assessPathAccess(resolved, this.allowedDirectories, 'PATH_NOT_ALLOWED');
    if (!assessment.allowed && context?.confirmationApproved !== true) {
      throw new Error(`Path is outside allowed directories: ${inputPath}`);
    }
    return assessment.normalizedCandidate;
  }

  private resolveFinalizeTargetPath(
    inputPath: string | undefined,
    sessionTargetPath: string | undefined,
    context?: ToolExecutionContext
  ): string {
    if (inputPath) {
      return this.validateAndResolvePath(inputPath, context);
    }
    if (sessionTargetPath) {
      return this.validateAndResolvePath(sessionTargetPath, context);
    }
    throw new Error('path is required for finalize mode when buffer session has no target path');
  }

  private normalizeAllowedDirectory(dir: string): string {
    const resolved = path.resolve(dir);
    try {
      return fs.realpathSync(resolved);
    } catch {
      return resolved;
    }
  }

  private async writeAtomically(targetPath: string, content: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    const tmpPath = `${targetPath}.tmp.${randomUUID().slice(0, 8)}`;
    await fs.promises.writeFile(tmpPath, content, 'utf8');
    await fs.promises.rename(tmpPath, targetPath);
  }

  private pointerPath(bufferId: string): string {
    const safeId = bufferId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.bufferBaseDir, `${safeId}.pointer.json`);
  }

  private async savePointer(bufferId: string, metaPath: string): Promise<void> {
    const pointerPath = this.pointerPath(bufferId);
    const pointer: SessionPointer = { metaPath };
    await fs.promises.writeFile(pointerPath, JSON.stringify(pointer), 'utf8');
  }

  private async loadPointer(bufferId: string): Promise<SessionPointer | null> {
    const pointerPath = this.pointerPath(bufferId);
    try {
      const content = await fs.promises.readFile(pointerPath, 'utf8');
      const pointer = JSON.parse(content) as SessionPointer;
      return pointer;
    } catch {
      return null;
    }
  }

  private async removePointer(bufferId: string): Promise<void> {
    await fs.promises.rm(this.pointerPath(bufferId), { force: true });
  }
}

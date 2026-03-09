import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { BaseTool, type ToolResult } from './base-tool';
import type { ToolExecutionContext } from './types';
import {
  appendContent,
  createWriteBufferSession,
  finalizeWriteBufferSession,
  loadWriteBufferSession,
  cleanupWriteBufferSessionFiles,
} from '../agent/write-buffer';
import { ToolExecutionError } from './error';

const writeModeSchema = z.enum(['direct', 'resume', 'finalize']);

const schema = z.object({
  path: z.string().min(1).describe('Target file path'),
  content: z.string().optional().describe('Content chunk for this call'),
  mode: writeModeSchema.default('direct').describe('Write mode'),
  bufferId: z.string().optional().describe('Resume session id'),
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
    | 'WRITE_FILE_NEED_RESUME'
    | 'WRITE_FILE_FINALIZE_OK';
  message: string;
  buffer?: WriteBufferInfo;
  nextAction: 'resume' | 'finalize' | 'none';
}

interface SessionPointer {
  metaPath: string;
}

export class WriteFileTool extends BaseTool<typeof schema> {
  name = 'write_file';
  description = 'Write file content directly or via resumable buffered protocol';
  parameters = schema;

  private readonly allowedDirectories: string[];
  private readonly maxChunkBytes: number;
  private readonly bufferBaseDir: string;

  constructor(options: WriteFileToolOptions = {}) {
    super();
    this.allowedDirectories = (options.allowedDirectories?.length
      ? options.allowedDirectories
      : [process.cwd()]
    ).map((dir) => this.normalizeAllowedDirectory(dir));
    this.maxChunkBytes = options.maxChunkBytes && options.maxChunkBytes > 0 ? options.maxChunkBytes : 32768;
    this.bufferBaseDir = path.resolve(
      options.bufferBaseDir || path.join(process.cwd(), '.agent-cache', 'write-file')
    );
    fs.mkdirSync(this.bufferBaseDir, { recursive: true });
  }

  async execute(args: WriteFileArgs, context?: ToolExecutionContext): Promise<ToolResult> {
    try {
      const mode: WriteMode = args.mode || 'direct';
      const targetPath = this.validateAndResolvePath(args.path);
      const content = args.content || '';

      if (mode === 'direct') {
        return this.handleDirect(targetPath, content, context);
      }
      if (mode === 'resume') {
        return this.handleResume(targetPath, content, args.bufferId, context);
      }
      return this.handleFinalize(
        targetPath,
        args.bufferId
      );
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

    const session = await this.createOrLoadSession(targetPath, context?.toolCallId, undefined, targetPath);
    const firstChunk = this.truncateUtf8ByBytes(content, this.maxChunkBytes);
    await appendContent(session, firstChunk);
    const latest = await loadWriteBufferSession(session.metaPath);

    return this.successResponse({
      ok: false,
      code: 'WRITE_FILE_PARTIAL_BUFFERED',
      message: `Content exceeds maxChunkBytes=${this.maxChunkBytes}; buffered first chunk`,
      buffer: {
        bufferId: latest.bufferId,
        path: targetPath,
        bufferedBytes: latest.contentBytes,
        maxChunkBytes: this.maxChunkBytes,
      },
      nextAction: 'resume',
    });
  }

  private async handleResume(
    targetPath: string,
    content: string,
    bufferId: string | undefined,
    context?: ToolExecutionContext
  ): Promise<ToolResult> {
    if (!bufferId) {
      return this.successResponse({
        ok: false,
        code: 'WRITE_FILE_NEED_RESUME',
        message: 'bufferId is required for resume mode',
        nextAction: 'resume',
      });
    }

    const contentBytes = Buffer.byteLength(content, 'utf8');
    if (contentBytes > this.maxChunkBytes) {
      let bufferedBytes = 0;
      let bufferedPath = targetPath;
      const pointer = await this.loadPointer(bufferId);
      if (pointer) {
        try {
          const existing = await loadWriteBufferSession(pointer.metaPath);
          bufferedBytes = existing.contentBytes;
          bufferedPath = existing.targetPath || bufferedPath;
        } catch {
          // ignore and keep default buffer snapshot
        }
      }
      return this.successResponse({
        ok: false,
        code: 'WRITE_FILE_NEED_RESUME',
        message: `Chunk exceeds maxChunkBytes=${this.maxChunkBytes}`,
        buffer: {
          bufferId,
          path: bufferedPath,
          bufferedBytes,
          maxChunkBytes: this.maxChunkBytes,
        },
        nextAction: 'resume',
      });
    }

    const session = await this.createOrLoadSession(
      targetPath,
      bufferId || context?.toolCallId,
      bufferId,
      targetPath
    );
    await appendContent(session, content);
    const latest = await loadWriteBufferSession(session.metaPath);

    return this.successResponse({
      ok: false,
      code: 'WRITE_FILE_NEED_RESUME',
      message: 'Chunk appended to buffer',
      buffer: {
        bufferId: latest.bufferId,
        path: targetPath,
        bufferedBytes: latest.contentBytes,
        maxChunkBytes: this.maxChunkBytes,
      },
      nextAction: 'resume',
    });
  }

  private async handleFinalize(
    targetPath: string,
    bufferId: string | undefined
  ): Promise<ToolResult> {
    if (!bufferId) {
      return this.successResponse({
        ok: false,
        code: 'WRITE_FILE_NEED_RESUME',
        message: 'bufferId is required for finalize mode',
        nextAction: 'resume',
      });
    }

    const pointer = await this.loadPointer(bufferId);
    if (!pointer) {
      return this.successResponse({
        ok: false,
        code: 'WRITE_FILE_NEED_RESUME',
        message: `Buffer session not found for bufferId=${bufferId}`,
        nextAction: 'resume',
      });
    }

    const session = await loadWriteBufferSession(pointer.metaPath);
    if (session.targetPath && path.resolve(session.targetPath) !== path.resolve(targetPath)) {
      return this.successResponse({
        ok: false,
        code: 'WRITE_FILE_NEED_RESUME',
        message: 'Target path does not match existing buffer session',
        buffer: {
          bufferId: session.bufferId,
          path: session.targetPath,
          bufferedBytes: session.contentBytes,
          maxChunkBytes: this.maxChunkBytes,
        },
        nextAction: 'resume',
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

  private truncateUtf8ByBytes(input: string, maxBytes: number): string {
    if (maxBytes <= 0 || input.length === 0) {
      return '';
    }
    let usedBytes = 0;
    let endIndex = 0;
    for (const char of input) {
      const charBytes = Buffer.byteLength(char, 'utf8');
      if (usedBytes + charBytes > maxBytes) {
        break;
      }
      usedBytes += charBytes;
      endIndex += char.length;
    }
    return input.slice(0, endIndex);
  }

  private successResponse(payload: WriteFileResponse): ToolResult {
    return {
      success: payload.ok,
      output: JSON.stringify(payload),
      metadata: payload as unknown as Record<string, unknown>,
    };
  }

  private validateAndResolvePath(inputPath: string): string {
    const resolved = path.isAbsolute(inputPath)
      ? path.resolve(inputPath)
      : path.resolve(process.cwd(), inputPath);
    const normalizedResolved = this.normalizePathWithExistingAncestor(resolved);
    const allowed = this.allowedDirectories.some((allowedDir) => {
      return (
        normalizedResolved === allowedDir || normalizedResolved.startsWith(`${allowedDir}${path.sep}`)
      );
    });
    if (!allowed) {
      throw new Error(`Path is outside allowed directories: ${inputPath}`);
    }
    return normalizedResolved;
  }

  private normalizeAllowedDirectory(dir: string): string {
    const resolved = path.resolve(dir);
    try {
      return fs.realpathSync(resolved);
    } catch {
      return resolved;
    }
  }

  private normalizePathWithExistingAncestor(inputPath: string): string {
    const absolute = path.resolve(inputPath);
    let current = absolute;
    const tailSegments: string[] = [];

    for (;;) {
      try {
        const realCurrent = fs.realpathSync(current);
        if (tailSegments.length === 0) {
          return realCurrent;
        }
        return path.join(realCurrent, ...tailSegments.reverse());
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code !== 'ENOENT' && nodeError.code !== 'ENOTDIR') {
          return absolute;
        }

        const parent = path.dirname(current);
        if (parent === current) {
          return absolute;
        }

        tailSegments.push(path.basename(current));
        current = parent;
      }
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

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
import { createConfiguredFileHistoryStore, FileHistoryStore } from '../storage/file-history-store';
import {
  getWriteBufferCandidateDirs,
  resolveWriteBufferBaseDir,
} from '../storage/file-storage-config';
import { writeTextFileWithHistory } from '../storage/file-write-service';

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
  historyStore?: FileHistoryStore;
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

interface LoadedBufferSession {
  session: {
    contentPath: string;
    metaPath: string;
    rawArgsPath: string;
    targetPath?: string;
    bufferId: string;
    contentBytes: number;
  };
}

export class WriteFileTool extends BaseTool<typeof schema> {
  name = 'write_file';
  description = WRITE_FILE_TOOL_DESCRIPTION;
  parameters = schema;

  private readonly allowedDirectories: string[];
  private readonly maxChunkBytes: number;
  private readonly bufferBaseDir: string;
  private readonly historyStore: FileHistoryStore;

  constructor(options: WriteFileToolOptions = {}) {
    super();
    this.allowedDirectories = (
      options.allowedDirectories?.length ? options.allowedDirectories : [process.cwd()]
    ).map((dir) => this.normalizeAllowedDirectory(dir));
    this.maxChunkBytes =
      options.maxChunkBytes && options.maxChunkBytes > 0 ? options.maxChunkBytes : 32768;
    this.bufferBaseDir = resolveWriteBufferBaseDir(options.bufferBaseDir);
    this.historyStore = options.historyStore ?? createConfiguredFileHistoryStore();
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

    const loaded = await this.loadBufferedSession(bufferId);
    if (!loaded) {
      return this.successResponse({
        ok: false,
        code: 'WRITE_FILE_NEED_FINALIZE',
        message: `Buffer session not found for bufferId=${bufferId}`,
        nextAction: 'finalize',
      });
    }

    const session = loaded.session;
    const targetPath = this.resolveFinalizeTargetPath(inputPath, session.targetPath, context);
    const normalizedSessionTargetPath = session.targetPath
      ? this.validateAndResolvePath(session.targetPath, context)
      : undefined;
    if (normalizedSessionTargetPath && normalizedSessionTargetPath !== targetPath) {
      return this.successResponse({
        ok: false,
        code: 'WRITE_FILE_NEED_FINALIZE',
        message: 'Target path does not match existing buffer session',
        buffer: {
          bufferId: session.bufferId,
          path: normalizedSessionTargetPath,
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
      const loadedSession = await this.loadBufferedSession(explicitBufferId);
      if (loadedSession) {
        const loaded = loadedSession.session;
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
    await writeTextFileWithHistory(targetPath, content, {
      source: 'write_file',
      historyStore: this.historyStore,
    });
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

  private async loadBufferedSession(bufferId: string): Promise<LoadedBufferSession | null> {
    for (const dir of this.getCandidateBufferDirs()) {
      const pointer = await this.readPointer(path.join(dir, this.pointerFileName(bufferId)));
      if (pointer) {
        const session = await loadWriteBufferSession(pointer.metaPath);
        return { session };
      }
    }

    const fallback = await this.findFallbackSessionByBufferId(bufferId);
    if (!fallback) {
      return null;
    }
    return { session: fallback };
  }

  private async findFallbackSessionByBufferId(bufferId: string): Promise<{
    contentPath: string;
    metaPath: string;
    rawArgsPath: string;
    targetPath?: string;
    bufferId: string;
    contentBytes: number;
  } | null> {
    const safeId = bufferId.replace(/[^a-zA-Z0-9_-]/g, '_');
    for (const dir of this.getCandidateBufferDirs()) {
      let entries: string[] = [];
      try {
        entries = await fs.promises.readdir(dir);
      } catch {
        continue;
      }

      const candidates = entries
        .filter((entry) => entry.endsWith('.meta.json') && entry.includes(safeId))
        .sort()
        .reverse();

      for (const entry of candidates) {
        try {
          const session = await loadWriteBufferSession(path.join(dir, entry));
          if (session.bufferId !== bufferId) {
            continue;
          }
          if (!session.targetPath) {
            const inferredTargetPath = await this.extractTargetPathFromRawArgs(session.rawArgsPath);
            if (inferredTargetPath) {
              session.targetPath = inferredTargetPath;
            }
          }
          return session;
        } catch {
          continue;
        }
      }
    }
    return null;
  }

  private async extractTargetPathFromRawArgs(rawArgsPath: string): Promise<string | undefined> {
    try {
      const rawArgs = await fs.promises.readFile(rawArgsPath, 'utf8');
      return this.extractJsonStringField(rawArgs, 'path');
    } catch {
      return undefined;
    }
  }

  private extractJsonStringField(raw: string, fieldName: string): string | undefined {
    const markerMatch = new RegExp(`"${fieldName}"\\s*:\\s*"`, 'm').exec(raw);
    if (!markerMatch || typeof markerMatch.index !== 'number') {
      return undefined;
    }

    let cursor = markerMatch.index + markerMatch[0].length;
    let output = '';

    while (cursor < raw.length) {
      const ch = raw[cursor];
      if (ch === '"') {
        return output;
      }
      if (ch !== '\\') {
        output += ch;
        cursor += 1;
        continue;
      }

      if (cursor + 1 >= raw.length) {
        return output;
      }

      const esc = raw[cursor + 1];
      if (esc === '"' || esc === '\\' || esc === '/') {
        output += esc;
        cursor += 2;
      } else if (esc === 'b') {
        output += '\b';
        cursor += 2;
      } else if (esc === 'f') {
        output += '\f';
        cursor += 2;
      } else if (esc === 'n') {
        output += '\n';
        cursor += 2;
      } else if (esc === 'r') {
        output += '\r';
        cursor += 2;
      } else if (esc === 't') {
        output += '\t';
        cursor += 2;
      } else if (esc === 'u') {
        const unicodeHex = raw.slice(cursor + 2, cursor + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(unicodeHex)) {
          return output;
        }
        output += String.fromCharCode(parseInt(unicodeHex, 16));
        cursor += 6;
      } else {
        output += esc;
        cursor += 2;
      }
    }

    return output || undefined;
  }

  private pointerFileName(bufferId: string): string {
    const safeId = bufferId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return `${safeId}.pointer.json`;
  }

  private getCandidateBufferDirs(): string[] {
    return getWriteBufferCandidateDirs(this.bufferBaseDir);
  }

  private async readPointer(pointerPath: string): Promise<SessionPointer | null> {
    try {
      const content = await fs.promises.readFile(pointerPath, 'utf8');
      return JSON.parse(content) as SessionPointer;
    } catch {
      return null;
    }
  }

  private async removePointer(bufferId: string): Promise<void> {
    await Promise.all(
      this.getCandidateBufferDirs().map((dir) =>
        fs.promises.rm(path.join(dir, this.pointerFileName(bufferId)), { force: true })
      )
    );
  }
}

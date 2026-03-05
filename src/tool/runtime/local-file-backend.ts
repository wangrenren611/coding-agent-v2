/**
 * 本地文件后端
 */

import { createHash, randomUUID } from 'crypto';
import { promises as fsp } from 'fs';
import fs from 'fs';
import path from 'path';
import { applyPatch as applyUnifiedPatch } from 'diff';
import type {
  FileBackend,
  FileListEntry,
  FilePatchOptions,
  FileReadOptions,
  FileReadResult,
  FileStat,
  FileWriteOptions,
} from './file';

export interface LocalFileBackendOptions {
  id?: string;
  rootDir?: string;
  target?: 'local' | 'sandbox';
}

/**
 * 默认本地文件实现
 *
 * - 可选 rootDir 作为访问边界
 * - 支持 etag 校验与原子写
 */
export class LocalFileBackend implements FileBackend {
  readonly id: string;
  readonly target: 'local' | 'sandbox';
  private readonly rootDir?: string;

  constructor(options: LocalFileBackendOptions = {}) {
    this.id = options.id ?? 'local-file-default';
    this.target = options.target ?? 'local';
    if (options.rootDir) {
      const resolvedRoot = path.resolve(options.rootDir);
      try {
        this.rootDir = fs.realpathSync(resolvedRoot);
      } catch {
        this.rootDir = resolvedRoot;
      }
    }
  }

  canAccess(inputPath: string): boolean {
    try {
      void this.resolvePath(inputPath);
      return true;
    } catch {
      return false;
    }
  }

  async readText(inputPath: string, options?: FileReadOptions): Promise<FileReadResult> {
    const resolved = this.resolvePath(inputPath);
    const encoding = options?.encoding ?? 'utf8';
    const content = await fsp.readFile(resolved, { encoding });
    return {
      content,
      etag: this.createEtag(content),
    };
  }

  async writeText(inputPath: string, content: string, options?: FileWriteOptions): Promise<void> {
    const resolved = this.resolvePath(inputPath);
    await this.ensureEtagMatch(resolved, options?.etag);
    await fsp.mkdir(path.dirname(resolved), { recursive: true });

    const encoding = options?.encoding ?? 'utf8';
    if (options?.atomic) {
      const tmpPath = `${resolved}.tmp-${randomUUID()}`;
      await fsp.writeFile(tmpPath, content, { encoding });
      await fsp.rename(tmpPath, resolved);
      return;
    }

    await fsp.writeFile(resolved, content, { encoding });
  }

  async applyPatch(inputPath: string, diff: string, options?: FilePatchOptions): Promise<void> {
    const resolved = this.resolvePath(inputPath);
    await this.ensureEtagMatch(resolved, options?.etag);

    const original = await fsp.readFile(resolved, { encoding: 'utf8' });
    const normalizedOriginal = this.normalizeLineEndings(original);
    const normalizedPatch = this.normalizePatch(diff);
    const patched = applyUnifiedPatch(normalizedOriginal, normalizedPatch);

    if (patched === false) {
      const conflictError = new Error(
        `PATCH_APPLY_FAILED: patch does not match current content (${inputPath})`
      ) as Error & { code?: string; conflict?: boolean; path?: string };
      conflictError.name = 'PatchConflictError';
      conflictError.code = 'PATCH_CONFLICT';
      conflictError.conflict = true;
      conflictError.path = inputPath;
      throw conflictError;
    }

    await this.writeText(inputPath, patched, {
      encoding: 'utf8',
      atomic: true,
    });
  }

  async list(inputPath: string): Promise<FileListEntry[]> {
    const resolved = this.resolvePath(inputPath);
    const entries = await fsp.readdir(resolved, { withFileTypes: true });
    const result: FileListEntry[] = [];

    for (const entry of entries) {
      const fullPath = path.join(resolved, entry.name);
      const stats = await fsp.stat(fullPath);
      result.push({
        path: fullPath,
        isDirectory: entry.isDirectory(),
        size: stats.size,
        mtimeMs: stats.mtimeMs,
      });
    }

    return result;
  }

  async stat(inputPath: string): Promise<FileStat> {
    const resolved = this.resolvePath(inputPath);
    try {
      const stats = await fsp.stat(resolved);
      return {
        exists: true,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        size: stats.size,
        mtimeMs: stats.mtimeMs,
      };
    } catch (error) {
      const code = this.getErrnoCode(error);
      if (code === 'ENOENT') {
        return {
          exists: false,
          isFile: false,
          isDirectory: false,
        };
      }
      throw error;
    }
  }

  private resolvePath(inputPath: string): string {
    const base = this.rootDir ?? process.cwd();
    const absolute = path.isAbsolute(inputPath)
      ? path.resolve(inputPath)
      : path.resolve(base, inputPath);
    const canonical = this.canonicalizePath(absolute);
    if (!this.rootDir) {
      return canonical;
    }

    const relative = path.relative(this.rootDir, canonical);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
      return canonical;
    }
    throw new Error(`Path "${inputPath}" is outside allowed root "${this.rootDir}"`);
  }

  private async ensureEtagMatch(filePath: string, expectedEtag?: string): Promise<void> {
    if (!expectedEtag) {
      return;
    }

    try {
      const current = await this.readText(filePath);
      if (current.etag !== expectedEtag) {
        throw new Error(
          `ETAG_MISMATCH: expected ${expectedEtag}, got ${current.etag ?? 'unknown'}`
        );
      }
    } catch (error) {
      const code = this.getErrnoCode(error);
      if (code === 'ENOENT') {
        throw new Error(`ETAG_MISMATCH: file "${filePath}" does not exist`);
      }
      throw error;
    }
  }

  private createEtag(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private normalizeLineEndings(content: string): string {
    return content.replace(/\r\n/g, '\n');
  }

  private normalizePatch(patch: string): string {
    const trimmed = patch.trim();
    if (!trimmed.startsWith('```')) {
      return patch;
    }

    const lines = trimmed.split('\n');
    if (lines.length < 2) {
      return patch;
    }

    if (!lines[0].startsWith('```')) {
      return patch;
    }

    if (lines[lines.length - 1].trim() !== '```') {
      return patch;
    }

    return lines.slice(1, -1).join('\n');
  }

  private getErrnoCode(error: unknown): string | undefined {
    if (error && typeof error === 'object' && 'code' in error) {
      const maybeCode = (error as { code?: unknown }).code;
      return typeof maybeCode === 'string' ? maybeCode : undefined;
    }
    return undefined;
  }

  private canonicalizePath(absolutePath: string): string {
    try {
      return fs.realpathSync(absolutePath);
    } catch {
      const parentDir = path.dirname(absolutePath);
      try {
        const parentRealPath = fs.realpathSync(parentDir);
        return path.join(parentRealPath, path.basename(absolutePath));
      } catch {
        return absolutePath;
      }
    }
  }
}

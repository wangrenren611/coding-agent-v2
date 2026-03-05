/**
 * 文件能力接口
 */

import type { ExecutionProfile, ExecutionTarget } from './types';

export interface FileStat {
  exists: boolean;
  isFile: boolean;
  isDirectory: boolean;
  size?: number;
  mtimeMs?: number;
  etag?: string;
}

export interface FileReadResult {
  content: string;
  etag?: string;
}

export interface FileListEntry {
  path: string;
  isDirectory: boolean;
  size?: number;
  mtimeMs?: number;
}

export interface FileReadOptions {
  encoding?: BufferEncoding;
  profile?: ExecutionProfile;
  target?: ExecutionTarget;
}

export interface FileWriteOptions {
  encoding?: BufferEncoding;
  etag?: string;
  atomic?: boolean;
  profile?: ExecutionProfile;
  target?: ExecutionTarget;
}

export interface FilePatchOptions {
  etag?: string;
  profile?: ExecutionProfile;
  target?: ExecutionTarget;
}

export type FileAccessMode = 'read' | 'write' | 'patch' | 'list' | 'stat';

export interface FileAccessRequest {
  path: string;
  mode: FileAccessMode;
  profile?: ExecutionProfile;
  target?: ExecutionTarget;
}

/**
 * 文件执行后端
 */
export interface FileBackend {
  readonly id: string;
  readonly target: ExecutionTarget;
  canAccess(path: string): boolean;
  readText(path: string, options?: FileReadOptions): Promise<FileReadResult>;
  writeText(path: string, content: string, options?: FileWriteOptions): Promise<void>;
  applyPatch(path: string, diff: string, options?: FilePatchOptions): Promise<void>;
  list(path: string): Promise<FileListEntry[]>;
  stat(path: string): Promise<FileStat>;
}

export interface FileBackendRouter {
  route(request: FileAccessRequest): FileBackend;
}

import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { resolveWriteBufferBaseDir } from '../storage/file-storage-config';
import { createConfiguredFileHistoryStore } from '../storage/file-history-store';
import { writeTextFileWithHistory } from '../storage/file-write-service';

export interface WriteBufferSessionMeta {
  bufferId: string;
  messageId: string;
  toolCallId?: string;
  targetPath?: string;
  baseDir: string;
  rawArgsPath: string;
  contentPath: string;
  metaPath: string;
  createdAt: number;
  updatedAt: number;
  rawArgsBytes: number;
  contentBytes: number;
  status: 'active' | 'finalized' | 'aborted';
}

export interface CreateWriteBufferSessionInput {
  messageId?: string;
  toolCallId?: string;
  targetPath?: string;
  baseDir?: string;
}

export interface AppendResult {
  bytesWritten: number;
  totalBytes: number;
  updatedAt: number;
}

function getDefaultBaseDir(): string {
  return resolveWriteBufferBaseDir();
}

function safeSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function writeMeta(meta: WriteBufferSessionMeta): Promise<void> {
  await fs.writeFile(meta.metaPath, JSON.stringify(meta, null, 2), 'utf8');
}

async function readMeta(metaPath: string): Promise<WriteBufferSessionMeta> {
  const content = await fs.readFile(metaPath, 'utf8');
  return JSON.parse(content) as WriteBufferSessionMeta;
}

export function resolveBufferId(toolCallId?: string): string {
  if (typeof toolCallId === 'string' && toolCallId.trim().length > 0) {
    return toolCallId.trim();
  }
  return `buffer_${randomUUID()}`;
}

export async function createWriteBufferSession(
  input: CreateWriteBufferSessionInput
): Promise<WriteBufferSessionMeta> {
  const now = Date.now();
  const baseDir = input.baseDir ? path.resolve(input.baseDir) : getDefaultBaseDir();
  const messageId = input.messageId?.trim() || `msg_${now}`;
  const bufferId = resolveBufferId(input.toolCallId);
  const uniqueSuffix = `${now}_${randomUUID().slice(0, 8)}`;
  const fileStem = `${safeSegment(messageId)}_${safeSegment(bufferId)}_${uniqueSuffix}`;

  await fs.mkdir(baseDir, { recursive: true });

  const rawArgsPath = path.join(baseDir, `${fileStem}.args.tmp`);
  const contentPath = path.join(baseDir, `${fileStem}.content.tmp`);
  const metaPath = path.join(baseDir, `${fileStem}.meta.json`);

  await fs.writeFile(rawArgsPath, '', 'utf8');
  await fs.writeFile(contentPath, '', 'utf8');

  const meta: WriteBufferSessionMeta = {
    bufferId,
    messageId,
    toolCallId: input.toolCallId,
    targetPath: input.targetPath,
    baseDir,
    rawArgsPath,
    contentPath,
    metaPath,
    createdAt: now,
    updatedAt: now,
    rawArgsBytes: 0,
    contentBytes: 0,
    status: 'active',
  };

  await writeMeta(meta);
  return meta;
}

export async function appendRawArgs(
  session: Pick<WriteBufferSessionMeta, 'rawArgsPath' | 'metaPath'>,
  chunk: string
): Promise<AppendResult> {
  const bytesWritten = Buffer.byteLength(chunk, 'utf8');
  await fs.appendFile(session.rawArgsPath, chunk, 'utf8');

  const meta = await readMeta(session.metaPath);
  const updatedAt = Date.now();
  meta.updatedAt = updatedAt;
  meta.rawArgsBytes += bytesWritten;
  await writeMeta(meta);

  return {
    bytesWritten,
    totalBytes: meta.rawArgsBytes,
    updatedAt,
  };
}

export async function appendContent(
  session: Pick<WriteBufferSessionMeta, 'contentPath' | 'metaPath'>,
  chunk: string
): Promise<AppendResult> {
  const bytesWritten = Buffer.byteLength(chunk, 'utf8');
  await fs.appendFile(session.contentPath, chunk, 'utf8');

  const meta = await readMeta(session.metaPath);
  const updatedAt = Date.now();
  meta.updatedAt = updatedAt;
  meta.contentBytes += bytesWritten;
  await writeMeta(meta);

  return {
    bytesWritten,
    totalBytes: meta.contentBytes,
    updatedAt,
  };
}

export async function finalizeWriteBufferSession(
  session: Pick<WriteBufferSessionMeta, 'contentPath' | 'metaPath' | 'targetPath'>
): Promise<WriteBufferSessionMeta> {
  if (!session.targetPath) {
    throw new Error('targetPath is required to finalize write buffer session');
  }

  const meta = await readMeta(session.metaPath);
  if (meta.status !== 'active') {
    throw new Error(`cannot finalize session in status=${meta.status}`);
  }

  const targetPath = path.resolve(session.targetPath);
  const content = await fs.readFile(session.contentPath, 'utf8');
  await writeTextFileWithHistory(targetPath, content, {
    source: 'write_buffer_finalize',
    historyStore: createConfiguredFileHistoryStore(),
  });

  meta.targetPath = targetPath;
  meta.updatedAt = Date.now();
  meta.status = 'finalized';
  await writeMeta(meta);

  return meta;
}

export async function abortWriteBufferSession(
  session: Pick<WriteBufferSessionMeta, 'rawArgsPath' | 'contentPath' | 'metaPath'>
): Promise<void> {
  const meta = await readMeta(session.metaPath);
  meta.status = 'aborted';
  meta.updatedAt = Date.now();
  await writeMeta(meta);
}

export async function cleanupWriteBufferSessionFiles(
  session: Pick<WriteBufferSessionMeta, 'rawArgsPath' | 'contentPath' | 'metaPath'>
): Promise<void> {
  await Promise.all([
    fs.rm(session.rawArgsPath, { force: true }),
    fs.rm(session.contentPath, { force: true }),
    fs.rm(session.metaPath, { force: true }),
  ]);
}

export async function loadWriteBufferSession(metaPath: string): Promise<WriteBufferSessionMeta> {
  return readMeta(metaPath);
}

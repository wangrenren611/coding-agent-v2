import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  abortWriteBufferSession,
  appendContent,
  appendRawArgs,
  cleanupWriteBufferSessionFiles,
  createWriteBufferSession,
  finalizeWriteBufferSession,
  loadWriteBufferSession,
  resolveBufferId,
} from '../write-buffer';

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-v4-write-buffer-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('write-buffer', () => {
  it('uses toolCallId as bufferId when provided', async () => {
    const baseDir = await createTempDir();
    const session = await createWriteBufferSession({
      messageId: 'msg_1',
      toolCallId: 'tool_call_1',
      baseDir,
    });

    expect(session.bufferId).toBe('tool_call_1');
    expect(session.status).toBe('active');
  });

  it('creates generated bufferId when toolCallId is missing', async () => {
    const generated = resolveBufferId(undefined);
    expect(generated.startsWith('buffer_')).toBe(true);
  });

  it('appends raw args and content with byte counters', async () => {
    const baseDir = await createTempDir();
    const session = await createWriteBufferSession({
      messageId: 'msg_append',
      toolCallId: 'tool_append',
      baseDir,
    });

    const raw = await appendRawArgs(session, '{"path":"a.txt"');
    const content = await appendContent(session, 'hello');

    expect(raw.bytesWritten).toBeGreaterThan(0);
    expect(raw.totalBytes).toBe(raw.bytesWritten);
    expect(content.bytesWritten).toBe(5);
    expect(content.totalBytes).toBe(5);

    const loaded = await loadWriteBufferSession(session.metaPath);
    expect(loaded.rawArgsBytes).toBe(raw.totalBytes);
    expect(loaded.contentBytes).toBe(content.totalBytes);
  });

  it('finalizes buffered content to target path', async () => {
    const baseDir = await createTempDir();
    const outputDir = await createTempDir();
    const targetPath = path.join(outputDir, 'out.txt');

    const session = await createWriteBufferSession({
      messageId: 'msg_final',
      toolCallId: 'tool_final',
      targetPath,
      baseDir,
    });
    await appendContent(session, 'part1');
    await appendContent(session, 'part2');

    const finalized = await finalizeWriteBufferSession(session);
    const content = await fs.readFile(targetPath, 'utf8');

    expect(content).toBe('part1part2');
    expect(finalized.status).toBe('finalized');
  });

  it('marks session aborted and supports cleanup', async () => {
    const baseDir = await createTempDir();
    const session = await createWriteBufferSession({
      messageId: 'msg_abort',
      toolCallId: 'tool_abort',
      baseDir,
    });

    await abortWriteBufferSession(session);
    const aborted = await loadWriteBufferSession(session.metaPath);
    expect(aborted.status).toBe('aborted');

    await cleanupWriteBufferSessionFiles(session);
    await expect(fs.stat(session.rawArgsPath)).rejects.toThrow();
    await expect(fs.stat(session.contentPath)).rejects.toThrow();
    await expect(fs.stat(session.metaPath)).rejects.toThrow();
  });
});

import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { WriteFileTool } from '../write-file';
import {
  appendContent,
  appendRawArgs,
  createWriteBufferSession,
} from '../../agent/write-buffer';

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-v4-write-file-tool-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function parseOutput<T>(output: string | undefined): T {
  return JSON.parse(output || '{}') as T;
}

describe('WriteFileTool', () => {
  it('writes small content directly with OK response', async () => {
    const allowedDir = await createTempDir();
    const bufferDir = await createTempDir();
    const tool = new WriteFileTool({
      allowedDirectories: [allowedDir],
      bufferBaseDir: bufferDir,
      maxChunkBytes: 64,
    });
    const target = path.join(allowedDir, 'a.txt');

    const result = await tool.execute({
      path: target,
      content: 'hello',
      mode: 'direct',
    });

    expect(result.success).toBe(true);
    const payload = parseOutput<{
      ok: boolean;
      code: string;
      message: string;
      nextAction: string;
    }>(result.output);
    expect(payload).toMatchObject({
      ok: true,
      code: 'OK',
      nextAction: 'none',
    });
    expect(payload.message).toContain('File written successfully');
    expect(await fs.readFile(target, 'utf8')).toBe('hello');
  });

  it('allows write when target path goes through a symlinked directory inside allowed roots', async () => {
    const allowedDir = await createTempDir();
    const linkBaseDir = await createTempDir();
    const bufferDir = await createTempDir();
    const linkDir = path.join(linkBaseDir, 'allowed-link');
    await fs.symlink(allowedDir, linkDir);

    const tool = new WriteFileTool({
      allowedDirectories: [allowedDir],
      bufferBaseDir: bufferDir,
      maxChunkBytes: 64,
    });

    const targetViaLink = path.join(linkDir, 'through-link.txt');
    const result = await tool.execute({
      path: targetViaLink,
      content: 'hello-link',
      mode: 'direct',
    });

    expect(result.success).toBe(true);
    expect(await fs.readFile(path.join(allowedDir, 'through-link.txt'), 'utf8')).toBe('hello-link');
  });

  it('buffers large direct write and requests finalize', async () => {
    const allowedDir = await createTempDir();
    const bufferDir = await createTempDir();
    const tool = new WriteFileTool({
      allowedDirectories: [allowedDir],
      bufferBaseDir: bufferDir,
      maxChunkBytes: 8,
    });
    const target = path.join(allowedDir, 'large.txt');

    const result = await tool.execute(
      {
        path: target,
        content: '0123456789012345',
        mode: 'direct',
      },
      {
        toolCallId: 'write_call_1',
        loopIndex: 1,
        agent: {},
      }
    );

    expect(result.success).toBe(false);
    const payload = parseOutput<{
      ok: boolean;
      code: string;
      nextAction: string;
      buffer: { bufferId: string; bufferedBytes: number; maxChunkBytes: number };
    }>(result.output);
    expect(payload.ok).toBe(false);
    expect(payload.code).toBe('WRITE_FILE_PARTIAL_BUFFERED');
    expect(payload.nextAction).toBe('finalize');
    expect(payload.buffer.bufferId).toBe('write_call_1');
    expect(payload.buffer.bufferedBytes).toBe(Buffer.byteLength('0123456789012345', 'utf8'));
    expect(payload.buffer.maxChunkBytes).toBe(8);
  });

  it('finalizes a fully buffered direct write without any intermediate chunk step', async () => {
    const allowedDir = await createTempDir();
    const bufferDir = await createTempDir();
    const tool = new WriteFileTool({
      allowedDirectories: [allowedDir],
      bufferBaseDir: bufferDir,
      maxChunkBytes: 8,
    });
    const target = path.join(allowedDir, 'finalize.txt');
    const fullContent = 'abcdefghi';

    const direct = await tool.execute(
      {
        path: target,
        content: 'abcdefghi',
        mode: 'direct',
      },
      {
        toolCallId: 'write_call_2',
        loopIndex: 1,
        agent: {},
      }
    );
    const directPayload = parseOutput<{ buffer: { bufferId: string } }>(direct.output);

    const finalize = await tool.execute({
      path: target,
      mode: 'finalize',
      bufferId: directPayload.buffer.bufferId,
    });
    const finalizePayload = parseOutput<{ ok: boolean; code: string; nextAction: string }>(
      finalize.output
    );
    expect(finalizePayload).toMatchObject({
      ok: true,
      code: 'WRITE_FILE_FINALIZE_OK',
      nextAction: 'none',
    });
    expect(await fs.readFile(target, 'utf8')).toBe(fullContent);
  });

  it('finalizes buffered content to the original full direct payload', async () => {
    const allowedDir = await createTempDir();
    const bufferDir = await createTempDir();
    const tool = new WriteFileTool({
      allowedDirectories: [allowedDir],
      bufferBaseDir: bufferDir,
      maxChunkBytes: 8,
    });
    const target = path.join(allowedDir, 'finalize-no-checksum.txt');
    const content = 'abcdefghijk';

    const direct = await tool.execute(
      {
        path: target,
        content,
        mode: 'direct',
      },
      {
        toolCallId: 'write_call_3',
        loopIndex: 1,
        agent: {},
      }
    );
    const directPayload = parseOutput<{ buffer: { bufferId: string } }>(direct.output);

    const finalize = await tool.execute({
      path: target,
      mode: 'finalize',
      bufferId: directPayload.buffer.bufferId,
    });
    const finalizePayload = parseOutput<{ ok: boolean; code: string; nextAction: string }>(
      finalize.output
    );
    expect(finalizePayload).toMatchObject({
      ok: true,
      code: 'WRITE_FILE_FINALIZE_OK',
      nextAction: 'none',
    });
    expect(await fs.readFile(target, 'utf8')).toBe(content);
  });

  it('finalizes a buffered direct write by bufferId without requiring path and keeps full content', async () => {
    const allowedDir = await createTempDir();
    const bufferDir = await createTempDir();
    const tool = new WriteFileTool({
      allowedDirectories: [allowedDir],
      bufferBaseDir: bufferDir,
      maxChunkBytes: 8,
    });
    const target = path.join(allowedDir, 'finalize-by-buffer-id.txt');
    const content = 'abcdefghijklmno';

    const direct = await tool.execute(
      {
        path: target,
        content,
        mode: 'direct',
      },
      {
        toolCallId: 'write_call_finalize_by_id',
        loopIndex: 1,
        agent: {},
      }
    );
    const directPayload = parseOutput<{ ok: boolean; buffer: { bufferId: string } }>(direct.output);
    expect(directPayload.ok).toBe(false);

    const finalize = await tool.execute({
      mode: 'finalize',
      bufferId: directPayload.buffer.bufferId,
    } as never);
    const finalizePayload = parseOutput<{ ok: boolean; code: string; nextAction: string }>(
      finalize.output
    );
    expect(finalizePayload).toMatchObject({
      ok: true,
      code: 'WRITE_FILE_FINALIZE_OK',
      nextAction: 'none',
    });
    expect(await fs.readFile(target, 'utf8')).toBe(content);
  });

  it('finalizes an orphaned buffered session by scanning meta/rawArgs when pointer is missing', async () => {
    const allowedDir = await createTempDir();
    const bufferDir = await createTempDir();
    const tool = new WriteFileTool({
      allowedDirectories: [allowedDir],
      bufferBaseDir: bufferDir,
      maxChunkBytes: 8,
    });
    const target = path.join(allowedDir, 'finalize-orphaned-session.txt');
    const content = 'orphaned buffered content';
    const session = await createWriteBufferSession({
      messageId: 'msg_orphaned',
      toolCallId: 'write_call_orphaned',
      baseDir: bufferDir,
    });

    await appendRawArgs(
      session,
      JSON.stringify({
        mode: 'direct',
        path: target,
        content,
      })
    );
    await appendContent(session, content);

    const finalize = await tool.execute({
      mode: 'finalize',
      bufferId: session.bufferId,
    } as never);
    const payload = parseOutput<{ ok: boolean; code: string; nextAction: string }>(finalize.output);

    expect(payload).toMatchObject({
      ok: true,
      code: 'WRITE_FILE_FINALIZE_OK',
      nextAction: 'none',
    });
    expect(await fs.readFile(target, 'utf8')).toBe(content);
  });

  it('returns NEED_FINALIZE when finalize is missing bufferId', async () => {
    const allowedDir = await createTempDir();
    const bufferDir = await createTempDir();
    const tool = new WriteFileTool({
      allowedDirectories: [allowedDir],
      bufferBaseDir: bufferDir,
      maxChunkBytes: 8,
    });
    const payload = parseOutput<{
      ok: boolean;
      code: string;
      nextAction: string;
    }>(
      (
        await tool.execute({
          mode: 'finalize',
        } as never)
      ).output
    );

    expect(payload.ok).toBe(false);
    expect(payload.code).toBe('WRITE_FILE_NEED_FINALIZE');
    expect(payload.nextAction).toBe('finalize');
  });

  it('prevents finalize from committing buffered content to a different target path', async () => {
    const allowedDir = await createTempDir();
    const bufferDir = await createTempDir();
    const tool = new WriteFileTool({
      allowedDirectories: [allowedDir],
      bufferBaseDir: bufferDir,
      maxChunkBytes: 8,
    });
    const targetA = path.join(allowedDir, 'target-a.txt');
    const targetB = path.join(allowedDir, 'target-b.txt');

    const direct = await tool.execute(
      {
        path: targetA,
        content: 'abcdefghijk',
        mode: 'direct',
      },
      {
        toolCallId: 'write_call_path_mismatch',
        loopIndex: 1,
        agent: {},
      }
    );
    const directPayload = parseOutput<{ buffer: { bufferId: string } }>(direct.output);

    const finalize = await tool.execute({
      path: targetB,
      mode: 'finalize',
      bufferId: directPayload.buffer.bufferId,
    });
    const payload = parseOutput<{ ok: boolean; code: string; message: string; nextAction: string }>(
      finalize.output
    );

    expect(payload.ok).toBe(false);
    expect(payload.code).toBe('WRITE_FILE_NEED_FINALIZE');
    expect(payload.message).toContain('Target path does not match');
    expect(payload.nextAction).toBe('finalize');
    await expect(fs.readFile(targetB, 'utf8')).rejects.toBeDefined();
  });

  it('returns execution failure when path is outside allowed directories', async () => {
    const allowedDir = await createTempDir();
    const bufferDir = await createTempDir();
    const tool = new WriteFileTool({
      allowedDirectories: [allowedDir],
      bufferBaseDir: bufferDir,
      maxChunkBytes: 32,
    });
    const outside = path.resolve(allowedDir, '..', 'outside.txt');

    const result = await tool.execute({
      path: outside,
      content: 'x',
      mode: 'direct',
    });

    expect(result.success).toBe(false);
    expect(result.error?.name).toBe('ToolExecutionError');
    expect(result.output).toContain('Path is outside allowed directories');
  });
});

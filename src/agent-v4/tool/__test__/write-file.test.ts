import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { WriteFileTool } from '../write-file';

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

  it('buffers large direct write and requests resume', async () => {
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
    expect(payload.nextAction).toBe('resume');
    expect(payload.buffer.bufferId).toBe('write_call_1');
    expect(payload.buffer.bufferedBytes).toBeGreaterThan(0);
    expect(payload.buffer.maxChunkBytes).toBe(8);
  });

  it('supports resume and finalize protocol with checksum', async () => {
    const allowedDir = await createTempDir();
    const bufferDir = await createTempDir();
    const tool = new WriteFileTool({
      allowedDirectories: [allowedDir],
      bufferBaseDir: bufferDir,
      maxChunkBytes: 8,
    });
    const target = path.join(allowedDir, 'resume.txt');
    const fullContent = 'abcdefghi12345678';
    const expectedSha256 = createHash('sha256').update(fullContent).digest('hex');

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

    const resume1 = await tool.execute({
      path: target,
      content: 'i1234567',
      mode: 'resume',
      bufferId: directPayload.buffer.bufferId,
    });
    const resume1Payload = parseOutput<{ code: string; nextAction: string }>(resume1.output);
    expect(resume1Payload.code).toBe('WRITE_FILE_NEED_RESUME');
    expect(resume1Payload.nextAction).toBe('resume');

    const resume2 = await tool.execute({
      path: target,
      content: '8',
      mode: 'resume',
      bufferId: directPayload.buffer.bufferId,
      expectedSize: Buffer.byteLength(fullContent, 'utf8'),
    });
    const resume2Payload = parseOutput<{ code: string; nextAction: string }>(resume2.output);
    expect(resume2Payload.code).toBe('WRITE_FILE_NEED_RESUME');
    expect(resume2Payload.nextAction).toBe('finalize');

    const finalize = await tool.execute({
      path: target,
      mode: 'finalize',
      bufferId: directPayload.buffer.bufferId,
      expectedSize: Buffer.byteLength(fullContent, 'utf8'),
      expectedSha256,
    });
    const finalizePayload = parseOutput<{ ok: boolean; code: string; nextAction: string }>(finalize.output);
    expect(finalizePayload).toMatchObject({
      ok: true,
      code: 'WRITE_FILE_FINALIZE_OK',
      nextAction: 'none',
    });
    expect(await fs.readFile(target, 'utf8')).toBe(fullContent);
  });

  it('returns checksum mismatch on finalize when expected checksum is wrong', async () => {
    const allowedDir = await createTempDir();
    const bufferDir = await createTempDir();
    const tool = new WriteFileTool({
      allowedDirectories: [allowedDir],
      bufferBaseDir: bufferDir,
      maxChunkBytes: 8,
    });
    const target = path.join(allowedDir, 'checksum.txt');

    const direct = await tool.execute(
      {
        path: target,
        content: 'abcdefghijk',
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
      expectedSha256: createHash('sha256').update('wrong').digest('hex'),
    });
    const finalizePayload = parseOutput<{ ok: boolean; code: string; nextAction: string }>(finalize.output);
    expect(finalizePayload.ok).toBe(false);
    expect(finalizePayload.code).toBe('WRITE_FILE_CHECKSUM_MISMATCH');
    expect(finalizePayload.nextAction).toBe('resume');
  });

  it('returns NEED_RESUME with current buffer snapshot when resume chunk exceeds maxChunkBytes', async () => {
    const allowedDir = await createTempDir();
    const bufferDir = await createTempDir();
    const tool = new WriteFileTool({
      allowedDirectories: [allowedDir],
      bufferBaseDir: bufferDir,
      maxChunkBytes: 8,
    });
    const target = path.join(allowedDir, 'oversize-resume.txt');

    const direct = await tool.execute(
      {
        path: target,
        content: 'abcdefghi',
        mode: 'direct',
      },
      {
        toolCallId: 'write_call_oversize_resume',
        loopIndex: 1,
        agent: {},
      }
    );
    const directPayload = parseOutput<{ buffer: { bufferId: string } }>(direct.output);

    const resume = await tool.execute({
      path: target,
      content: '1234567890',
      mode: 'resume',
      bufferId: directPayload.buffer.bufferId,
    });
    const payload = parseOutput<{
      ok: boolean;
      code: string;
      nextAction: string;
      buffer: { bufferedBytes: number; maxChunkBytes: number };
    }>(resume.output);

    expect(payload.ok).toBe(false);
    expect(payload.code).toBe('WRITE_FILE_NEED_RESUME');
    expect(payload.nextAction).toBe('resume');
    expect(payload.buffer.bufferedBytes).toBe(8);
    expect(payload.buffer.maxChunkBytes).toBe(8);
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
    expect(payload.code).toBe('WRITE_FILE_NEED_RESUME');
    expect(payload.message).toContain('Target path does not match');
    expect(payload.nextAction).toBe('resume');
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

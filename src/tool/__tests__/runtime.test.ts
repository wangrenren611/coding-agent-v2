import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fsp } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { createTwoFilesPatch } from 'diff';
import {
  LocalFileBackend,
  RemoteCommandExecutor,
  StaticCommandExecutionRouter,
  StaticFileBackendRouter,
  type CommandExecutionRequest,
  type CommandExecutor,
} from '../runtime';

async function createTempDir(prefix: string): Promise<string> {
  return fsp.mkdtemp(path.join(tmpdir(), prefix));
}

describe('runtime command router', () => {
  it('should route by explicit target', () => {
    const localExecutor: CommandExecutor = {
      id: 'local',
      target: 'local',
      canExecute: () => true,
      execute: async () => ({ success: true, exitCode: 0, output: 'local' }),
    };
    const remoteExecutor: CommandExecutor = {
      id: 'remote',
      target: 'remote',
      canExecute: () => true,
      execute: async () => ({ success: true, exitCode: 0, output: 'remote' }),
    };
    const router = new StaticCommandExecutionRouter({
      defaultTarget: 'local',
      executors: [localExecutor, remoteExecutor],
    });

    const executor = router.route({
      command: 'echo hi',
      cwd: '/tmp',
      timeoutMs: 1000,
      target: 'remote',
    });
    expect(executor.id).toBe('remote');
  });
});

describe('remote command executor', () => {
  it('should map response body to command result', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          success: true,
          exitCode: 0,
          output: 'hello from remote',
          events: [{ type: 'stdout', content: 'stream-chunk' }],
          metadata: { node: 'worker-1' },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }
      );
    });

    const events: Array<{ type: string; content?: string }> = [];
    const executor = new RemoteCommandExecutor({
      endpoint: 'https://executor.example/execute',
      fetchImpl: fetchMock as typeof fetch,
    });

    const request: CommandExecutionRequest = {
      command: 'echo hi',
      cwd: '/repo',
      timeoutMs: 1000,
      target: 'remote',
    };
    const result = await executor.execute(request, {
      onEvent: (event) => {
        events.push({ type: event.type, content: event.content });
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('hello from remote');
    expect(events.some((event) => event.type === 'stdout')).toBe(true);
  });

  it('should throw for non-200 response', async () => {
    const fetchMock = vi.fn(async () => new Response('upstream failed', { status: 503 }));
    const executor = new RemoteCommandExecutor({
      endpoint: 'https://executor.example/execute',
      fetchImpl: fetchMock as typeof fetch,
    });

    await expect(
      executor.execute({
        command: 'echo hi',
        cwd: '/repo',
        timeoutMs: 1000,
        target: 'remote',
      })
    ).rejects.toThrow(/HTTP 503/);
  });
});

describe('local file backend', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.map(async (dir) => {
        await fsp.rm(dir, { recursive: true, force: true });
      })
    );
    tempDirs.length = 0;
  });

  it('should write/read/stat/list inside root', async () => {
    const root = await createTempDir('runtime-file-');
    tempDirs.push(root);

    const backend = new LocalFileBackend({ rootDir: root });
    const filePath = 'notes/hello.txt';

    await backend.writeText(filePath, 'hello world', { atomic: true });
    const readResult = await backend.readText(filePath);
    const stat = await backend.stat(filePath);
    const list = await backend.list('notes');

    expect(readResult.content).toBe('hello world');
    expect(readResult.etag).toBeDefined();
    expect(stat.exists).toBe(true);
    expect(stat.isFile).toBe(true);
    expect(list.some((entry) => entry.path.endsWith('hello.txt'))).toBe(true);
  });

  it('should enforce root boundary', async () => {
    const root = await createTempDir('runtime-file-root-');
    tempDirs.push(root);
    const outside = await createTempDir('runtime-file-outside-');
    tempDirs.push(outside);

    const backend = new LocalFileBackend({ rootDir: root });
    const outsidePath = path.join(outside, 'x.txt');

    await expect(backend.writeText(outsidePath, 'blocked')).rejects.toThrow(/outside allowed root/);
  });

  it('should reject write on etag mismatch', async () => {
    const root = await createTempDir('runtime-file-etag-');
    tempDirs.push(root);

    const backend = new LocalFileBackend({ rootDir: root });
    await backend.writeText('a.txt', 'v1');
    const read = await backend.readText('a.txt');

    await backend.writeText('a.txt', 'v2', { etag: read.etag });
    await expect(backend.writeText('a.txt', 'v3', { etag: read.etag })).rejects.toThrow(
      /ETAG_MISMATCH/
    );
  });

  it('should apply unified patch successfully', async () => {
    const root = await createTempDir('runtime-file-patch-');
    tempDirs.push(root);

    const backend = new LocalFileBackend({ rootDir: root });
    await backend.writeText('patch.txt', 'hello\nworld\n', { atomic: true });

    const diff = createTwoFilesPatch(
      'patch.txt',
      'patch.txt',
      'hello\nworld\n',
      'hello\nplanet\n',
      'original',
      'modified'
    );

    await backend.applyPatch('patch.txt', diff);
    const read = await backend.readText('patch.txt');
    expect(read.content).toContain('planet');
  });

  it('should fail when patch cannot be applied', async () => {
    const root = await createTempDir('runtime-file-patch-fail-');
    tempDirs.push(root);

    const backend = new LocalFileBackend({ rootDir: root });
    await backend.writeText('patch-fail.txt', 'line-a\nline-b\n', { atomic: true });

    const diff = createTwoFilesPatch(
      'patch-fail.txt',
      'patch-fail.txt',
      'different-a\ndifferent-b\n',
      'different-a\ndifferent-c\n',
      'original',
      'modified'
    );

    await expect(backend.applyPatch('patch-fail.txt', diff)).rejects.toThrow(/PATCH_APPLY_FAILED/);
  });
});

describe('file backend router', () => {
  it('should route to matching backend target', async () => {
    const root = await createTempDir('runtime-file-router-');
    await fsp.mkdir(path.join(root, 'data'), { recursive: true });
    await fsp.writeFile(path.join(root, 'data', 'x.txt'), 'x', 'utf8');

    try {
      const localBackend = new LocalFileBackend({ id: 'local', rootDir: root, target: 'local' });
      const sandboxBackend = new LocalFileBackend({
        id: 'sandbox',
        rootDir: root,
        target: 'sandbox',
      });
      const router = new StaticFileBackendRouter({
        defaultTarget: 'local',
        backends: [localBackend, sandboxBackend],
      });

      const backend = router.route({
        path: 'data',
        mode: 'list',
        target: 'sandbox',
      });
      expect(backend.id).toBe('sandbox');
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });
});

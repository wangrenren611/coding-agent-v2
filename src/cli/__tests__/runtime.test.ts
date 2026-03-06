import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { CliRuntime } from '../runtime';
import { createFileStorageBundle, MemoryManager } from '../../storage';
import type { Logger } from '../../logger';
import type { RuntimeConfig } from '../../config';

const originalHome = process.env.HOME;

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
});

describe('CliRuntime.saveMemoryRule', () => {
  test('writes project memory rules into cwd AGENTS.md', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-runtime-memory-project-'));
    const runtime = new CliRuntime({
      baseCwd: cwd,
      cwd,
      quiet: true,
    });

    const first = await runtime.saveMemoryRule('Always add tests', 'project');
    const second = await runtime.saveMemoryRule('Always add tests', 'project');
    const content = await fs.readFile(path.join(cwd, 'AGENTS.md'), 'utf8');

    expect(first.filePath).toBe(path.join(cwd, 'AGENTS.md'));
    expect(second.duplicate).toBe(true);
    expect(content).toContain('## Memory');
    expect(content.match(/Always add tests/g)?.length).toBe(1);
  });

  test('writes global memory rules under HOME scoped AGENTS.md', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-runtime-memory-global-'));
    process.env.HOME = root;

    const runtime = new CliRuntime({
      baseCwd: root,
      cwd: root,
      quiet: true,
    });

    const result = await runtime.saveMemoryRule('Prefer concise answers', 'global');
    const filePath = path.join(root, '.coding-agent-v2', 'AGENTS.md');
    const content = await fs.readFile(filePath, 'utf8');

    expect(result.filePath).toBe(filePath);
    expect(content).toContain('Prefer concise answers');
  });
});

describe('CliRuntime.forkSession', () => {
  test('creates a new session from history up to the selected message', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-runtime-fork-'));
    const manager = new MemoryManager(createFileStorageBundle(root));
    await manager.initialize();

    const sessionId = await manager.createSession('source-session', 'system prompt');
    await manager.addMessages(sessionId, [
      { messageId: 'u1', role: 'user', content: 'first' },
      { messageId: 'a1', role: 'assistant', content: 'reply 1' },
      { messageId: 'u2', role: 'user', content: 'second' },
      { messageId: 'a2', role: 'assistant', content: 'reply 2' },
    ]);

    const runtime = new CliRuntime({
      baseCwd: root,
      cwd: root,
      quiet: true,
      sessionId,
    });
    runtime.deps = {
      logger: { child: () => ({}) } as unknown as Logger,
      memoryManager: manager,
      runtimeConfig: {
        storage: { backend: 'file', dir: root, sqlitePath: path.join(root, 'db.sqlite') },
        log: { filePath: path.join(root, 'logs.txt') },
      } as unknown as RuntimeConfig,
    };

    const forkedSessionId = await runtime.forkSession(sessionId, 'u2');
    const forkedHistory = manager.getHistory(
      { sessionId: forkedSessionId },
      { orderBy: 'sequence', orderDirection: 'asc' }
    );

    expect(forkedSessionId).not.toBe(sessionId);
    expect(forkedHistory.map((item) => item.content)).toEqual([
      'system prompt',
      'first',
      'reply 1',
      'second',
    ]);
  });
});

describe('CliRuntime lifecycle', () => {
  test('reference-counts initialize/close and only closes deps at zero', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-runtime-lifecycle-'));
    const runtime = new CliRuntime({
      baseCwd: root,
      cwd: root,
      quiet: true,
    });

    await runtime.initialize();
    const firstDeps = runtime.deps;
    expect(firstDeps).toBeDefined();
    const closeSpy = vi.spyOn(firstDeps!.memoryManager, 'close');

    await runtime.initialize();
    expect(runtime.deps).toBe(firstDeps);

    await runtime.close();
    expect(closeSpy).not.toHaveBeenCalled();
    expect(runtime.deps).toBe(firstDeps);

    await runtime.close();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    expect(runtime.deps).toBeUndefined();
  });
});

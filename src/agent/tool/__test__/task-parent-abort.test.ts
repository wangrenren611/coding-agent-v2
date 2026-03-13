import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskStore } from '../task-store';
import { attachParentAbortCascade, PARENT_ABORT_REASON } from '../task-parent-abort';
import type { SubagentRunnerAdapter } from '../task-runner-adapter';
import type { AgentRunEntity, TaskEntity } from '../task-types';
import type { ToolExecutionContext, ToolStreamEventInput } from '../types';

function makeRun(agentId: string, status: AgentRunEntity['status'] = 'cancelled'): AgentRunEntity {
  const now = Date.now();
  return {
    agentId,
    status,
    subagentType: 'Plan',
    prompt: 'p',
    createdAt: now,
    startedAt: now,
    updatedAt: now,
    metadata: {},
    version: 1,
  };
}

function makeTask(id: string, status: TaskEntity['status'], agentId?: string): TaskEntity {
  const now = Date.now();
  return {
    id,
    subject: id,
    description: `${id} description long enough`,
    activeForm: id,
    status,
    priority: 'normal',
    owner: status === 'in_progress' ? `agent:${agentId || 'x'}` : null,
    blockedBy: [],
    blocks: [],
    progress: 0,
    checkpoints: [],
    retryConfig: {
      maxRetries: 3,
      retryDelayMs: 100,
      backoffMultiplier: 2,
      retryOn: ['timeout'],
    },
    retryCount: 0,
    tags: [],
    metadata: {},
    history: [],
    agentId,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

function makeRunner(
  cancelImpl: (
    namespace: string,
    agentId: string,
    reason?: string
  ) => Promise<AgentRunEntity | null>
): SubagentRunnerAdapter {
  return {
    start: async () => makeRun('unused', 'running'),
    poll: async () => null,
    cancel: cancelImpl,
  };
}

async function waitUntil(check: () => boolean | Promise<boolean>, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for condition');
}

async function rmDirWithRetry(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOTEMPTY' && code !== 'EBUSY' && code !== 'EPERM') {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

function makeContext(signal: AbortSignal, chunks: ToolStreamEventInput[]): ToolExecutionContext {
  return {
    toolCallId: 'tc',
    loopIndex: 1,
    agent: {},
    toolAbortSignal: signal,
    onChunk: async (event) => {
      chunks.push(event);
    },
  };
}

describe('task-parent-abort cascade', () => {
  let baseDir: string;
  let store: TaskStore;

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-task-parent-abort-'));
    store = new TaskStore({ baseDir });
  });

  afterEach(async () => {
    await rmDirWithRetry(baseDir);
  });

  it('returns noop detach when context has no abort signal', async () => {
    let cancelCalls = 0;
    const runner = makeRunner(async () => {
      cancelCalls += 1;
      return makeRun('a1');
    });

    const detach = attachParentAbortCascade({
      namespace: 'n1',
      agentId: 'a1',
      runner,
      store,
    });
    detach();

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(cancelCalls).toBe(0);
  });

  it('deduplicates abort callbacks and supports detach with custom signal', async () => {
    let cancelCalls = 0;
    let removed = false;
    let registered: (() => void) | undefined;
    const runner = makeRunner(async () => {
      cancelCalls += 1;
      return makeRun('a2');
    });

    const signal = {
      aborted: true,
      addEventListener: (_name: string, cb: () => void) => {
        registered = cb;
        cb();
      },
      removeEventListener: (_name: string, cb: () => void) => {
        removed = registered === cb;
      },
    } as unknown as AbortSignal;

    const detach = attachParentAbortCascade({
      namespace: 'n1',
      agentId: 'a2',
      runner,
      store,
      context: makeContext(signal, []),
    });

    await waitUntil(() => cancelCalls === 1);
    expect(cancelCalls).toBe(1);
    detach();
    expect(removed).toBe(true);
  });

  it('skips linked task updates when task missing, mismatched, or already terminal', async () => {
    await store.updateState('n2', (state) => {
      state.tasks.t_mismatch = makeTask('t_mismatch', 'in_progress', 'agent-other');
      state.tasks.t_done = makeTask('t_done', 'completed', 'agent-main');
      return null;
    });

    let cancelCalls = 0;
    const runner = makeRunner(async () => {
      cancelCalls += 1;
      return makeRun('agent-main');
    });

    const chunks: ToolStreamEventInput[] = [];

    const c1 = new AbortController();
    attachParentAbortCascade({
      namespace: 'n2',
      agentId: 'agent-main',
      linkedTaskId: 'missing',
      runner,
      store,
      context: makeContext(c1.signal, chunks),
    });
    c1.abort();

    const c2 = new AbortController();
    attachParentAbortCascade({
      namespace: 'n2',
      agentId: 'agent-main',
      linkedTaskId: 't_mismatch',
      runner,
      store,
      context: makeContext(c2.signal, chunks),
    });
    c2.abort();

    const c3 = new AbortController();
    attachParentAbortCascade({
      namespace: 'n2',
      agentId: 'agent-main',
      linkedTaskId: 't_done',
      runner,
      store,
      context: makeContext(c3.signal, chunks),
    });
    c3.abort();

    await waitUntil(() => cancelCalls === 3);
    const state = await store.getState('n2');
    expect(state.tasks.t_mismatch.status).toBe('in_progress');
    expect(state.tasks.t_done.status).toBe('completed');
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  it('cancels linked task and writes parent-abort history', async () => {
    await store.updateState('n3', (state) => {
      state.tasks.t_active = makeTask('t_active', 'in_progress', 'agent-ok');
      return null;
    });

    const chunks: ToolStreamEventInput[] = [];
    const runner = makeRunner(async () => makeRun('agent-ok'));
    const controller = new AbortController();

    attachParentAbortCascade({
      namespace: 'n3',
      agentId: 'agent-ok',
      linkedTaskId: 't_active',
      runner,
      store,
      context: makeContext(controller.signal, chunks),
    });
    controller.abort();

    await waitUntil(async () => {
      const state = await store.getState('n3');
      return state.tasks.t_active.status === 'cancelled';
    });

    const state = await store.getState('n3');
    const task = state.tasks.t_active;
    expect(task.status).toBe('cancelled');
    expect(task.history.some((entry) => entry.actor === 'task-parent-abort')).toBe(true);
    expect(task.history.some((entry) => entry.reason === PARENT_ABORT_REASON)).toBe(true);
    expect(chunks.some((entry) => entry.type === 'info')).toBe(true);
  });

  it('emits stderr chunk when cancel throws non-Error value', async () => {
    const chunks: ToolStreamEventInput[] = [];
    const runner = makeRunner(async () => {
      throw 'raw-failure';
    });
    const controller = new AbortController();

    attachParentAbortCascade({
      namespace: 'n4',
      agentId: 'agent-fail',
      runner,
      store,
      context: makeContext(controller.signal, chunks),
    });
    controller.abort();

    await waitUntil(() =>
      chunks.some(
        (entry) =>
          entry.type === 'stderr' &&
          String(entry.content || '').includes('failed to cascade parent abort: raw-failure')
      )
    );
  });
});

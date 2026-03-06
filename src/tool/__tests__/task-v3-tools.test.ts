import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Chunk, LLMProvider, LLMRequestMessage } from '../../providers';
import type { ToolExecutionContext } from '../types';
import { TaskV3Runtime } from '../task-v3/runtime/runtime';
import { ToolManager } from '../manager';
import {
  TaskV3ClearSessionTool,
  TaskV3GcRunsTool,
  TaskV3GetTool,
  TaskV3ListTool,
  TaskV3RunCancelTool,
  TaskV3RunEventsTool,
  TaskV3RunGetTool,
  TaskV3RunWaitTool,
  TaskV3TasksTool,
  TaskV3Tool,
  TaskV3UpdateTool,
} from '../task-v3-tools';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createImmediateProvider(text: string): LLMProvider {
  return {
    config: { model: 'test-model' },
    generate: async () => {
      throw new Error('Not implemented');
    },
    async *generateStream(_messages: LLMRequestMessage[]) {
      const chunk: Chunk = {
        index: 0,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: text },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      };
      yield chunk;
    },
    getTimeTimeout: () => 60000,
    getLLMMaxTokens: () => 128000,
    getMaxOutputTokens: () => 8000,
  } as unknown as LLMProvider;
}

function createPromptAwareProvider(): LLMProvider {
  return {
    config: { model: 'test-model' },
    generate: async () => {
      throw new Error('Not implemented');
    },
    async *generateStream(messages: LLMRequestMessage[]) {
      const content = messages
        .map((msg) => (typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)))
        .join('\n');

      if (content.includes('[FAIL]')) {
        throw new Error('simulated failure');
      }

      const chunk: Chunk = {
        index: 0,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      };
      yield chunk;
    },
    getTimeTimeout: () => 60000,
    getLLMMaxTokens: () => 128000,
    getMaxOutputTokens: () => 8000,
  } as unknown as LLMProvider;
}

function createBlockingProvider(): LLMProvider {
  return {
    config: { model: 'test-model' },
    generate: async () => {
      throw new Error('Not implemented');
    },
    // eslint-disable-next-line require-yield
    async *generateStream(_messages: LLMRequestMessage[], options?: { abortSignal?: AbortSignal }) {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (options?.abortSignal?.aborted) {
          throw new Error('aborted');
        }
        await sleep(20);
      }
    },
    getTimeTimeout: () => 60000,
    getLLMMaxTokens: () => 128000,
    getMaxOutputTokens: () => 8000,
  } as unknown as LLMProvider;
}

function createContext(sessionId: string, provider?: LLMProvider): ToolExecutionContext {
  return {
    toolCallId: `call-${sessionId}`,
    loopIndex: 0,
    stepIndex: 0,
    agent: {
      getSessionId: () => sessionId,
      config: provider ? { provider } : {},
    } as unknown as ToolExecutionContext['agent'],
    agentContext: {
      sessionId,
      loopIndex: 0,
      stepIndex: 0,
    },
  };
}

const TASK_ARGS_DEFAULTS = {
  priority: 'medium' as const,
  poll_interval_ms: 300,
  dedupe_window_ms: 120_000,
  force_new: false,
  include_events: false,
  events_after_seq: 0,
  events_limit: 200,
};

const TASKS_ARGS_DEFAULTS = {
  max_parallel: 3,
  wait: true,
  poll_interval_ms: 300,
  dedupe_window_ms: 120_000,
  force_new: false,
  fail_fast: false,
  include_events: false,
  events_after_seq: 0,
  events_limit: 100,
};

describe('task-v3 tools', () => {
  let tempDir: string;
  let dbPath: string;
  let runtime: TaskV3Runtime;

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'task-v3-tools-'));
    dbPath = path.join(tempDir, 'tasks.db');
    runtime = new TaskV3Runtime({ dbPath });
    await runtime.prepare();
  });

  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  it('exposes expected tool schema and passes manager validation with minimal args', async () => {
    const provider = createImmediateProvider('schema-ok');
    const context = createContext('schema-session', provider);
    const manager = new ToolManager();
    const taskTool = new TaskV3Tool({ runtime });
    const tasksTool = new TaskV3TasksTool({ runtime });
    manager.register([taskTool, tasksTool]);

    const schemas = manager.toToolsSchema();
    const taskSchema = schemas.find((item) => item.function.name === 'task')?.function
      .parameters as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    const tasksSchema = schemas.find((item) => item.function.name === 'tasks')?.function
      .parameters as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    const tasksItemSchema = (
      tasksSchema.properties?.items as { items?: { properties?: Record<string, unknown> } }
    )?.items;

    expect(taskSchema.properties).toBeDefined();
    expect(Object.keys(taskSchema.properties ?? {})).toEqual(
      expect.arrayContaining([
        'description',
        'prompt',
        'system_prompt',
        'profile',
        'priority',
        'wait',
      ])
    );
    expect(Object.keys(taskSchema.properties ?? {})).not.toContain('timeout_ms');
    expect(Object.keys(taskSchema.properties ?? {})).not.toContain('wait_timeout_ms');
    expect((taskSchema.required ?? []).length).toBe(0);

    expect(tasksSchema.properties).toBeDefined();
    expect(tasksSchema.required ?? []).toContain('items');
    expect(Object.keys(tasksSchema.properties ?? {})).not.toContain('wait_timeout_ms');
    expect(Object.keys(tasksItemSchema?.properties ?? {})).toEqual(
      expect.arrayContaining([
        'description',
        'prompt',
        'system_prompt',
        'profile',
        'depends_on',
        'priority',
      ])
    );
    expect(Object.keys(tasksItemSchema?.properties ?? {})).not.toContain('timeout_ms');

    const single = await manager.executeTool(
      'task',
      {
        description: '并行探索项目各模块结构',
      },
      context
    );
    expect(single.success).toBe(true);

    const multi = await manager.executeTool(
      'tasks',
      {
        items: [
          { description: '探索模块A结构' },
          { description: '探索模块B结构', depends_on: ['item_1'] },
        ],
        wait: true,
      },
      {
        ...context,
        toolCallId: 'call-schema-batch',
      }
    );
    expect(multi.success).toBe(true);
  });

  it('uses long tool timeout for blocking task workflows', () => {
    const taskTool = new TaskV3Tool({ runtime });
    const tasksTool = new TaskV3TasksTool({ runtime });
    const taskUpdate = new TaskV3UpdateTool({ runtime });
    const runWait = new TaskV3RunWaitTool({ runtime });

    expect(taskTool.getTimeoutMs()).toBeGreaterThan(60_000);
    expect(tasksTool.getTimeoutMs()).toBeGreaterThan(60_000);
    expect(taskUpdate.getTimeoutMs()).toBeGreaterThan(60_000);
    expect(runWait.getTimeoutMs()).toBeGreaterThan(60_000);
  });

  it('runs single task via task tool and supports run inspection', async () => {
    const provider = createImmediateProvider('done');
    const context = createContext('single-task', provider);

    const taskTool = new TaskV3Tool({ runtime });
    const runGet = new TaskV3RunGetTool({ runtime });
    const runWait = new TaskV3RunWaitTool({ runtime });
    const runEvents = new TaskV3RunEventsTool({ runtime });

    const result = await taskTool.execute(
      {
        ...TASK_ARGS_DEFAULTS,
        title: 'Analyze bug',
        description: 'Find root cause',
        prompt: 'Inspect module and summarize issue',
        profile: 'bug-analyzer',
        wait: true,
        include_events: true,
      },
      context
    );

    expect(result.success).toBe(true);
    const payload = result.data as {
      task: { id: string; status: string };
      run: { id: string; status: string };
      event_count: number;
    };
    expect(payload.task.id).toMatch(/^tsk_/);
    expect(payload.task.status).toBe('completed');
    expect(payload.run.id).toMatch(/^run_/);
    expect(payload.run.status).toBe('succeeded');
    expect(payload.event_count).toBeGreaterThan(0);

    const fetched = await runGet.execute({ run_id: payload.run.id }, context);
    expect(fetched.success).toBe(true);

    const waited = await runWait.execute(
      { run_id: payload.run.id, timeout_ms: 30_000, poll_interval_ms: 300 },
      context
    );
    expect(waited.success).toBe(true);
    expect((waited.data as { status: string }).status).toBe('succeeded');

    const events = await runEvents.execute(
      { run_id: payload.run.id, after_seq: 0, limit: 20 },
      context
    );
    expect(events.success).toBe(true);
    expect((events.data as { count: number }).count).toBeGreaterThan(0);
  });

  it('accepts minimal task input with description only', async () => {
    const provider = createImmediateProvider('minimal-ok');
    const context = createContext('minimal-single', provider);
    const taskTool = new TaskV3Tool({ runtime });

    const result = await taskTool.execute(
      {
        description: '并行探索项目各模块结构',
      },
      context
    );

    expect(result.success).toBe(true);
    const data = result.data as {
      task: { title: string; description: string };
      run: { status: string };
    };
    expect(data.task.title.length).toBeGreaterThan(0);
    expect(data.task.description).toContain('并行探索项目各模块结构');
    expect(data.run.status).toBe('succeeded');
  });

  it('merges profile system prompt with task/system prompt override', async () => {
    const provider = createImmediateProvider('prompt-merge-ok');
    const context = createContext('merge-system-prompt', provider);
    const taskTool = new TaskV3Tool({ runtime });
    const runGet = new TaskV3RunGetTool({ runtime });

    const result = await taskTool.execute(
      {
        title: 'merge prompt',
        description: 'validate merged system prompt',
        prompt: 'execute and return',
        profile: 'general-purpose',
        system_prompt: 'You must output as compact JSON only.',
        wait: false,
      },
      context
    );

    expect(result.success).toBe(true);
    const runId = (result.data as { run: { id: string } }).run.id;

    const fetched = await runGet.execute({ run_id: runId }, context);
    expect(fetched.success).toBe(true);
    const agentConfig = (fetched.data as { agent_config_snapshot?: { systemPrompt?: string } })
      .agent_config_snapshot;
    const systemPrompt = agentConfig?.systemPrompt ?? '';
    expect(systemPrompt).toContain('pragmatic software engineering assistant');
    expect(systemPrompt).toContain('compact JSON only');
  });

  it('deduplicates repeated task calls by default and supports force_new', async () => {
    const provider = createImmediateProvider('dedupe');
    const context = createContext('dedupe-task', provider);
    const taskTool = new TaskV3Tool({ runtime });

    const first = await taskTool.execute(
      {
        ...TASK_ARGS_DEFAULTS,
        title: 'Same task',
        description: 'same desc',
        prompt: 'same prompt',
        profile: 'general-purpose',
        wait: false,
      },
      context
    );
    expect(first.success).toBe(true);

    const second = await taskTool.execute(
      {
        ...TASK_ARGS_DEFAULTS,
        title: 'Same task',
        description: 'same desc',
        prompt: 'same prompt',
        profile: 'general-purpose',
        wait: false,
      },
      context
    );
    expect(second.success).toBe(true);
    expect((second.data as { deduplicated: boolean }).deduplicated).toBe(true);

    const tasks = await runtime.service.listTasks('dedupe-task', { limit: 50 });
    const runs = await runtime.service.listRuns('dedupe-task', { limit: 50 });
    expect(tasks).toHaveLength(1);
    expect(runs).toHaveLength(1);

    const forced = await taskTool.execute(
      {
        ...TASK_ARGS_DEFAULTS,
        title: 'Same task',
        description: 'same desc',
        prompt: 'same prompt',
        profile: 'general-purpose',
        wait: false,
        force_new: true,
      },
      context
    );
    expect(forced.success).toBe(true);
    expect((forced.data as { deduplicated: boolean }).deduplicated).toBe(false);

    const tasksAfter = await runtime.service.listTasks('dedupe-task', { limit: 50 });
    const runsAfter = await runtime.service.listRuns('dedupe-task', { limit: 50 });
    expect(tasksAfter).toHaveLength(2);
    expect(runsAfter).toHaveLength(2);
  });

  it('orchestrates dependency-aware batch execution through tasks tool', async () => {
    const provider = createImmediateProvider('batch-ok');
    const context = createContext('batch-session', provider);
    const tasksTool = new TaskV3TasksTool({ runtime });

    const result = await tasksTool.execute(
      {
        ...TASKS_ARGS_DEFAULTS,
        items: [
          {
            key: 'a',
            title: 'Task A',
            description: 'first',
            prompt: 'do A',
            profile: 'general-purpose',
            priority: 'medium',
            depends_on: [],
          },
          {
            key: 'b',
            title: 'Task B',
            description: 'second',
            prompt: 'do B after A',
            profile: 'general-purpose',
            priority: 'medium',
            depends_on: ['a'],
          },
        ],
        max_parallel: 2,
        wait: true,
      },
      context
    );

    expect(result.success).toBe(true);
    const data = result.data as {
      total_tasks: number;
      terminal_tasks: number;
      wait_timeout_reached: boolean;
      items: Array<{ task: { status: string } | null; run: { status: string } | null }>;
    };

    expect(data.total_tasks).toBe(2);
    expect(data.terminal_tasks).toBe(2);
    expect(data.wait_timeout_reached).toBe(false);
    for (const item of data.items) {
      expect(item.task?.status).toBe('completed');
      expect(item.run?.status).toBe('succeeded');
    }
  });

  it('accepts minimal tasks items with description only and auto keys', async () => {
    const provider = createImmediateProvider('minimal-batch-ok');
    const context = createContext('minimal-batch', provider);
    const tasksTool = new TaskV3TasksTool({ runtime });

    const result = await tasksTool.execute(
      {
        items: [
          {
            description: '探索模块A结构',
          },
          {
            description: '探索模块B结构',
            depends_on: ['item_1'],
          },
        ],
        wait: true,
      },
      context
    );

    expect(result.success).toBe(true);
    const data = result.data as {
      total_tasks: number;
      terminal_tasks: number;
      items: Array<{ key: string }>;
    };
    expect(data.total_tasks).toBe(2);
    expect(data.terminal_tasks).toBe(2);
    expect(data.items[0].key).toBe('item_1');
    expect(data.items[1].key).toBe('item_2');
  });

  it('merges profile system prompt with per-item system_prompt in tasks', async () => {
    const provider = createImmediateProvider('batch-system-merge-ok');
    const context = createContext('merge-system-prompt-batch', provider);
    const tasksTool = new TaskV3TasksTool({ runtime });
    const runGet = new TaskV3RunGetTool({ runtime });

    const result = await tasksTool.execute(
      {
        items: [
          {
            key: 'itemA',
            description: 'collect structure',
            system_prompt: 'Always include section: Findings.',
          },
        ],
        wait: false,
      },
      context
    );

    expect(result.success).toBe(true);
    const runId = (
      (result.data as { items: Array<{ run: { id: string } | null }> }).items[0].run as {
        id: string;
      }
    ).id;
    const fetched = await runGet.execute({ run_id: runId }, context);
    expect(fetched.success).toBe(true);
    const agentConfig = (fetched.data as { agent_config_snapshot?: { systemPrompt?: string } })
      .agent_config_snapshot;
    const systemPrompt = agentConfig?.systemPrompt ?? '';
    expect(systemPrompt).toContain('pragmatic software engineering assistant');
    expect(systemPrompt).toContain('section: Findings');
  });

  it('supports fail_fast in tasks tool', async () => {
    const provider = createPromptAwareProvider();
    const context = createContext('batch-fail-fast', provider);
    const tasksTool = new TaskV3TasksTool({ runtime });

    const result = await tasksTool.execute(
      {
        ...TASKS_ARGS_DEFAULTS,
        items: [
          {
            key: 'x',
            title: 'Task X',
            description: 'will fail',
            prompt: '[FAIL] task',
            profile: 'general-purpose',
            priority: 'medium',
            depends_on: [],
          },
          {
            key: 'y',
            title: 'Task Y',
            description: 'depends on fail',
            prompt: 'should stop',
            profile: 'general-purpose',
            priority: 'medium',
            depends_on: ['x'],
          },
        ],
        max_parallel: 2,
        wait: true,
        fail_fast: true,
      },
      context
    );

    expect(result.success).toBe(true);
    expect((result.data as { terminated_by_fail_fast: boolean }).terminated_by_fail_fast).toBe(
      true
    );
  });

  it('supports task_update with restart', async () => {
    const provider = createImmediateProvider('v1');
    const context = createContext('update-restart', provider);
    const taskTool = new TaskV3Tool({ runtime });
    const taskUpdate = new TaskV3UpdateTool({ runtime });

    const created = await taskTool.execute(
      {
        ...TASK_ARGS_DEFAULTS,
        title: 'Restartable',
        description: 'base',
        prompt: 'first execution',
        profile: 'general-purpose',
        wait: true,
      },
      context
    );
    expect(created.success).toBe(true);

    const taskId = (created.data as { task: { id: string } }).task.id;
    const updated = await taskUpdate.execute(
      {
        task_id: taskId,
        description: 'new desc',
        restart: true,
        prompt: 'second execution',
        profile: 'general-purpose',
        wait: true,
        wait_timeout_ms: 30_000,
        poll_interval_ms: 300,
        include_events: false,
        events_after_seq: 0,
        events_limit: 200,
      },
      context
    );

    expect(updated.success).toBe(true);
    const data = updated.data as {
      restarted: boolean;
      task: { description: string };
      run: { status: string };
    };
    expect(data.restarted).toBe(true);
    expect(data.task.description).toBe('new desc');
    expect(data.run.status).toBe('succeeded');
  });

  it('supports cancellation and session-isolated reads', async () => {
    const provider = createBlockingProvider();
    const sessionA = createContext('cancel-a', provider);
    const sessionB = createContext('cancel-b', provider);

    const taskTool = new TaskV3Tool({ runtime });
    const runCancel = new TaskV3RunCancelTool({ runtime });
    const runWait = new TaskV3RunWaitTool({ runtime });
    const taskGet = new TaskV3GetTool({ runtime });

    const started = await taskTool.execute(
      {
        ...TASK_ARGS_DEFAULTS,
        title: 'Cancelable',
        description: 'cancel me',
        prompt: 'long running',
        profile: 'general-purpose',
        wait: false,
      },
      sessionA
    );
    expect(started.success).toBe(true);

    const taskId = (started.data as { task: { id: string } }).task.id;
    const runId = (started.data as { run: { id: string } }).run.id;

    const cancel = await runCancel.execute({ run_id: runId }, sessionA);
    expect(cancel.success).toBe(true);

    const final = await runWait.execute(
      {
        run_id: runId,
        timeout_ms: 15_000,
        poll_interval_ms: 50,
      },
      sessionA
    );
    expect(final.success).toBe(true);
    expect((final.data as { status: string }).status).toBe('cancelled');

    const crossSession = await taskGet.execute({ task_id: taskId }, sessionB);
    expect(crossSession.success).toBe(false);
    expect(crossSession.error).toContain('NOT_FOUND');
  });

  it('supports list, clear session and gc runs', async () => {
    const provider = createImmediateProvider('maintain');
    const context = createContext('maintenance', provider);

    const taskTool = new TaskV3Tool({ runtime });
    const taskList = new TaskV3ListTool({ runtime });
    const clear = new TaskV3ClearSessionTool({ runtime });
    const gc = new TaskV3GcRunsTool({ runtime });

    const submitted = await taskTool.execute(
      {
        ...TASK_ARGS_DEFAULTS,
        title: 'maintenance task',
        description: 'for list',
        prompt: 'run once',
        profile: 'general-purpose',
        wait: true,
      },
      context
    );
    expect(submitted.success).toBe(true);

    const listed = await taskList.execute({ limit: 20 }, context);
    expect(listed.success).toBe(true);
    expect((listed.data as { count: number }).count).toBeGreaterThan(0);

    const gcResult = await gc.execute({ older_than_hours: 1, limit: 50 }, context);
    expect(gcResult.success).toBe(true);

    const cleared = await clear.execute({}, context);
    expect(cleared.success).toBe(true);

    const listedAfter = await taskList.execute({ limit: 20 }, context);
    expect(listedAfter.success).toBe(true);
    expect((listedAfter.data as { count: number }).count).toBe(0);
  });
});

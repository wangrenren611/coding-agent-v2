import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fsp } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { Chunk, LLMProvider, LLMRequestMessage } from '../../providers';
import { ToolManager } from '../manager';
import type { ToolExecutionContext, ToolStreamEventInput } from '../types';
import {
  TaskTool,
  TaskCreateTool,
  TaskGetTool,
  TaskListTool,
  TaskUpdateTool,
  TaskStopTool,
  TaskOutputTool,
} from '../task-tools';
import { TaskRuntime } from '../task/runtime';

interface TaskCreateData {
  id: string;
  subject: string;
  status: string;
}

interface TaskListData {
  count: number;
  tasks: Array<{
    id: string;
    subject: string;
    status: string;
    blockedBy: string[];
  }>;
}

interface TaskOutputData {
  task_id: string;
  status: string;
  timed_out?: boolean;
}

function createContext(sessionId: string, events?: ToolStreamEventInput[]): ToolExecutionContext {
  return {
    toolCallId: `call-${sessionId}`,
    loopIndex: 0,
    stepIndex: 0,
    agent: {
      getSessionId: () => sessionId,
    } as ToolExecutionContext['agent'],
    agentContext: {
      sessionId,
      loopIndex: 0,
      stepIndex: 0,
    },
    emitToolEvent: events
      ? (event) => {
          events.push(event);
        }
      : undefined,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createImmediateProvider(text: string): LLMProvider {
  return {
    config: { model: 'test-model' },
    generate: async () => {
      throw new Error('Not implemented in tests');
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

function createSlowProvider(): LLMProvider {
  return {
    config: { model: 'test-model' },
    generate: async () => {
      throw new Error('Not implemented in tests');
    },
    async *generateStream(_messages: LLMRequestMessage[]) {
      for (let i = 0; i < 40; i += 1) {
        await sleep(50);
        const chunk: Chunk = {
          index: i,
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: `tick-${i}` },
              finish_reason: null,
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        };
        yield chunk;
      }

      yield {
        index: 41,
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', content: 'finished' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      } as Chunk;
    },
    getTimeTimeout: () => 60000,
    getLLMMaxTokens: () => 128000,
    getMaxOutputTokens: () => 8000,
  } as unknown as LLMProvider;
}

function createAbortAwareBlockingProvider(): LLMProvider {
  return {
    config: { model: 'test-model' },
    generate: async () => {
      throw new Error('Not implemented in tests');
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

describe('Task tools', () => {
  let dataDir: string;
  let runtime: TaskRuntime;

  beforeEach(async () => {
    dataDir = await fsp.mkdtemp(path.join(tmpdir(), 'task-tool-'));
    runtime = new TaskRuntime({ dataDir, cleanupTtlMs: 100 });
  });

  afterEach(async () => {
    await runtime.clearState();
    await fsp.rm(dataDir, { recursive: true, force: true });
  });

  it('supports managed task create/list/get/update workflow', async () => {
    const context = createContext('s-managed');
    const createTool = new TaskCreateTool({ runtime });
    const getTool = new TaskGetTool({ runtime });
    const listTool = new TaskListTool({ runtime });
    const updateTool = new TaskUpdateTool({ runtime });

    const create1 = await createTool.execute(
      {
        subject: 'Setup project',
        description: 'Initialize project config',
        activeForm: 'Setting up project',
      },
      context
    );
    const create2 = await createTool.execute(
      {
        subject: 'Add tests',
        description: 'Cover task tools',
        activeForm: 'Adding tests',
      },
      context
    );

    expect(create1.success).toBe(true);
    expect(create2.success).toBe(true);
    expect((create1.data as TaskCreateData).id).toBe('1');
    expect((create2.data as TaskCreateData).id).toBe('2');

    const addDependency = await updateTool.execute(
      {
        taskId: '2',
        addBlockedBy: ['1'],
      },
      context
    );
    expect(addDependency.success).toBe(true);

    const listBefore = await listTool.execute({}, context);
    expect(listBefore.success).toBe(true);
    const listBeforeData = listBefore.data as TaskListData;
    expect(listBeforeData.count).toBe(2);
    expect(listBeforeData.tasks.find((task) => task.id === '2')?.blockedBy).toEqual(['1']);

    const completeTask1 = await updateTool.execute(
      {
        taskId: '1',
        status: 'in_progress',
      },
      context
    );
    expect(completeTask1.success).toBe(true);
    const completeTask1Done = await updateTool.execute(
      {
        taskId: '1',
        status: 'completed',
      },
      context
    );
    expect(completeTask1Done.success).toBe(true);

    const listAfter = await listTool.execute({}, context);
    const listAfterData = listAfter.data as TaskListData;
    expect(listAfterData.tasks.find((task) => task.id === '2')?.blockedBy).toEqual([]);

    const getTask2 = await getTool.execute({ taskId: '2' }, context);
    expect(getTask2.success).toBe(true);
    expect((getTask2.data as { blockedBy: string[] }).blockedBy).toContain('1');
  });

  it('rejects invalid status transition and invalid dependency', async () => {
    const context = createContext('s-validation');
    const createTool = new TaskCreateTool({ runtime });
    const updateTool = new TaskUpdateTool({ runtime });

    await createTool.execute(
      {
        subject: 'One',
        description: 'Task one',
        activeForm: 'Doing one',
      },
      context
    );

    const invalidTransition = await updateTool.execute(
      {
        taskId: '1',
        status: 'completed',
      },
      context
    );
    expect(invalidTransition.success).toBe(false);
    expect(String(invalidTransition.error)).toContain('INVALID_STATUS_TRANSITION');

    const invalidDependency = await updateTool.execute(
      {
        taskId: '1',
        addBlockedBy: ['999'],
      },
      context
    );
    expect(invalidDependency.success).toBe(false);
    expect(String(invalidDependency.error)).toContain('INVALID_DEPENDENCY');
  });

  it('can run foreground delegated task and fetch task_output', async () => {
    const events: ToolStreamEventInput[] = [];
    const context = createContext('s-foreground', events);
    const taskTool = new TaskTool({
      runtime,
      provider: createImmediateProvider('foreground done'),
      createSubagentToolManager: () => new ToolManager(),
    });
    const outputTool = new TaskOutputTool({ runtime });

    const runResult = await taskTool.execute(
      {
        description: 'quick foreground run',
        prompt: 'Say done',
        subagent_type: 'general-purpose',
        run_in_background: false,
      },
      context
    );

    expect(runResult.success).toBe(true);
    const taskId = (runResult.data as { task_id: string }).task_id;
    expect(taskId).toMatch(/^task_/);

    const output = await outputTool.execute(
      {
        task_id: taskId,
        block: false,
        timeout: 1000,
      },
      context
    );
    expect(output.success).toBe(true);
    const outputData = output.data as TaskOutputData;
    expect(outputData.status).toBe('completed');
    expect(events.some((event) => event.type === 'stdout')).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === 'info' &&
          typeof event.content === 'string' &&
          event.content.includes('SUBAGENT_')
      )
    ).toBe(true);
  });

  it('supports background run, polling output, and stop cancellation', async () => {
    const context = createContext('s-background');
    const taskTool = new TaskTool({
      runtime,
      provider: createSlowProvider(),
      createSubagentToolManager: () => new ToolManager(),
    });
    const outputTool = new TaskOutputTool({ runtime });
    const stopTool = new TaskStopTool({ runtime });

    const runResult = await taskTool.execute(
      {
        description: 'slow run',
        prompt: 'Run for a while',
        subagent_type: 'explore',
        run_in_background: true,
      },
      context
    );
    expect(runResult.success).toBe(true);
    const taskId = (runResult.data as { task_id: string }).task_id;

    const pollOutput = await outputTool.execute(
      {
        task_id: taskId,
        block: false,
        timeout: 1000,
      },
      context
    );
    expect(pollOutput.success).toBe(true);
    expect(['queued', 'running', 'cancelling']).toContain(
      (pollOutput.data as TaskOutputData).status
    );

    const stop = await stopTool.execute({ task_id: taskId }, context);
    expect(stop.success).toBe(true);

    const finalOutput = await outputTool.execute(
      {
        task_id: taskId,
        block: true,
        timeout: 3000,
      },
      context
    );
    expect(finalOutput.success).toBe(true);
    expect(['cancelled', 'completed']).toContain((finalOutput.data as TaskOutputData).status);
  });

  it('cancels foreground delegated task when tool abort signal is triggered', async () => {
    const controller = new AbortController();
    const baseContext = createContext('s-foreground-abort');
    const context: ToolExecutionContext = {
      ...baseContext,
      toolAbortSignal: controller.signal,
    };
    const taskTool = new TaskTool({
      runtime,
      provider: createAbortAwareBlockingProvider(),
      createSubagentToolManager: () => new ToolManager(),
    });

    const runPromise = taskTool.execute(
      {
        description: 'slow foreground run',
        prompt: 'Run for a while',
        subagent_type: 'explore',
        run_in_background: false,
      },
      context
    );

    setTimeout(() => controller.abort(), 120);
    const runResult = await runPromise;
    expect(runResult.success).toBe(false);
    expect(String(runResult.error)).toContain('TASK_CANCELLED');
  });

  it('returns actionable hint when task_output id is not found', async () => {
    const context = createContext('s-not-found');
    const createTool = new TaskCreateTool({ runtime });
    const outputTool = new TaskOutputTool({ runtime });

    await createTool.execute(
      {
        subject: 'Only managed task',
        description: 'Managed task list item',
        activeForm: 'Working',
      },
      context
    );

    const result = await outputTool.execute(
      {
        task_id: '1',
        block: false,
        timeout: 1000,
      },
      context
    );
    expect(result.success).toBe(false);
    expect(String(result.error)).toContain('TASK_NOT_FOUND');
    expect((result.data as { likely_managed_task_id: boolean }).likely_managed_task_id).toBe(true);
  });
});

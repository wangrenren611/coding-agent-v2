import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskTool } from '../task';
import { TaskStore } from '../task-store';
import type { SubagentRunnerAdapter } from '../task-runner-adapter';
import type { AgentRunEntity } from '../task-types';

function parseOutput<T>(output: string | undefined): T {
  return JSON.parse(output || '{}') as T;
}

function makeRun(agentId: string): AgentRunEntity {
  const now = Date.now();
  return {
    agentId,
    status: 'running',
    subagentType: 'Plan',
    prompt: 'p',
    createdAt: now,
    startedAt: now,
    updatedAt: now,
    metadata: {},
    version: 1,
  };
}

describe('task subagent config integration', () => {
  let baseDir: string;
  let store: TaskStore;

  beforeEach(async () => {
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'renx-task-subagent-config-'));
    store = new TaskStore({ baseDir });
  });

  afterEach(async () => {
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it('injects default tools and systemPrompt from subagent config', async () => {
    const captured: Array<{ allowedTools?: string[]; systemPrompt?: string }> = [];
    const runner: SubagentRunnerAdapter = {
      start: async (_ns, input) => {
        captured.push({
          allowedTools: input.allowedTools,
          systemPrompt: input.systemPrompt,
        });
        return makeRun('agent-default-config');
      },
      poll: async () => null,
      cancel: async () => null,
    };

    const tool = new TaskTool({ store, runner });
    const result = await tool.execute({
      namespace: 'ns1',
      subagent_type: 'Plan',
      prompt: 'build plan',
      run_in_background: true,
    });
    expect(result.success).toBe(true);
    const firstCapture = captured[0];
    if (!firstCapture) {
      throw new Error('expected captured task config');
    }
    expect(firstCapture.allowedTools).toContain('glob');
    expect(firstCapture.allowedTools).toContain('grep');
    expect(firstCapture.allowedTools).toContain('file_read');
    expect(firstCapture.systemPrompt).toContain('planning specialist');
  });

  it('filters requested allowed_tools through config whitelist', async () => {
    const captured: Array<{ allowedTools?: string[]; systemPrompt?: string }> = [];
    const runner: SubagentRunnerAdapter = {
      start: async (_ns, input) => {
        captured.push({
          allowedTools: input.allowedTools,
          systemPrompt: input.systemPrompt,
        });
        return makeRun('agent-filtered-config');
      },
      poll: async () => null,
      cancel: async () => null,
    };

    const tool = new TaskTool({ store, runner });
    const result = await tool.execute({
      namespace: 'ns2',
      subagent_type: 'Plan',
      prompt: 'plan with narrowed tools',
      run_in_background: true,
      allowed_tools: ['glob', 'bash', 'write_file'],
    });
    expect(result.success).toBe(true);
    const firstCapture = captured[0];
    if (!firstCapture) {
      throw new Error('expected captured task config');
    }
    expect(firstCapture.allowedTools).toEqual(['glob']);

    const payload = parseOutput<{ agent_run: { agentId: string } }>(result.output);
    expect(payload.agent_run.agentId).toBe('agent-filtered-config');
  });

  it('injects find-skills defaults (skill + bash) and skill-discovery prompt', async () => {
    const captured: Array<{ allowedTools?: string[]; systemPrompt?: string }> = [];
    const runner: SubagentRunnerAdapter = {
      start: async (_ns, input) => {
        captured.push({
          allowedTools: input.allowedTools,
          systemPrompt: input.systemPrompt,
        });
        return makeRun('agent-find-skills-config');
      },
      poll: async () => null,
      cancel: async () => null,
    };

    const tool = new TaskTool({ store, runner });
    const result = await tool.execute({
      namespace: 'ns3',
      subagent_type: 'find-skills',
      prompt: 'find and install skill for code review',
      run_in_background: true,
    });

    expect(result.success).toBe(true);
    const firstCapture = captured[0];
    if (!firstCapture) {
      throw new Error('expected captured task config');
    }
    expect(firstCapture.allowedTools).toEqual(['skill', 'bash']);
    expect(firstCapture.systemPrompt).toContain('Skill Discovery and Installation Specialist');
    expect(firstCapture.systemPrompt).toContain('Check local skills first');
    expect(firstCapture.systemPrompt).toContain('load the **`find-skills`** skill');
  });

  it('injects Restore defaults and absolute-path rollback prompt', async () => {
    const captured: Array<{ allowedTools?: string[]; systemPrompt?: string }> = [];
    const runner: SubagentRunnerAdapter = {
      start: async (_ns, input) => {
        captured.push({
          allowedTools: input.allowedTools,
          systemPrompt: input.systemPrompt,
        });
        return makeRun('agent-restore-config');
      },
      poll: async () => null,
      cancel: async () => null,
    };

    const tool = new TaskTool({ store, runner });
    const result = await tool.execute({
      namespace: 'ns4',
      subagent_type: 'Restore',
      prompt: 'restore D:\\work\\coding-agent-v2\\src\\renx\\tool\\write-file.ts',
      run_in_background: true,
    });

    expect(result.success).toBe(true);
    const firstCapture = captured[0];
    if (!firstCapture) {
      throw new Error('expected captured task config');
    }
    expect(firstCapture.allowedTools).toEqual([
      'glob',
      'file_read',
      'file_history_list',
      'file_history_restore',
    ]);
    expect(firstCapture.systemPrompt).toContain('absolute file paths');
    expect(firstCapture.systemPrompt).toContain('Do not use file_edit or write_file');
  });
});

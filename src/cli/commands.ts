import path from 'node:path';
import { promises as fs } from 'node:fs';
import { getSkillLoader, initializeSkillLoader } from '../tool/skill';
import { loadCliConfig, saveCliConfig } from './config-store';
import { printHelp } from './args';
import { getWorkspaceFilePath, loadWorkspaces, saveWorkspaces } from './workspace-store';
import { BUILTIN_TOOL_NAMES, DEFAULT_MODEL } from './constants';
import type { PersistedCliConfig } from './types';
import { CliRuntime } from './runtime';

function formatTimestamp(ts: number): string {
  return new Date(ts).toISOString();
}

function printKeyValue(payload: Record<string, string>): void {
  const max = Math.max(...Object.keys(payload).map((key) => key.length));
  for (const [key, value] of Object.entries(payload)) {
    console.log(`${key.padEnd(max)} : ${value}`);
  }
}

function ensurePrompt(parts: string[]): string {
  const prompt = parts.join(' ').trim();
  if (!prompt) {
    throw new Error('Prompt is required');
  }
  return prompt;
}

async function commandConfig(
  args: string[],
  baseCwd: string,
  config: PersistedCliConfig,
  runtime: CliRuntime
): Promise<void> {
  const action = args[0] ?? 'show';
  if (action === 'show') {
    const runtimeSummary = runtime.getRuntimeSummary();
    printKeyValue({
      configPath: path.join(baseCwd, '.agent-cli', 'config.json'),
      defaultModel: config.defaultModel ?? '(unset)',
      defaultApprovalMode: config.defaultApprovalMode ?? '(unset)',
      defaultSystemPrompt: config.defaultSystemPrompt ?? '(unset)',
      defaultCwd: config.defaultCwd ?? '(unset)',
      disabledTools: config.disabledTools.length > 0 ? config.disabledTools.join(', ') : '(none)',
      runtimeModel: runtimeSummary.model,
      runtimeCwd: runtimeSummary.cwd,
      runtimeSession: runtimeSummary.sessionId,
    });
    return;
  }

  if (action === 'set') {
    const key = args[1];
    const value = args.slice(2).join(' ').trim();
    if (!key || !value) {
      throw new Error('Usage: config set <key> <value>');
    }

    if (key === 'model') {
      config.defaultModel = value as typeof DEFAULT_MODEL;
    } else if (key === 'approvalMode') {
      if (value !== 'default' && value !== 'autoEdit' && value !== 'yolo') {
        throw new Error(`Invalid approval mode: ${value}`);
      }
      config.defaultApprovalMode = value;
    } else if (key === 'systemPrompt') {
      config.defaultSystemPrompt = value;
    } else if (key === 'cwd') {
      config.defaultCwd = path.resolve(baseCwd, value);
    } else if (key === 'disabledTools') {
      config.disabledTools = value
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
    } else {
      throw new Error(`Unsupported config key: ${key}`);
    }

    await saveCliConfig(baseCwd, config);
    console.log('Config updated');
    return;
  }

  if (action === 'unset') {
    const key = args[1];
    if (!key) {
      throw new Error('Usage: config unset <key>');
    }

    if (key === 'model') {
      delete config.defaultModel;
    } else if (key === 'approvalMode') {
      delete config.defaultApprovalMode;
    } else if (key === 'systemPrompt') {
      delete config.defaultSystemPrompt;
    } else if (key === 'cwd') {
      delete config.defaultCwd;
    } else if (key === 'disabledTools') {
      config.disabledTools = [];
    } else {
      throw new Error(`Unsupported config key: ${key}`);
    }

    await saveCliConfig(baseCwd, config);
    console.log('Config updated');
    return;
  }

  throw new Error(`Unknown config action: ${action}`);
}

function commandModel(args: string[], runtime: CliRuntime): void {
  const action = args[0] ?? 'show';
  if (action === 'show') {
    console.log(runtime.state.modelId);
    return;
  }
  if (action === 'list') {
    const rows = runtime.getModelIds().map((id) => ({ id }));
    console.table(rows);
    return;
  }
  if (action === 'set') {
    const model = args[1];
    if (!model) {
      throw new Error('Usage: model set <model-id>');
    }
    runtime.setModel(model);
    console.log(`Model switched to ${runtime.state.modelId}`);
    return;
  }

  throw new Error(`Unknown model action: ${action}`);
}

function commandTool(args: string[], runtime: CliRuntime): void {
  const action = args[0] ?? 'list';
  if (action === 'list') {
    const rows = BUILTIN_TOOL_NAMES.map((name) => ({
      name,
      enabled: runtime.getEnabledToolNames().includes(name),
    }));
    console.table(rows);
    return;
  }

  if (action === 'enable' || action === 'disable') {
    const toolName = args[1];
    if (!toolName) {
      throw new Error(`Usage: tool ${action} <tool-name>`);
    }
    runtime.setToolEnabled(toolName, action === 'enable');
    console.log(`Tool ${toolName} ${action}d`);
    return;
  }

  throw new Error(`Unknown tool action: ${action}`);
}

function commandTask(args: string[], runtime: CliRuntime): void {
  const action = args[0] ?? 'help';

  if (action === 'help' || action === 'flow') {
    console.log(`Task V3 CLI Usage

Single-task flow (recommended):
  1) Use task with required fields:
     prompt + profile + title + description
  2) wait=true for blocking completion (default), wait=false for async orchestration
  3) Inspect run with task_run_get / task_run_wait / task_run_events

Dependency + parallel flow:
  1) Use tasks with items[] and depends_on
  2) Set max_parallel for concurrency
  3) Use wait=true to run orchestration rounds until completion

Profiles (examples):
  general-purpose, explore, plan, bug-analyzer, code-reviewer

Run "coding-agent task tools" to see task tool enablement.
Run "coding-agent task examples" for ready-to-use prompt templates.`);
    return;
  }

  if (action === 'tools') {
    const groups: Array<{ group: string; tools: string[] }> = [
      {
        group: 'Task workflow',
        tools: ['task', 'tasks'],
      },
      {
        group: 'Task lifecycle',
        tools: ['task_get', 'task_list', 'task_update'],
      },
      {
        group: 'Run control',
        tools: ['task_run_get', 'task_run_wait', 'task_run_cancel', 'task_run_events'],
      },
      {
        group: 'Maintenance',
        tools: ['task_clear_session', 'task_gc_runs'],
      },
    ];
    const enabled = new Set(runtime.getEnabledToolNames());
    const rows = groups.flatMap((group) =>
      group.tools.map((name) => ({
        group: group.group,
        name,
        enabled: enabled.has(name),
      }))
    );
    console.table(rows);
    return;
  }

  if (action === 'examples') {
    console.log(`Task Prompt Examples

1) Single delegated bug task:
请使用 task 创建并执行任务：
- title: "修复登录接口 500 错误"
- description: "先定位根因，再给最小修复方案"
- prompt: "检查认证链路，定位 500 根因，并给出最小可回滚修复"
- profile: "bug-analyzer"
- include_events: true

2) Parallel dependency batch:
请使用 tasks：
- items: A/B/C（C.depends_on=["A","B"]）
- max_parallel: 2
- wait: true
- 汇总每个 run 的状态与关键事件`);
    return;
  }

  throw new Error(`Unknown task action: ${action}`);
}

async function commandSession(args: string[], runtime: CliRuntime): Promise<void> {
  const action = args[0] ?? 'list';
  if (action === 'list') {
    const sessions = runtime.listSessions(50).map((item) => ({
      sessionId: item.sessionId,
      status: item.status,
      totalMessages: item.totalMessages,
      updatedAt: formatTimestamp(item.updatedAt),
    }));
    console.table(sessions);
    return;
  }

  if (action === 'show') {
    const id = args[1] ?? runtime.state.sessionId;
    const history = runtime.getSessionHistory(id);
    const session = runtime.listSessions(100).find((item) => item.sessionId === id);
    if (!session) {
      throw new Error(`Session not found: ${id}`);
    }
    printKeyValue({
      sessionId: session.sessionId,
      status: session.status,
      createdAt: formatTimestamp(session.createdAt),
      updatedAt: formatTimestamp(session.updatedAt),
      totalMessages: String(session.totalMessages),
    });
    console.log('--- latest history ---');
    for (const message of history.slice(-10)) {
      const content =
        typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
      console.log(`[${message.sequence}] ${message.role}: ${content}`);
    }
    return;
  }

  if (action === 'clear') {
    const id = args[1] ?? runtime.state.sessionId;
    await runtime.clearSessionContext(id);
    console.log(`Cleared session context: ${id}`);
    return;
  }

  throw new Error(`Unknown session action: ${action}`);
}

function commandLog(args: string[], runtime: CliRuntime): void {
  const sessionId = args[0] ?? runtime.state.sessionId;
  const history = runtime.getSessionHistory(sessionId);
  if (history.length === 0) {
    console.log(`No history for session ${sessionId}`);
    return;
  }

  for (const message of history) {
    const content =
      typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
    console.log(`[${message.sequence}] ${message.role}: ${content}`);
  }
}

async function commandWorkspace(
  args: string[],
  baseCwd: string,
  config: PersistedCliConfig,
  runtime: CliRuntime
): Promise<void> {
  const action = args[0] ?? 'list';
  const entries = await loadWorkspaces(baseCwd);

  if (action === 'list') {
    if (entries.length === 0) {
      console.log(`No workspace profiles. File: ${getWorkspaceFilePath(baseCwd)}`);
      return;
    }
    console.table(entries);
    return;
  }

  if (action === 'add') {
    const name = args[1];
    const cwd = path.resolve(args[2] ?? runtime.state.cwd);
    if (!name) {
      throw new Error('Usage: workspace add <name> [cwd]');
    }
    const now = new Date().toISOString();
    const existing = entries.find((item) => item.name === name);
    if (existing) {
      existing.cwd = cwd;
      existing.updatedAt = now;
    } else {
      entries.push({
        name,
        cwd,
        createdAt: now,
        updatedAt: now,
      });
    }
    await saveWorkspaces(baseCwd, entries);
    console.log(`Workspace profile saved: ${name} -> ${cwd}`);
    return;
  }

  if (action === 'remove') {
    const name = args[1];
    if (!name) {
      throw new Error('Usage: workspace remove <name>');
    }
    const next = entries.filter((item) => item.name !== name);
    await saveWorkspaces(baseCwd, next);
    console.log(`Workspace profile removed: ${name}`);
    return;
  }

  if (action === 'use') {
    const name = args[1];
    if (!name) {
      throw new Error('Usage: workspace use <name>');
    }
    const selected = entries.find((item) => item.name === name);
    if (!selected) {
      throw new Error(`Workspace profile not found: ${name}`);
    }
    config.defaultCwd = selected.cwd;
    await saveCliConfig(baseCwd, config);
    await runtime.setCwd(selected.cwd);
    console.log(`Active workspace switched to ${selected.cwd}`);
    return;
  }

  throw new Error(`Unknown workspace action: ${action}`);
}

async function commandSkill(args: string[]): Promise<void> {
  const action = args[0] ?? 'list';
  await initializeSkillLoader();
  const loader = getSkillLoader();

  if (action === 'list') {
    const rows = loader.getAllMetadata().map((item) => ({
      name: item.name,
      description: item.description,
      path: item.path,
    }));
    console.table(rows);
    return;
  }

  if (action === 'show') {
    const name = args[1];
    if (!name) {
      throw new Error('Usage: skill show <name>');
    }
    const skill = await loader.loadSkill(name);
    if (!skill) {
      throw new Error(`Skill not found: ${name}`);
    }
    console.log(`# ${skill.metadata.name}`);
    console.log(skill.content);
    return;
  }

  throw new Error(`Unknown skill action: ${action}`);
}

async function commandRun(args: string[], runtime: CliRuntime): Promise<void> {
  const prompt = ensurePrompt(args);
  const { createQuietRenderer } = await import('./output');
  const renderer = createQuietRenderer(runtime.state.outputFormat);
  await runtime.runPrompt(prompt, renderer);
}

export async function runCommand(
  command: string,
  args: string[],
  runtime: CliRuntime,
  baseCwd: string,
  config: PersistedCliConfig,
  binName: string
): Promise<boolean> {
  if (command === 'help') {
    printHelp(binName);
    return true;
  }

  if (command === 'run') {
    await commandRun(args, runtime);
    return true;
  }

  if (command === 'config') {
    await commandConfig(args, baseCwd, config, runtime);
    return true;
  }

  if (command === 'model') {
    commandModel(args, runtime);
    return true;
  }

  if (command === 'tool') {
    commandTool(args, runtime);
    config.disabledTools = Array.from(runtime.state.disabledTools).sort();
    await saveCliConfig(baseCwd, config);
    return true;
  }

  if (command === 'task') {
    commandTask(args, runtime);
    return true;
  }

  if (command === 'session') {
    await commandSession(args, runtime);
    return true;
  }

  if (command === 'log') {
    commandLog(args, runtime);
    return true;
  }

  if (command === 'workspace') {
    await commandWorkspace(args, baseCwd, config, runtime);
    return true;
  }

  if (command === 'skill') {
    await commandSkill(args);
    return true;
  }

  return false;
}

export async function ensureBaseDirectory(baseCwd: string): Promise<void> {
  await fs.mkdir(path.join(baseCwd, '.agent-cli'), { recursive: true });
}

export async function loadConfigWithDefaults(baseCwd: string): Promise<PersistedCliConfig> {
  const config = await loadCliConfig(baseCwd);
  if (!Array.isArray(config.disabledTools)) {
    config.disabledTools = [];
  }
  return config;
}

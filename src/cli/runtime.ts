import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Agent, type AgentResult } from '../agent';
import {
  createLoggerFromRuntimeConfig,
  createMemoryManagerFromRuntimeConfig,
  loadEnvFiles,
  loadRuntimeConfigFromEnv,
} from '../config';
import type { ModelId } from '../providers';
import { ProviderRegistry } from '../providers';
import type { HistoryMessage } from '../storage';
import {
  BashTool,
  FileTool,
  GlobTool,
  GrepTool,
  SkillTool,
  TaskCreateTool,
  TaskGetTool,
  TaskListTool,
  TaskOutputTool,
  TaskStopTool,
  TaskTool,
  TaskUpdateTool,
  ToolManager,
} from '../tool';
import type { ToolConfirmDecision, ToolConfirmRequest } from '../tool';
import {
  BUILTIN_TOOL_NAMES,
  DEFAULT_APPROVAL_MODE,
  DEFAULT_MODEL,
  DEFAULT_OUTPUT_FORMAT,
  DEFAULT_SYSTEM_PROMPT,
} from './constants';
import type {
  CliRuntimeDeps,
  CliRuntimeState,
  CliSessionInfo,
  OutputFormat,
  RunRenderer,
  ToolConfirmHandler,
  ToolConfirmIO,
} from './types';

const DEFAULT_MAX_STEPS = 10000;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function assertModelId(model: string): ModelId {
  const ids = ProviderRegistry.getModelIds();
  if (!ids.includes(model as ModelId)) {
    throw new Error(`Unknown model id: ${model}`);
  }
  return model as ModelId;
}

function normalizeToolName(name: string): string {
  return name.trim().toLowerCase();
}

function nowIso(): string {
  return new Date().toISOString();
}

export class CliRuntime {
  readonly baseCwd: string;
  readonly state: CliRuntimeState;
  deps?: CliRuntimeDeps;

  constructor(options: {
    baseCwd: string;
    cwd: string;
    modelId?: string;
    sessionId?: string;
    systemPrompt?: string;
    outputFormat?: OutputFormat;
    approvalMode?: CliRuntimeState['approvalMode'];
    disabledTools?: Iterable<string>;
    quiet: boolean;
  }) {
    const modelId = options.modelId ? assertModelId(options.modelId) : DEFAULT_MODEL;
    const normalizedCwd = path.resolve(options.cwd);
    this.baseCwd = path.resolve(options.baseCwd);
    this.state = {
      cwd: normalizedCwd,
      modelId,
      sessionId: options.sessionId ?? randomUUID(),
      outputFormat: options.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
      approvalMode: options.approvalMode ?? DEFAULT_APPROVAL_MODE,
      systemPrompt: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      disabledTools: new Set(Array.from(options.disabledTools ?? []).map(normalizeToolName)),
      quiet: options.quiet,
    };
  }

  async initialize(): Promise<void> {
    await loadEnvFiles(this.state.cwd);
    const runtimeConfig = loadRuntimeConfigFromEnv(process.env, this.state.cwd);
    const memoryManager = createMemoryManagerFromRuntimeConfig(runtimeConfig);
    await memoryManager.initialize();
    const logger = createLoggerFromRuntimeConfig(runtimeConfig);

    this.deps = {
      logger,
      memoryManager,
      runtimeConfig,
    };
  }

  async close(): Promise<void> {
    if (!this.deps) {
      return;
    }
    await this.deps.memoryManager.close();
    const logger = this.deps.logger as { close?: () => void };
    if (typeof logger.close === 'function') {
      logger.close();
    }
    this.deps = undefined;
  }

  assertInitialized(): CliRuntimeDeps {
    if (!this.deps) {
      throw new Error('CLI runtime is not initialized');
    }
    return this.deps;
  }

  getModelIds(): ModelId[] {
    return ProviderRegistry.getModelIds();
  }

  setModel(modelId: string): void {
    this.state.modelId = assertModelId(modelId);
  }

  async setCwd(nextCwd: string): Promise<void> {
    const resolved = path.resolve(nextCwd);
    if (resolved === this.state.cwd) {
      return;
    }
    await this.close();
    this.state.cwd = resolved;
    await this.initialize();
  }

  setSession(sessionId: string): void {
    const value = sessionId.trim();
    if (!value) {
      throw new Error('session id cannot be empty');
    }
    this.state.sessionId = value;
  }

  newSession(sessionId?: string): string {
    const next = sessionId && sessionId.trim().length > 0 ? sessionId.trim() : randomUUID();
    this.state.sessionId = next;
    return next;
  }

  setApprovalMode(mode: CliRuntimeState['approvalMode']): void {
    this.state.approvalMode = mode;
  }

  setOutputFormat(format: OutputFormat): void {
    this.state.outputFormat = format;
  }

  setSystemPrompt(systemPrompt: string): void {
    this.state.systemPrompt = systemPrompt;
  }

  appendSystemPrompt(extra: string): void {
    if (!extra.trim()) {
      return;
    }
    this.state.systemPrompt = `${this.state.systemPrompt}\n${extra}`;
  }

  setToolEnabled(toolName: string, enabled: boolean): void {
    const normalized = normalizeToolName(toolName);
    if (!normalized) {
      return;
    }
    if (enabled) {
      this.state.disabledTools.delete(normalized);
    } else {
      this.state.disabledTools.add(normalized);
    }
  }

  getEnabledToolNames(): string[] {
    return BUILTIN_TOOL_NAMES.filter((name) => !this.state.disabledTools.has(name));
  }

  createToolManager(): ToolManager {
    const manager = new ToolManager();
    const tools = [
      new BashTool(),
      new FileTool({ allowedDirectories: [this.state.cwd] }),
      new GlobTool(),
      new GrepTool(),
      new SkillTool(),
      new TaskTool({ workingDirectory: this.state.cwd }),
      new TaskCreateTool(),
      new TaskGetTool(),
      new TaskListTool(),
      new TaskUpdateTool(),
      new TaskStopTool(),
      new TaskOutputTool(),
    ];

    for (const tool of tools) {
      if (!this.state.disabledTools.has(normalizeToolName(tool.meta.name))) {
        manager.register(tool);
      }
    }

    return manager;
  }

  private createProvider() {
    const deps = this.assertInitialized();
    return ProviderRegistry.createFromEnv(this.state.modelId, {
      logger: deps.logger.child('Provider'),
    });
  }

  private autoEditDecision(request: ToolConfirmRequest): ToolConfirmDecision {
    const autoApprove = new Set([
      'file',
      'glob',
      'grep',
      'skill',
      'task_get',
      'task_list',
      'task_output',
    ]);
    return autoApprove.has(request.toolName) ? 'approve' : 'deny';
  }

  private async askForApproval(
    request: ToolConfirmRequest,
    io?: ToolConfirmIO
  ): Promise<ToolConfirmDecision> {
    const prompt =
      `
Approve tool "${request.toolName}"? [y/N]
` +
      `reason: ${request.reason ?? 'n/a'}
` +
      `args: ${JSON.stringify(request.args)}
> `;

    if (io?.rl) {
      const answer = (await io.rl.question(prompt)).trim().toLowerCase();
      return answer === 'y' || answer === 'yes' ? 'approve' : 'deny';
    }

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      return 'deny';
    }

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      const answer = (await rl.question(prompt)).trim().toLowerCase();
      return answer === 'y' || answer === 'yes' ? 'approve' : 'deny';
    } finally {
      rl.close();
    }
  }

  createToolConfirmHandler(io?: ToolConfirmIO): ToolConfirmHandler {
    return async (request: ToolConfirmRequest) => {
      if (this.state.quiet || this.state.approvalMode === 'yolo') {
        return 'approve';
      }
      if (this.state.approvalMode === 'autoEdit') {
        return this.autoEditDecision(request);
      }
      return this.askForApproval(request, io);
    };
  }

  async runPrompt(
    prompt: string,
    renderer: RunRenderer,
    io?: ToolConfirmIO,
    confirmHandlerOverride?: ToolConfirmHandler
  ): Promise<AgentResult> {
    const deps = this.assertInitialized();
    const maxSteps = parsePositiveInt(process.env.AGENT_MAX_STEPS, DEFAULT_MAX_STEPS);

    const agent = new Agent({
      provider: this.createProvider(),
      toolManager: this.createToolManager(),
      memoryManager: deps.memoryManager,
      sessionId: this.state.sessionId,
      systemPrompt: this.state.systemPrompt,
      maxSteps,
      plugins: [renderer.plugin],
      onToolConfirm: confirmHandlerOverride ?? this.createToolConfirmHandler(io),
    });

    const result = await agent.run(prompt);
    this.state.sessionId = agent.getSessionId();
    renderer.flush(result);
    return result;
  }

  resolveSessionId(resume?: string, continueSession = false): string {
    if (resume && resume.trim().length > 0) {
      return resume.trim();
    }

    if (continueSession) {
      const latest = this.listSessions(1)[0];
      if (latest) {
        return latest.sessionId;
      }
    }

    return this.state.sessionId;
  }

  listSessions(limit = 20): CliSessionInfo[] {
    const deps = this.assertInitialized();
    return deps.memoryManager
      .querySessions(undefined, {
        limit,
        orderBy: 'updatedAt',
        orderDirection: 'desc',
      })
      .map((item) => ({
        sessionId: item.sessionId,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        status: item.status,
        totalMessages: item.totalMessages,
      }));
  }

  getSessionHistory(sessionId: string, limit?: number): HistoryMessage[] {
    const deps = this.assertInitialized();
    return deps.memoryManager.getHistory(
      { sessionId },
      {
        orderBy: 'sequence',
        orderDirection: 'asc',
        limit,
      }
    );
  }

  clearSessionContext(sessionId: string): Promise<void> {
    const deps = this.assertInitialized();
    return deps.memoryManager.clearContext(sessionId);
  }

  getRuntimeSummary(): Record<string, string> {
    const deps = this.assertInitialized();
    return {
      cwd: this.state.cwd,
      model: this.state.modelId,
      sessionId: this.state.sessionId,
      outputFormat: this.state.outputFormat,
      approvalMode: this.state.approvalMode,
      storageBackend: deps.runtimeConfig.storage.backend,
      storagePath:
        deps.runtimeConfig.storage.backend === 'sqlite'
          ? deps.runtimeConfig.storage.sqlitePath
          : deps.runtimeConfig.storage.dir,
      logPath: deps.runtimeConfig.log.filePath,
      time: nowIso(),
    };
  }
}

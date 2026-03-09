import type { Tool as ProviderTool } from '../../providers';
import type { RunRecord } from '../app/contracts';
import type {
  RunForegroundCallbacks,
  RunForegroundRequest,
  RunForegroundResult,
} from '../app/agent-app-service';
import type { Message } from '../types';
import type { TaskStore } from './task-store';
import {
  createAgentId,
  safeJsonClone,
  type AgentRunEntity,
  type AgentRunStatus,
} from './task-types';
import type { StartAgentInput, SubagentRunnerAdapter } from './task-runner-adapter';
import type { ToolExecutionContext } from './types';

interface SubagentExecutionService {
  runForeground(
    request: RunForegroundRequest,
    callbacks?: RunForegroundCallbacks
  ): Promise<RunForegroundResult>;
  getRun(executionId: string): Promise<RunRecord | null>;
  listContextMessages(conversationId: string): Promise<Message[]>;
}

interface LiveRunState {
  abortController: AbortController;
}

interface RunLocator {
  executionId: string;
  conversationId: string;
}

export interface RealSubagentRunnerAdapterOptions {
  store: TaskStore;
  appService: SubagentExecutionService;
  resolveTools?: (allowedTools?: string[]) => ProviderTool[] | undefined;
  resolveModelId?: (model?: StartAgentInput['model']) => string | undefined;
  now?: () => number;
}

export class RealSubagentRunnerAdapter implements SubagentRunnerAdapter {
  private readonly store: TaskStore;
  private readonly appService: SubagentExecutionService;
  private readonly resolveTools?: (allowedTools?: string[]) => ProviderTool[] | undefined;
  private readonly resolveModelId?: (model?: StartAgentInput['model']) => string | undefined;
  private readonly now: () => number;
  private readonly liveRuns = new Map<string, LiveRunState>();

  constructor(options: RealSubagentRunnerAdapterOptions) {
    this.store = options.store;
    this.appService = options.appService;
    this.resolveTools = options.resolveTools;
    this.resolveModelId = options.resolveModelId;
    this.now = options.now || Date.now;
  }

  async start(
    namespace: string,
    input: StartAgentInput,
    context?: ToolExecutionContext
  ): Promise<AgentRunEntity> {
    if (input.resume) {
      const resumed = await this.poll(namespace, input.resume);
      if (!resumed) {
        throw new Error(`AGENT_RUN_NOT_FOUND: ${input.resume}`);
      }
      return resumed;
    }

    const now = this.now();
    const agentId = createAgentId();
    const locator = this.createLocator(namespace, agentId);
    const initial: AgentRunEntity = {
      agentId,
      status: 'running',
      subagentType: input.subagentType,
      prompt: input.prompt,
      description: input.description,
      model: input.model,
      maxTurns: input.maxTurns,
      allowedTools: input.allowedTools,
      linkedTaskId: input.linkedTaskId,
      createdAt: now,
      startedAt: now,
      updatedAt: now,
      progress: 0,
      metadata: {
        ...(input.metadata || {}),
        ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
        executionId: locator.executionId,
        conversationId: locator.conversationId,
      },
      version: 1,
    };

    const projected = await this.upsertProjection(namespace, initial);
    await context?.onChunk?.({
      type: 'info',
      content: `subagent started: ${agentId}`,
      data: `subagent started: ${agentId}`,
    });

    const liveKey = this.liveKey(namespace, agentId);
    const live = { abortController: new AbortController() };
    this.liveRuns.set(liveKey, live);

    const runPromise = this.runExecution(namespace, projected, input, live, context);
    if (input.runInBackground) {
      void runPromise;
      return projected;
    }
    return runPromise;
  }

  async poll(namespace: string, agentId: string): Promise<AgentRunEntity | null> {
    const state = await this.store.getState(namespace);
    const current = state.agentRuns[agentId];
    if (!current) {
      return null;
    }

    const locator = this.readLocator(current);
    const remote = await this.appService.getRun(locator.executionId);
    if (!remote) {
      return safeJsonClone(current);
    }
    if (
      current.status === 'cancelled' &&
      (remote.status === 'CREATED' || remote.status === 'QUEUED' || remote.status === 'RUNNING')
    ) {
      return safeJsonClone(current);
    }

    const mapped = this.mapRunRecord(current, remote);
    if (mapped.status === 'completed' && (!mapped.output || mapped.output.trim().length === 0)) {
      mapped.output = await this.readCompletionOutput(locator.conversationId);
    }

    return this.upsertProjection(namespace, mapped);
  }

  async cancel(
    namespace: string,
    agentId: string,
    reason?: string
  ): Promise<AgentRunEntity | null> {
    const key = this.liveKey(namespace, agentId);
    const live = this.liveRuns.get(key);
    if (!live) {
      const existing = await this.poll(namespace, agentId);
      if (!existing || this.isActive(existing.status)) {
        return null;
      }
      return existing;
    }

    live.abortController.abort(reason || 'Cancelled by task_stop');
    const state = await this.store.getState(namespace);
    const current = state.agentRuns[agentId];
    if (!current) {
      return null;
    }

    const cancelled: AgentRunEntity = {
      ...safeJsonClone(current),
      status: 'cancelled',
      progress: current.progress || 0,
      error: reason || 'Cancelled by task_stop',
      endedAt: this.now(),
      updatedAt: this.now(),
    };
    return this.upsertProjection(namespace, cancelled);
  }

  private async runExecution(
    namespace: string,
    initial: AgentRunEntity,
    input: StartAgentInput,
    live: LiveRunState,
    _context?: ToolExecutionContext
  ): Promise<AgentRunEntity> {
    const locator = this.readLocator(initial);
    const request: RunForegroundRequest = {
      conversationId: locator.conversationId,
      executionId: locator.executionId,
      userInput: input.prompt,
      systemPrompt: input.systemPrompt,
      maxSteps: input.maxTurns,
      tools: this.resolveTools?.(input.allowedTools),
      abortSignal: live.abortController.signal,
      config: this.buildConfig(input.model),
    };

    try {
      const result = await this.appService.runForeground(request);
      const output = extractAssistantText(result.messages);
      const mapped = this.mapRunRecord(initial, result.run, output);
      return await this.upsertProjection(namespace, mapped);
    } catch (error) {
      const aborted = live.abortController.signal.aborted;
      const message = error instanceof Error ? error.message : String(error);
      const failed: AgentRunEntity = {
        ...safeJsonClone(initial),
        status: aborted ? 'cancelled' : 'failed',
        error: message,
        progress: aborted ? initial.progress || 0 : initial.progress || 0,
        endedAt: this.now(),
        updatedAt: this.now(),
      };
      return await this.upsertProjection(namespace, failed);
    } finally {
      this.liveRuns.delete(this.liveKey(namespace, initial.agentId));
    }
  }

  private mapRunRecord(base: AgentRunEntity, run: RunRecord, output?: string): AgentRunEntity {
    const status = mapStatus(run);
    const terminalError = status === 'failed' || status === 'timed_out' || status === 'cancelled';
    return {
      ...safeJsonClone(base),
      status,
      progress: status === 'completed' ? 100 : base.progress || 0,
      output: status === 'completed' ? output : undefined,
      error: terminalError ? run.errorMessage || base.error : undefined,
      startedAt: run.startedAt || base.startedAt,
      endedAt: run.completedAt || base.endedAt,
      updatedAt: run.updatedAt || this.now(),
      metadata: {
        ...(base.metadata || {}),
        terminalReason: run.terminalReason,
      },
    };
  }

  private async upsertProjection(namespace: string, next: AgentRunEntity): Promise<AgentRunEntity> {
    const result = await this.store.updateState(namespace, (state) => {
      const existing = state.agentRuns[next.agentId];
      const mergedMetadata = {
        ...(existing?.metadata || {}),
        ...(next.metadata || {}),
      };
      const merged: AgentRunEntity = {
        ...(existing ? safeJsonClone(existing) : {}),
        ...safeJsonClone(next),
        metadata: mergedMetadata,
        version: existing ? existing.version + 1 : 1,
      };
      state.agentRuns[next.agentId] = safeJsonClone(merged);
      return safeJsonClone(merged);
    });
    return result.result;
  }

  private createLocator(namespace: string, agentId: string): RunLocator {
    return {
      executionId: agentId,
      conversationId: `taskns:${namespace}:agent:${agentId}`,
    };
  }

  private readLocator(run: AgentRunEntity): RunLocator {
    const metadata = run.metadata || {};
    const executionId =
      typeof metadata.executionId === 'string' ? metadata.executionId : run.agentId;
    const conversationId =
      typeof metadata.conversationId === 'string'
        ? metadata.conversationId
        : `taskns:default:agent:${run.agentId}`;
    return { executionId, conversationId };
  }

  private async readCompletionOutput(conversationId: string): Promise<string | undefined> {
    try {
      const messages = await this.appService.listContextMessages(conversationId);
      return extractAssistantText(messages);
    } catch {
      return undefined;
    }
  }

  private buildConfig(modelHint?: StartAgentInput['model']): { model?: string } | undefined {
    const model = this.resolveModelId?.(modelHint);
    return model ? { model } : undefined;
  }

  private liveKey(namespace: string, agentId: string): string {
    return `${namespace}::${agentId}`;
  }

  private isActive(status: AgentRunStatus): boolean {
    return status === 'queued' || status === 'running' || status === 'paused';
  }
}

function mapStatus(run: RunRecord): AgentRunStatus {
  switch (run.status) {
    case 'CREATED':
    case 'QUEUED':
      return 'queued';
    case 'RUNNING':
      return 'running';
    case 'COMPLETED':
      return 'completed';
    case 'CANCELLED':
      return 'cancelled';
    case 'FAILED':
      return run.terminalReason === 'timeout' ? 'timed_out' : 'failed';
    default:
      return 'failed';
  }
}

function extractAssistantText(messages: Message[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'assistant') {
      continue;
    }
    if (typeof message.content === 'string') {
      const text = message.content.trim();
      if (text.length > 0) {
        return text;
      }
      continue;
    }
    const serialized = JSON.stringify(message.content);
    if (serialized.length > 0) {
      return serialized;
    }
  }
  return undefined;
}

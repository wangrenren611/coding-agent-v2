import { Agent } from '../../../agent';
import type { MemoryManager } from '../../../storage';
import { ToolManager } from '../../manager';
import type { LLMProvider } from '../../../providers';
import type { Plugin } from '../../../hook';
import type { Run, RunEvent, SubAgentConfigSnapshot } from '../types';
import type { RunExecutionAdapter, RunExecutionResult } from './runner';

function nowIso(): string {
  return new Date().toISOString();
}

interface ParsedRunInputSnapshot {
  prompt: string;
  agentConfigSnapshot?: SubAgentConfigSnapshot;
}

function parseRunInputSnapshot(run: Run): ParsedRunInputSnapshot {
  const fallbackPrompt = '';
  try {
    const parsed = JSON.parse(run.inputSnapshot) as {
      prompt?: unknown;
      agent_config_snapshot?: unknown;
    };
    const prompt =
      typeof parsed.prompt === 'string' && parsed.prompt.trim().length > 0
        ? parsed.prompt.trim()
        : fallbackPrompt;
    const config =
      typeof parsed.agent_config_snapshot === 'object' && parsed.agent_config_snapshot !== null
        ? (parsed.agent_config_snapshot as SubAgentConfigSnapshot)
        : undefined;
    return {
      prompt,
      agentConfigSnapshot: config,
    };
  } catch {
    return {
      prompt: fallbackPrompt,
      agentConfigSnapshot: run.agentConfigSnapshot,
    };
  }
}

function buildSystemPrompt(config?: SubAgentConfigSnapshot): string | undefined {
  if (!config?.systemPrompt) {
    return undefined;
  }
  if (!config.outputContract) {
    return config.systemPrompt;
  }
  return `${config.systemPrompt}\n\nOutput contract:\n${config.outputContract}`;
}

function resolveMaxSteps(
  runConfig: SubAgentConfigSnapshot | undefined,
  fallback: number | undefined
): number {
  return runConfig?.maxSteps ?? fallback ?? 100;
}

function resolveRunMemoryManager(
  runConfig: SubAgentConfigSnapshot | undefined,
  defaultMemoryManager: MemoryManager | undefined
): MemoryManager | undefined {
  if (!runConfig) {
    return defaultMemoryManager;
  }
  if (runConfig.memoryMode === 'off') {
    return undefined;
  }
  return defaultMemoryManager;
}

function resolveChildSessionId(
  run: Run,
  runConfig: SubAgentConfigSnapshot | undefined,
  customBuilder: ((run: Run) => string) | undefined
): string {
  if (customBuilder) {
    return customBuilder(run);
  }
  if (runConfig?.memoryMode === 'inherit') {
    return run.sessionId;
  }
  return `${run.sessionId}:${run.id}`;
}

function resolveTimeoutMs(
  run: Run,
  runConfig: SubAgentConfigSnapshot | undefined
): number | undefined {
  return runConfig?.timeoutMs ?? (run.timeoutMs && run.timeoutMs > 0 ? run.timeoutMs : undefined);
}

function normalizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function normalizePrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }
  return 'Continue with the assigned task and produce a concise result.';
}

function parsePrompt(run: Run): string {
  const parsed = parseRunInputSnapshot(run);
  return normalizePrompt(parsed.prompt);
}

function parseAgentConfig(run: Run): SubAgentConfigSnapshot | undefined {
  const parsed = parseRunInputSnapshot(run);
  return parsed.agentConfigSnapshot ?? run.agentConfigSnapshot;
}

function toTimeoutErrorMessage(timeoutMs: number | undefined): string {
  if (!timeoutMs) {
    return 'run timed out';
  }
  return `run timed out after ${timeoutMs}ms`;
}

function toCancelledErrorMessage(): string {
  return 'run cancelled';
}

function toFailedErrorMessage(error: unknown): string {
  return normalizeError(error);
}

function buildPlugin(
  run: Run,
  appendEvent: (event: Omit<RunEvent, 'seq'>) => Promise<void>
): Plugin {
  return {
    name: 'task-v3-run-events',
    textDelta: async (delta) => {
      await appendEvent({
        runId: run.id,
        type: 'stdout',
        payload: {
          text: delta.text,
          is_reasoning: delta.isReasoning ?? false,
        },
        createdAt: nowIso(),
      });
    },
  };
}

function createTimeoutTimer(
  timeoutMs: number | undefined,
  onTimeout: () => void
): NodeJS.Timeout | undefined {
  if (timeoutMs === undefined) {
    return undefined;
  }
  return setTimeout(onTimeout, timeoutMs);
}

function clearTimer(timer: NodeJS.Timeout | undefined): void {
  if (timer) {
    clearTimeout(timer);
  }
}

function detachAbortListener(signal: AbortSignal, handler: () => void): void {
  signal.removeEventListener('abort', handler);
}

function createAbortRelay(parentSignal: AbortSignal, childController: AbortController): () => void {
  const handler = () => childController.abort(parentSignal.reason);
  parentSignal.addEventListener('abort', handler, { once: true });
  return handler;
}

function buildAgentOptions(params: {
  run: Run;
  runConfig: SubAgentConfigSnapshot | undefined;
  options: AgentRunAdapterOptions;
  plugin: Plugin;
}): ConstructorParameters<typeof Agent>[0] {
  const { run, runConfig, options, plugin } = params;
  return {
    provider: options.provider,
    toolManager: options.createToolManager?.(run) ?? new ToolManager(),
    memoryManager: resolveRunMemoryManager(runConfig, options.memoryManager),
    sessionId: resolveChildSessionId(run, runConfig, options.buildChildSessionId),
    maxSteps: resolveMaxSteps(runConfig, options.maxSteps),
    systemPrompt: buildSystemPrompt(runConfig),
    plugins: [plugin],
  };
}

function createSucceededResult(text: string): RunExecutionResult {
  return {
    status: 'succeeded',
    output: text,
  };
}

function createTimeoutResult(timeoutMs: number | undefined): RunExecutionResult {
  return {
    status: 'timeout',
    error: toTimeoutErrorMessage(timeoutMs),
  };
}

function createCancelledResult(): RunExecutionResult {
  return {
    status: 'cancelled',
    error: toCancelledErrorMessage(),
  };
}

function createFailedResult(error: unknown): RunExecutionResult {
  return {
    status: 'failed',
    error: toFailedErrorMessage(error),
  };
}

function isControllerAborted(controller: AbortController): boolean {
  return controller.signal.aborted;
}

function buildRunSignals(
  signal: AbortSignal,
  timeoutMs: number | undefined
): {
  controller: AbortController;
  cleanup: () => void;
  isTimeoutTriggered: () => boolean;
} {
  const controller = new AbortController();
  let timeoutTriggered = false;
  const relay = createAbortRelay(signal, controller);
  const timer = createTimeoutTimer(timeoutMs, () => {
    timeoutTriggered = true;
    controller.abort('timeout');
  });
  return {
    controller,
    cleanup: () => {
      detachAbortListener(signal, relay);
      clearTimer(timer);
    },
    isTimeoutTriggered: () => timeoutTriggered,
  };
}

function ensureRunConfig(run: Run): SubAgentConfigSnapshot | undefined {
  return parseAgentConfig(run);
}

function createPlugin(
  run: Run,
  appendEvent: (event: Omit<RunEvent, 'seq'>) => Promise<void>
): Plugin {
  return buildPlugin(run, appendEvent);
}

function extractPrompt(run: Run): string {
  return parsePrompt(run);
}

function extractTimeout(
  run: Run,
  runConfig: SubAgentConfigSnapshot | undefined
): number | undefined {
  return resolveTimeoutMs(run, runConfig);
}

function createAgentInstance(
  run: Run,
  runConfig: SubAgentConfigSnapshot | undefined,
  options: AgentRunAdapterOptions,
  plugin: Plugin
): Agent {
  return new Agent(buildAgentOptions({ run, runConfig, options, plugin }));
}

function createResultFromError(
  controller: AbortController,
  timeoutTriggered: boolean,
  timeoutMs: number | undefined,
  error: unknown
): RunExecutionResult {
  if (isControllerAborted(controller)) {
    if (timeoutTriggered) {
      return createTimeoutResult(timeoutMs);
    }
    return createCancelledResult();
  }
  return createFailedResult(error);
}

export interface AgentRunAdapterOptions {
  provider: LLMProvider;
  memoryManager?: MemoryManager;
  createToolManager?: (run: Run) => ToolManager;
  buildChildSessionId?: (run: Run) => string;
  maxSteps?: number;
}

export function createAgentRunExecutionAdapter(
  options: AgentRunAdapterOptions
): RunExecutionAdapter {
  return {
    async execute(
      run: Run,
      signal: AbortSignal,
      appendEvent: (event: Omit<RunEvent, 'seq'>) => Promise<void>
    ): Promise<RunExecutionResult> {
      const runConfig = ensureRunConfig(run);
      const prompt = extractPrompt(run);
      const timeoutMs = extractTimeout(run, runConfig);
      const runSignals = buildRunSignals(signal, timeoutMs);
      const plugin = createPlugin(run, appendEvent);
      const agent = createAgentInstance(run, runConfig, options, plugin);

      try {
        const result = await agent.run(prompt, { abortSignal: runSignals.controller.signal });
        return createSucceededResult(result.text ?? '');
      } catch (error) {
        return createResultFromError(
          runSignals.controller,
          runSignals.isTimeoutTriggered(),
          timeoutMs,
          error
        );
      } finally {
        runSignals.cleanup();
      }
    },
  };
}

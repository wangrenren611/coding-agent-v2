import type { LLMGenerateOptions, LLMProvider, Chunk, LLMRequestMessage } from '../../providers';
import type {
  AgentLoopState,
  Message,
  ToolCall,
  ToolResult,
  FinishReason,
  HookContext,
  ToolStreamEvent,
} from '../../core/types';
import type { AgentStepResult, AgentConfig } from '../types';
import type { ToolManager } from '../../tool';
import type { ToolConfirmRequest } from '../../tool/types';
import type { Logger } from '../../logger';
import type { HookManager } from '../../hook';
import { AgentAbortedError } from '../errors';
import { accumulateUsage, mergeToolCallDelta } from './utils';
import type { AgentPersistenceState } from '../persistence';
import {
  ensureInProgressAssistantMessage,
  flushPendingMessages,
  getInProgressAssistantMessage,
  persistInProgressAssistantMessage,
  resetStreamPersistence,
} from '../persistence';

interface StepRunnerConfig {
  provider: LLMProvider;
  memoryManager?: AgentConfig['memoryManager'];
  onToolConfirm?: AgentConfig['onToolConfirm'];
}

export interface ExecuteAgentStepOptions {
  state: AgentLoopState;
  messages: Message[];
  steps: AgentStepResult[];
  persistenceState: AgentPersistenceState;
  sessionId: string;
  toolManager: ToolManager;
  hookManager: HookManager;
  logger?: Logger;
  config: StepRunnerConfig;
  getHookContext: (messageId?: string) => HookContext;
  getLLMMessages: () => LLMRequestMessage[];
  saveMessages: (startIndex: number) => Promise<void>;
  agentRef: import('../agent').Agent;
  getCurrentReasoningContent: () => string;
  setCurrentReasoningContent: (value: string) => void;
  handleToolStreamEvent: (event: ToolStreamEvent, ctx: HookContext) => Promise<void>;
}

export async function executeAgentStep(
  deps: ExecuteAgentStepOptions,
  options: LLMGenerateOptions
): Promise<void> {
  deps.state.stepIndex++;
  deps.state.currentText = '';
  deps.setCurrentReasoningContent('');
  deps.state.currentToolCalls = [];
  deps.state.stepUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  resetStreamPersistence(deps.persistenceState);

  const rawChunks: Chunk[] = [];
  let finishReason: FinishReason = null;

  try {
    const llmMessages = deps.getLLMMessages();
    const stream = deps.config.provider.generateStream(llmMessages, options);

    for await (const chunk of stream) {
      if (deps.state.aborted) {
        throw new AgentAbortedError();
      }

      rawChunks.push(chunk);
      await processStreamChunk(deps, chunk);

      if (chunk.choices?.[0]?.finish_reason) {
        finishReason = chunk.choices[0].finish_reason;
      }
    }

    await finalizeStep(deps, rawChunks, finishReason);
  } catch (error) {
    deps.logger?.error('[Agent] Step error', error);
    throw error;
  }
}

async function processStreamChunk(deps: ExecuteAgentStepOptions, chunk: Chunk): Promise<void> {
  const choice = chunk.choices?.[0];
  const delta = choice?.delta;
  const streamMessage = await ensureInProgressAssistantMessage({
    state: deps.persistenceState,
    messages: deps.messages,
    memoryManager: deps.config.memoryManager,
    sessionId: deps.sessionId,
    currentText: deps.state.currentText,
    currentReasoningContent: deps.getCurrentReasoningContent(),
    currentToolCalls: deps.state.currentToolCalls,
    stepUsage: deps.state.stepUsage,
    flushPending: async () =>
      flushPendingMessages({
        state: deps.persistenceState,
        messagesLength: deps.messages.length,
        saveMessages: (startIndex) => deps.saveMessages(startIndex),
      }),
    logger: deps.logger,
    stepIndex: deps.state.stepIndex,
  });
  const ctx = deps.getHookContext(streamMessage?.messageId);

  if (delta?.content && typeof delta.content === 'string') {
    deps.state.currentText += delta.content;
    await deps.hookManager.executeTextDeltaHooks(
      {
        text: delta.content,
        messageId: streamMessage?.messageId,
      },
      ctx
    );
  }

  if (delta?.reasoning_content) {
    deps.setCurrentReasoningContent(deps.getCurrentReasoningContent() + delta.reasoning_content);
    await deps.hookManager.executeTextDeltaHooks(
      {
        text: delta.reasoning_content,
        isReasoning: true,
        messageId: streamMessage?.messageId,
      },
      ctx
    );
  }

  if (delta?.tool_calls) {
    for (const toolCall of delta.tool_calls) {
      deps.state.currentToolCalls = mergeToolCallDelta(
        deps.state.currentToolCalls,
        toolCall as ToolCall,
        deps.state.stepIndex
      );
    }
  }

  const usage = accumulateUsage(deps.state.stepUsage, deps.state.totalUsage, chunk.usage);
  deps.state.stepUsage = usage.stepUsage;
  deps.state.totalUsage = usage.totalUsage;

  if (streamMessage) {
    streamMessage.content = deps.state.currentText;
    streamMessage.reasoning_content = deps.getCurrentReasoningContent() || undefined;
    streamMessage.tool_calls =
      deps.state.currentToolCalls.length > 0 ? [...deps.state.currentToolCalls] : undefined;
    streamMessage.usage = { ...deps.state.stepUsage };
  }

  if (chunk.error) {
    deps.logger?.error('[Agent] Stream chunk error', chunk.error);
  }

  if (streamMessage) {
    try {
      await persistInProgressAssistantMessage({
        state: deps.persistenceState,
        messages: deps.messages,
        memoryManager: deps.config.memoryManager,
        sessionId: deps.sessionId,
      });
    } catch (error) {
      deps.logger?.error('[Agent] Failed to persist stream progress', error, {
        sessionId: deps.sessionId,
        stepIndex: deps.state.stepIndex,
      });
    }
  }
}

async function finalizeStep(
  deps: ExecuteAgentStepOptions,
  rawChunks: Chunk[],
  finishReason: FinishReason
): Promise<void> {
  const existingAssistantMessage = getInProgressAssistantMessage(deps.messages, deps.persistenceState);
  const assistantMessageId = existingAssistantMessage?.messageId ?? crypto.randomUUID();
  const ctx = deps.getHookContext(assistantMessageId);

  if (deps.state.currentText) {
    await deps.hookManager.executeTextCompleteHooks(deps.state.currentText, ctx);
  }

  const toolResults: Array<{ toolCallId: string; result: ToolResult }> = [];

  if (deps.state.currentToolCalls.length > 0) {
    deps.logger?.info('[Agent] Executing tools', {
      count: deps.state.currentToolCalls.length,
      tools: deps.state.currentToolCalls.map((toolCall) => toolCall.function.name),
    });

    const context = {
      loopIndex: deps.state.loopIndex,
      stepIndex: deps.state.stepIndex,
      agent: deps.agentRef,
      agentContext: {
        sessionId: deps.sessionId,
        loopIndex: deps.state.loopIndex,
        stepIndex: deps.state.stepIndex,
      },
    };

    const processedToolCalls: ToolCall[] = [];
    for (const toolCall of deps.state.currentToolCalls) {
      const processed = await deps.hookManager.executeToolUseHooks(toolCall, ctx);
      processedToolCalls.push(processed);
    }

    const onToolConfirm = deps.config.onToolConfirm
      ? async (request: ToolConfirmRequest) => {
          await deps.hookManager.executeToolConfirmHooks(request, ctx);
          return deps.config.onToolConfirm!(request);
        }
      : undefined;

    toolResults.push(
      ...(await deps.toolManager.executeTools(processedToolCalls, context, {
        onToolEvent: async (event) => {
          await deps.handleToolStreamEvent(event, ctx);
        },
        onToolConfirm,
      }))
    );

    for (let i = 0; i < toolResults.length; i++) {
      const { toolCallId, result } = toolResults[i];
      const toolCall = processedToolCalls.find((call) => call.id === toolCallId);
      if (toolCall) {
        const processedResult = await deps.hookManager.executeToolResultHooks(
          { toolCall, result },
          ctx
        );
        toolResults[i] = { toolCallId, result: processedResult.result };
      }
    }
  }

  const stepResult: AgentStepResult = {
    text: deps.state.currentText,
    toolCalls: [...deps.state.currentToolCalls],
    toolResults,
    finishReason,
    usage: { ...deps.state.stepUsage },
    rawChunks,
  };
  deps.steps.push(stepResult);

  let assistantMessage = existingAssistantMessage;
  if (!assistantMessage) {
    assistantMessage = {
      messageId: assistantMessageId,
      role: 'assistant',
      content: deps.state.currentText || '',
      reasoning_content: deps.getCurrentReasoningContent() || undefined,
      tool_calls:
        deps.state.currentToolCalls.length > 0 ? [...deps.state.currentToolCalls] : undefined,
      finish_reason: finishReason ?? undefined,
      usage: { ...deps.state.stepUsage },
    };
    deps.messages.push(assistantMessage);
    deps.persistenceState.inProgressAssistantMessageId = assistantMessage.messageId;
  } else {
    assistantMessage.content = deps.state.currentText || '';
    assistantMessage.reasoning_content = deps.getCurrentReasoningContent() || undefined;
    assistantMessage.tool_calls =
      deps.state.currentToolCalls.length > 0 ? [...deps.state.currentToolCalls] : undefined;
    assistantMessage.finish_reason = finishReason ?? undefined;
    assistantMessage.usage = { ...deps.state.stepUsage };
  }

  if (deps.persistenceState.inProgressAssistantMessageId) {
    try {
      await persistInProgressAssistantMessage({
        state: deps.persistenceState,
        messages: deps.messages,
        memoryManager: deps.config.memoryManager,
        sessionId: deps.sessionId,
        force: true,
      });
    } catch (error) {
      deps.logger?.error('[Agent] Failed to persist final stream state', error, {
        sessionId: deps.sessionId,
        stepIndex: deps.state.stepIndex,
      });
    }
  }

  for (const { toolCallId, result } of toolResults) {
    const toolMessage: Message = {
      messageId: crypto.randomUUID(),
      role: 'tool',
      content: JSON.stringify({
        success: result.success,
        data: result.data,
        error: result.error,
        metadata: result.metadata,
      }),
      tool_call_id: toolCallId,
    };
    deps.messages.push(toolMessage);
  }

  await deps.hookManager.executeStepHooks(
    {
      stepIndex: deps.state.stepIndex,
      finishReason: finishReason ?? undefined,
      toolCallsCount: deps.state.currentToolCalls.length,
    },
    ctx
  );

  if (finishReason === 'stop' || finishReason === 'length') {
    deps.state.resultStatus = 'stop';
  } else if (finishReason === 'tool_calls' && toolResults.length > 0) {
    deps.state.resultStatus = 'continue';
  }

  resetStreamPersistence(deps.persistenceState);
}

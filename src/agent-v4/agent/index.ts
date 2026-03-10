import {
  Message,
  AgentInput,
  AgentCallbacks,
  AgentContextUsage,
  CompactionInfo,
  StreamEvent,
  ErrorDecision,
  ToolDecision,
} from '../types';
import { ToolManager } from '../tool/tool-manager';
import { LLMProvider, Tool, ToolCall } from '../../providers';
import { EventEmitter } from 'events';
import {
  AgentAbortedError,
  AgentError,
  ConfirmationTimeoutError,
  MaxRetriesError,
  TimeoutBudgetExceededError,
  UnknownError,
} from './error';
import type { AgentLogger } from './logger';
import { compact, estimateMessagesTokens } from './compaction';
import { LLMTool, ToolConcurrencyPolicy } from '../tool/types';
import type { BackoffConfig } from '../../providers';
import {
  convertMessageToLLMMessage as toLLMMessage,
  mergeLLMConfig as mergeLLMRequestConfig,
} from './message-utils';
import {
  createCheckpoint,
  createDoneEvent,
  createErrorEvent,
  createProgressEvent,
} from './stream-events';
import {
  buildExecutionWaves as buildToolExecutionWaves,
  runWithConcurrencyAndLock as runTasksWithConcurrencyAndLock,
} from './concurrency';
import {
  calculateRetryDelay as calculateRetryDelayWithBackoff,
  isAbortError as isAbortErrorByMessage,
  normalizeError as normalizeAgentError,
} from './error-normalizer';
import {
  createExecutionAbortScope as createExecutionBudgetScope,
  createStageAbortScope as createStageBudgetScope,
  createTimeoutBudgetState as createBudgetState,
  type AbortScope,
  type TimeoutBudgetState,
  type TimeoutStage,
} from './timeout-budget';
import {
  buildWriteFileSessionKey as createWriteFileSessionKey,
  bufferWriteFileToolCallChunk as bufferWriteFileChunk,
  cleanupWriteFileBufferIfNeeded as cleanupWriteFileBufferSession,
  enrichWriteFileToolError as buildWriteFileToolErrorPayload,
  isWriteFileProtocolOutput as isWriteFileProtocolResponse,
  isWriteFileToolCall as isWriteFileTool,
  shouldEnrichWriteFileFailure as needEnrichWriteFileFailure,
  type WriteBufferRuntime,
} from './write-file-session';
import {
  createToolResultMessage as buildToolResultMessage,
  NoopToolExecutionLedger,
  executeToolCallWithLedger as executeWithToolLedger,
  type ToolExecutionLedger,
  type ToolExecutionLedgerRecord,
} from './tool-execution-ledger';
import {
  emitMetric as pushMetric,
  emitTrace as pushTrace,
  endSpan as finishSpan,
  extractErrorCode as parseErrorCode,
  logError as writeErrorLog,
  logInfo as writeInfoLog,
  logWarn as writeWarnLog,
  startSpan as beginSpan,
  type SpanRuntime,
} from './telemetry';
import {
  safeCallback as invokeSafeCallback,
  safeErrorCallback as invokeSafeErrorCallback,
} from './callback-safety';
import { mergeToolCalls as mergeToolCallsWithBuffer } from './tool-call-merge';
import type { ToolResult } from '../tool/base-tool';
import {
  normalizeTimeoutBudgetError as normalizeAbortTimeoutBudgetError,
  sleepWithAbort,
  throwIfAborted as assertNotAborted,
  timeoutBudgetErrorFromSignal as timeoutErrorFromAbortSignal,
} from './abort-runtime';

function generateId(prefix: string): string {
  return `${prefix}${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

function hasNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

export interface AgentConfig {
  maxRetryCount?: number;
  enableCompaction?: boolean;
  compactionTriggerRatio?: number;
  compactionKeepMessagesNum?: number;
  backoffConfig?: BackoffConfig;
  maxConcurrentToolCalls?: number;
  toolConcurrencyPolicyResolver?: (toolCall: ToolCall) => ToolConcurrencyPolicy;
  logger?: AgentLogger;
  /**
   * Optional external idempotency ledger.
   * Defaults to Noop to keep the agent stateless across process restarts and scale-out replicas.
   */
  toolExecutionLedger?: ToolExecutionLedger;
  timeoutBudgetMs?: number;
  llmTimeoutRatio?: number;
}

export type { AgentLogger } from './logger';

interface InternalAgentConfig {
  maxRetryCount: number;
  enableCompaction: boolean;
  compactionTriggerRatio: number;
  compactionKeepMessagesNum: number;
  backoffConfig: BackoffConfig;
  maxConcurrentToolCalls: number;
  toolConcurrencyPolicyResolver?: (toolCall: ToolCall) => ToolConcurrencyPolicy;
  logger: AgentLogger;
  timeoutBudgetMs?: number;
  llmTimeoutRatio: number;
}

const DEFAULT_MAX_RETRY_COUNT = 20;
const DEFAULT_COMPACTION_TRIGGER_RATIO = 0.8;
const DEFAULT_COMPACTION_KEEP_MESSAGES = 20;
const DEFAULT_MAX_CONCURRENT_TOOL_CALLS = 1;
const DEFAULT_LLM_TIMEOUT_RATIO = 0.7;
const ABORTED_MESSAGE = 'Operation aborted';

export type { ToolExecutionLedger, ToolExecutionLedgerRecord } from './tool-execution-ledger';

export class StatelessAgent extends EventEmitter {
  private llmProvider: LLMProvider;
  private toolExecutor: ToolManager;
  private config: InternalAgentConfig;
  private logger: AgentLogger;
  private toolExecutionLedger: ToolExecutionLedger;
  constructor(llmProvider: LLMProvider, toolExecutor: ToolManager, config: AgentConfig) {
    super();
    this.llmProvider = llmProvider;
    this.toolExecutor = toolExecutor;
    this.logger = config.logger ?? {};
    this.toolExecutionLedger = config.toolExecutionLedger ?? new NoopToolExecutionLedger();
    const llmTimeoutRatio = Number.isFinite(config.llmTimeoutRatio)
      ? Number(config.llmTimeoutRatio)
      : DEFAULT_LLM_TIMEOUT_RATIO;
    const clampedLlmTimeoutRatio = Math.min(0.95, Math.max(0.05, llmTimeoutRatio));
    this.config = {
      maxRetryCount: config.maxRetryCount ?? DEFAULT_MAX_RETRY_COUNT,
      enableCompaction: config.enableCompaction ?? false,
      compactionTriggerRatio: config.compactionTriggerRatio ?? DEFAULT_COMPACTION_TRIGGER_RATIO,
      compactionKeepMessagesNum:
        config.compactionKeepMessagesNum ?? DEFAULT_COMPACTION_KEEP_MESSAGES,
      backoffConfig: config.backoffConfig ?? {},
      maxConcurrentToolCalls: Math.max(
        1,
        Math.floor(config.maxConcurrentToolCalls ?? DEFAULT_MAX_CONCURRENT_TOOL_CALLS)
      ),
      toolConcurrencyPolicyResolver: config.toolConcurrencyPolicyResolver,
      logger: this.logger,
      timeoutBudgetMs:
        config.timeoutBudgetMs &&
        Number.isFinite(config.timeoutBudgetMs) &&
        config.timeoutBudgetMs > 0
          ? Math.floor(config.timeoutBudgetMs)
          : undefined,
      llmTimeoutRatio: clampedLlmTimeoutRatio,
    };
  }

  getContextLimitTokens(contextLimitTokens?: number): number {
    if (
      typeof contextLimitTokens === 'number' &&
      Number.isFinite(contextLimitTokens) &&
      contextLimitTokens > 0
    ) {
      return Math.max(1, Math.floor(contextLimitTokens));
    }
    const maxTokens = this.llmProvider.getLLMMaxTokens();
    const maxOutputTokens = this.llmProvider.getMaxOutputTokens();
    return Math.max(1, maxTokens - maxOutputTokens);
  }

  estimateContextUsage(
    messages: Message[],
    tools?: Tool[],
    contextLimitTokens?: number
  ): Pick<AgentContextUsage, 'contextTokens' | 'contextLimitTokens' | 'contextUsagePercent'> {
    const llmTools = tools as unknown as LLMTool[] | undefined;
    const contextTokens = estimateMessagesTokens(messages, llmTools);
    const resolvedContextLimitTokens = this.getContextLimitTokens(contextLimitTokens);
    return {
      contextTokens,
      contextLimitTokens: resolvedContextLimitTokens,
      contextUsagePercent: (contextTokens / resolvedContextLimitTokens) * 100,
    };
  }

  private convertMessageToLLMMessage(message: Message) {
    return toLLMMessage(message);
  }

  private needsCompaction(
    messages: Message[],
    tools?: Tool[],
    contextLimitTokens?: number
  ): boolean {
    if (!this.config.enableCompaction) {
      return false;
    }

    const usableLimit = this.getContextLimitTokens(contextLimitTokens);
    const threshold = usableLimit * this.config.compactionTriggerRatio;

    const llmTools = tools as unknown as LLMTool[] | undefined;
    const currentTokens = estimateMessagesTokens(messages, llmTools);

    return currentTokens >= threshold;
  }

  private async compactMessagesIfNeeded(
    messages: Message[],
    tools?: Tool[],
    contextLimitTokens?: number
  ): Promise<string[]> {
    if (!this.needsCompaction(messages, tools, contextLimitTokens)) {
      return [];
    }

    try {
      const result = await compact(messages, {
        provider: this.llmProvider,
        keepMessagesNum: this.config.compactionKeepMessagesNum,
      });
      messages.splice(0, messages.length, ...result.messages);

      return result.removedMessageIds ?? [];
    } catch (error) {
      this.logError('[Agent] Compaction failed:', error);
      return [];
    }
  }

  async *runStream(
    input: AgentInput,
    callbacks?: AgentCallbacks
  ): AsyncGenerator<StreamEvent, void, unknown> {
    const { messages: inputMessages, maxSteps = 100, abortSignal: inputAbortSignal } = input;
    const effectiveTools = this.resolveLLMTools(input.tools);
    const messages = [...inputMessages];
    if (typeof input.systemPrompt === 'string' && input.systemPrompt.trim().length > 0) {
      const hasSystemMessage = messages.some((message) => message.role === 'system');
      if (!hasSystemMessage) {
        messages.unshift({
          messageId: generateId('msg_sys_'),
          type: 'system',
          role: 'system',
          content: input.systemPrompt,
          timestamp: Date.now(),
        });
      }
    }
    const writeBufferSessions = new Map<string, WriteBufferRuntime>();
    const timeoutBudget = this.createTimeoutBudgetState(input);
    const executionScope = this.createExecutionAbortScope(inputAbortSignal, timeoutBudget);
    const abortSignal = executionScope.signal;
    const traceId = input.executionId || generateId('trace_');
    const runSpan = await this.startSpan(callbacks, traceId, 'agent.run', undefined, {
      executionId: input.executionId,
      conversationId: input.conversationId,
      maxSteps,
      timeoutBudgetMs: timeoutBudget?.totalMs,
    });
    this.logInfo('[Agent] run.start', {
      executionId: input.executionId,
      traceId,
      spanId: runSpan.spanId,
      messageCount: messages.length,
    });

    let stepIndex = 0;
    let retryCount = 0;
    let runOutcome: 'done' | 'error' | 'aborted' | 'timeout' | 'max_retries' | 'max_steps' = 'done';
    let runErrorCode: string | undefined;
    let terminalDoneEmitted = false;

    try {
      while (stepIndex < maxSteps) {
        if (abortSignal?.aborted) {
          const timeoutError = this.timeoutBudgetErrorFromSignal(abortSignal);
          if (timeoutError) {
            runOutcome = 'timeout';
            runErrorCode = timeoutError.errorCode;
            yield* this.yieldErrorEvent(timeoutError);
          } else {
            runOutcome = 'aborted';
            runErrorCode = 'AGENT_ABORTED';
            yield* this.yieldErrorEvent(new AgentAbortedError(ABORTED_MESSAGE));
          }
          break;
        }

        if (retryCount >= this.config.maxRetryCount) {
          runOutcome = 'max_retries';
          runErrorCode = 'AGENT_MAX_RETRIES_REACHED';
          yield* this.yieldMaxRetriesError();
          break;
        }

        stepIndex++;

        try {
          this.throwIfAborted(abortSignal);
          const messageCountBeforeCompaction = messages.length;
          const removedMessageIds = await this.compactMessagesIfNeeded(
            messages,
            effectiveTools,
            input.contextLimitTokens
          );
          if (removedMessageIds.length > 0) {
            const compactionInfo: CompactionInfo = {
              executionId: input.executionId,
              stepIndex,
              removedMessageIds,
              messageCountBefore: messageCountBeforeCompaction,
              messageCountAfter: messages.length,
            };
            await this.safeCallback(callbacks?.onCompaction, compactionInfo);
            yield {
              type: 'compaction',
              data: compactionInfo,
            };
          }

          this.throwIfAborted(abortSignal);

          const contextUsage = this.estimateContextUsage(
            messages,
            effectiveTools,
            input.contextLimitTokens
          );
          await this.safeCallback(callbacks?.onContextUsage, {
            stepIndex,
            messageCount: messages.length,
            ...contextUsage,
          });

          yield* this.emitProgress(input.executionId, stepIndex, 'llm', messages.length);
          const llmSpan = await this.startSpan(
            callbacks,
            traceId,
            'agent.llm.step',
            runSpan.spanId,
            {
              executionId: input.executionId,
              stepIndex,
              messageCount: messages.length,
            }
          );
          const llmScope = this.createStageAbortScope(abortSignal, timeoutBudget, 'llm');
          let llmResult:
            | {
                assistantMessage: Message;
                toolCalls: ToolCall[];
              }
            | undefined;
          let llmErrorCode: string | undefined;
          let llmSucceeded = false;
          try {
            const llmGen = this.callLLMAndProcessStream(
              messages,
              this.mergeLLMConfig(input.config, effectiveTools, llmScope.signal),
              llmScope.signal,
              input.executionId,
              stepIndex,
              writeBufferSessions
            );
            for (;;) {
              const next = await llmGen.next();
              if (next.done) {
                llmResult = next.value;
                break;
              }
              yield next.value as StreamEvent;
            }
            this.throwIfAborted(llmScope.signal);
            llmSucceeded = true;
          } catch (error) {
            llmErrorCode = this.extractErrorCode(error) || 'AGENT_LLM_STAGE_FAILED';
            throw error;
          } finally {
            llmScope.release();
            const llmLatencyMs = Date.now() - llmSpan.startedAt;
            await this.emitMetric(callbacks, {
              name: 'agent.llm.duration_ms',
              value: llmLatencyMs,
              unit: 'ms',
              timestamp: Date.now(),
              tags: {
                executionId: input.executionId,
                stepIndex,
                success: llmSucceeded ? 'true' : 'false',
              },
            });
            await this.endSpan(callbacks, llmSpan, {
              executionId: input.executionId,
              stepIndex,
              latencyMs: llmLatencyMs,
              errorCode: llmErrorCode,
            });
            this.logInfo('[Agent] llm.step', {
              executionId: input.executionId,
              traceId,
              spanId: llmSpan.spanId,
              stepIndex,
              latencyMs: llmLatencyMs,
              errorCode: llmErrorCode,
              messageCount: messages.length,
            });
          }

          if (!llmResult) {
            throw new UnknownError('LLM stream completed without result');
          }
          const assistantMessage = llmResult.assistantMessage;
          const toolCalls = llmResult.toolCalls;

          messages.push(assistantMessage);
          await this.safeCallback(callbacks?.onMessage, assistantMessage);

          if (toolCalls.length > 0) {
            yield* this.emitProgress(input.executionId, stepIndex, 'tool', messages.length);
            const toolStageSpan = await this.startSpan(
              callbacks,
              traceId,
              'agent.tool.stage',
              runSpan.spanId,
              {
                executionId: input.executionId,
                stepIndex,
                toolCalls: toolCalls.length,
              }
            );
            const toolScope = this.createStageAbortScope(abortSignal, timeoutBudget, 'tool');
            let toolResultMessage: Message | undefined;
            let toolStageErrorCode: string | undefined;
            let toolStageSucceeded = false;
            try {
              const toolGen = this.processToolCalls(
                toolCalls,
                messages,
                stepIndex,
                callbacks,
                toolScope.signal,
                input.executionId,
                traceId,
                toolStageSpan.spanId,
                writeBufferSessions
              );
              for (;;) {
                const next = await toolGen.next();
                if (next.done) {
                  toolResultMessage = next.value;
                  break;
                }
                yield next.value as StreamEvent;
              }
              toolStageSucceeded = true;
            } catch (error) {
              toolStageErrorCode = this.extractErrorCode(error) || 'AGENT_TOOL_STAGE_FAILED';
              throw error;
            } finally {
              toolScope.release();
              const toolStageLatencyMs = Date.now() - toolStageSpan.startedAt;
              await this.emitMetric(callbacks, {
                name: 'agent.tool.stage.duration_ms',
                value: toolStageLatencyMs,
                unit: 'ms',
                timestamp: Date.now(),
                tags: {
                  executionId: input.executionId,
                  stepIndex,
                  success: toolStageSucceeded ? 'true' : 'false',
                },
              });
              await this.endSpan(callbacks, toolStageSpan, {
                executionId: input.executionId,
                stepIndex,
                latencyMs: toolStageLatencyMs,
                errorCode: toolStageErrorCode,
                toolCalls: toolCalls.length,
              });
              this.logInfo('[Agent] tool.stage', {
                executionId: input.executionId,
                traceId,
                spanId: toolStageSpan.spanId,
                stepIndex,
                latencyMs: toolStageLatencyMs,
                errorCode: toolStageErrorCode,
                toolCalls: toolCalls.length,
              });
            }

            const lastMessage = toolResultMessage;
            yield* this.yieldCheckpoint(input.executionId, stepIndex, lastMessage, callbacks);
            continue;
          }

          retryCount = 0;
          runOutcome = 'done';
          terminalDoneEmitted = true;
          yield* this.yieldDoneEvent(stepIndex, 'stop');
          break;
        } catch (error) {
          const timeoutError = this.normalizeTimeoutBudgetError(error, abortSignal);
          if (timeoutError) {
            runOutcome = 'timeout';
            runErrorCode = timeoutError.errorCode;
            yield* this.yieldErrorEvent(timeoutError);
            break;
          }

          if (this.isAbortError(error) || inputAbortSignal?.aborted) {
            runOutcome = 'aborted';
            runErrorCode = 'AGENT_ABORTED';
            yield* this.yieldErrorEvent(new AgentAbortedError(ABORTED_MESSAGE));
            break;
          }

          const normalizedError = this.normalizeError(error);
          this.logError('[Agent] run.error', normalizedError, {
            executionId: input.executionId,
            traceId,
            stepIndex,
            retryCount,
            errorCode: normalizedError.errorCode,
            category: normalizedError.category,
          });
          runOutcome = 'error';
          runErrorCode = normalizedError.errorCode;
          const decision = await this.safeErrorCallback(callbacks?.onError, normalizedError);
          yield* this.yieldErrorEvent(normalizedError);

          const shouldRetry = decision?.retry ?? normalizedError.retryable;
          if (!shouldRetry) {
            break;
          }

          retryCount++;
          this.logWarn('[Agent] retry.scheduled', {
            executionId: input.executionId,
            traceId,
            stepIndex,
            retryCount,
            errorCode: normalizedError.errorCode,
          });
          if (retryCount < this.config.maxRetryCount) {
            const retryDelay = this.calculateRetryDelay(retryCount, error as Error);
            try {
              await this.sleep(retryDelay, abortSignal);
            } catch (sleepError) {
              const sleepTimeoutError = this.normalizeTimeoutBudgetError(sleepError, abortSignal);
              if (sleepTimeoutError) {
                runOutcome = 'timeout';
                runErrorCode = sleepTimeoutError.errorCode;
                yield* this.yieldErrorEvent(sleepTimeoutError);
                break;
              }
              if (this.isAbortError(sleepError) || inputAbortSignal?.aborted) {
                runOutcome = 'aborted';
                runErrorCode = 'AGENT_ABORTED';
                yield* this.yieldErrorEvent(new AgentAbortedError(ABORTED_MESSAGE));
                break;
              }
              throw sleepError;
            }
          }
        }
      }

      if (!terminalDoneEmitted && runOutcome === 'done' && stepIndex >= maxSteps) {
        runOutcome = 'max_steps';
        terminalDoneEmitted = true;
        yield* this.yieldDoneEvent(stepIndex, 'max_steps');
      }
    } finally {
      const runLatencyMs = Date.now() - runSpan.startedAt;
      await this.emitMetric(callbacks, {
        name: 'agent.run.duration_ms',
        value: runLatencyMs,
        unit: 'ms',
        timestamp: Date.now(),
        tags: {
          executionId: input.executionId,
          outcome: runOutcome,
        },
      });
      await this.emitMetric(callbacks, {
        name: 'agent.retry.count',
        value: retryCount,
        unit: 'count',
        timestamp: Date.now(),
        tags: {
          executionId: input.executionId,
        },
      });
      await this.endSpan(callbacks, runSpan, {
        executionId: input.executionId,
        stepIndex,
        latencyMs: runLatencyMs,
        outcome: runOutcome,
        errorCode: runErrorCode,
        retryCount,
      });
      this.logInfo('[Agent] run.finish', {
        executionId: input.executionId,
        traceId,
        spanId: runSpan.spanId,
        stepIndex,
        latencyMs: runLatencyMs,
        outcome: runOutcome,
        errorCode: runErrorCode,
        retryCount,
      });
      executionScope.release();
    }
  }

  private async safeCallback<T>(
    callback: ((arg: T) => void | Promise<void>) | undefined,
    arg: T
  ): Promise<void> {
    await invokeSafeCallback(callback, arg, (error) =>
      this.logError('[Agent] Callback error:', error)
    );
  }

  private async safeErrorCallback(
    callback: ((error: Error) => ErrorDecision | void | Promise<ErrorDecision | void>) | undefined,
    error: Error
  ): Promise<ErrorDecision | undefined> {
    return invokeSafeErrorCallback(callback, error, (err) =>
      this.logError('[Agent] Error callback error:', err)
    );
  }

  private async mergeToolCalls(
    existing: ToolCall[],
    newCalls: ToolCall[],
    messageId: string,
    executionId: string | undefined,
    stepIndex: number,
    writeBufferSessions: Map<string, WriteBufferRuntime>
  ): Promise<ToolCall[]> {
    return mergeToolCallsWithBuffer({
      existing,
      incoming: newCalls,
      messageId,
      onArgumentsChunk: async (toolCall, argumentsChunk, chunkMessageId) => {
        const sessionKey = createWriteFileSessionKey({
          executionId,
          stepIndex,
          toolCallId: toolCall.id,
        });
        await bufferWriteFileChunk({
          toolCall,
          argumentsChunk,
          messageId: chunkMessageId,
          sessionKey,
          sessions: writeBufferSessions,
          onError: (error) =>
            this.logError('[Agent] Failed to buffer write_file tool chunk:', error),
        });
      },
    });
  }

  private async *callLLMAndProcessStream(
    messages: Message[],
    config: AgentInput['config'],
    abortSignal?: AbortSignal,
    executionId?: string,
    stepIndex = 0,
    writeBufferSessions: Map<string, WriteBufferRuntime> = new Map()
  ): AsyncGenerator<StreamEvent, { assistantMessage: Message; toolCalls: ToolCall[] }, unknown> {
    const llmMessages = messages.map((msg) => this.convertMessageToLLMMessage(msg));
    const stream = this.llmProvider.generateStream(llmMessages, config);

    const assistantMessage: Message = {
      messageId: generateId('msg_'),
      type: 'assistant-text',
      role: 'assistant',
      content: '',
      reasoning_content: '',
      timestamp: Date.now(),
    };

    let toolCalls: ToolCall[] = [];

    for await (const chunk of stream) {
      this.throwIfAborted(abortSignal);
      const choices = chunk.choices;
      const delta = choices?.[0]?.delta;

      if (chunk.usage) {
        assistantMessage.usage = chunk.usage;
      }

      if (typeof delta?.content === 'string') {
        assistantMessage.content = `${assistantMessage.content}${delta.content}`;

        yield {
          type: 'chunk',
          data: {
            messageId: assistantMessage.messageId,
            content: delta.content,
            delta: true,
          },
        };
      }

      if (typeof delta?.reasoning_content === 'string') {
        const currentReasoning = assistantMessage.reasoning_content;
        assistantMessage.reasoning_content = `${currentReasoning || ''}${delta.reasoning_content}`;

        yield {
          type: 'reasoning_chunk',
          data: {
            messageId: assistantMessage.messageId,
            reasoningContent: delta.reasoning_content,
            delta: true,
          },
        };
      }

      if (delta?.tool_calls) {
        toolCalls = await this.mergeToolCalls(
          toolCalls,
          delta.tool_calls,
          assistantMessage.messageId,
          executionId,
          stepIndex,
          writeBufferSessions
        );

        yield {
          type: 'tool_call',
          data: {
            messageId: assistantMessage.messageId,
            toolCalls,
          },
        };
      }

      const finishReason =
        choices?.[0]?.finish_reason ||
        (delta as { finish_reason?: string } | undefined)?.finish_reason;
      if (finishReason) {
        break;
      }
    }

    assistantMessage.tool_calls = toolCalls.length > 0 ? toolCalls : undefined;
    assistantMessage.type = toolCalls.length > 0 ? 'tool-call' : 'assistant-text';

    return { assistantMessage, toolCalls };
  }

  private async *executeTool(
    toolCall: ToolCall,
    stepIndex: number,
    callbacks?: AgentCallbacks,
    abortSignal?: AbortSignal,
    executionId?: string,
    traceId?: string,
    parentSpanId?: string,
    writeBufferSessions: Map<string, WriteBufferRuntime> = new Map()
  ): AsyncGenerator<StreamEvent, Message, unknown> {
    this.throwIfAborted(abortSignal);
    const effectiveTraceId = traceId || executionId || generateId('trace_');
    const toolSpan = await this.startSpan(
      callbacks,
      effectiveTraceId,
      'agent.tool.execute',
      parentSpanId,
      {
        executionId,
        stepIndex,
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
      }
    );
    let toolErrorCode: string | undefined;
    let cachedHit = false;
    let toolSucceeded = false;
    try {
      const writeFileSessionKey = createWriteFileSessionKey({
        executionId,
        stepIndex,
        toolCallId: toolCall.id,
      });

      const ledgerResult = await executeWithToolLedger({
        ledger: this.toolExecutionLedger,
        executionId,
        toolCallId: toolCall.id,
        execute: async () => {
          const toolExecResult = await this.toolExecutor.execute(toolCall, {
            onChunk: (chunk) => {
              this.emit('tool_chunk', {
                toolCallId: toolCall.id,
                toolName: toolCall.function.name,
                arguments: toolCall.function.arguments,
                chunk: chunk.data,
                chunkType: chunk.type,
              });
            },
            onConfirm: async (info) => {
              return new Promise((resolve) => {
                let settled = false;
                const abortHandler = () => {
                  if (!settled) {
                    settled = true;
                    clearTimeout(timeout);
                    resolve({ approved: false, message: ABORTED_MESSAGE });
                  }
                };

                const timeout = setTimeout(() => {
                  if (!settled) {
                    settled = true;
                    const err = new ConfirmationTimeoutError();
                    resolve({ approved: false, message: err.message });
                  }
                }, 30000);

                const cleanup = () => {
                  if (!settled) {
                    settled = true;
                    clearTimeout(timeout);
                  }
                  abortSignal?.removeEventListener('abort', abortHandler);
                };

                if (abortSignal?.aborted) {
                  abortHandler();
                  return;
                }
                abortSignal?.addEventListener('abort', abortHandler, { once: true });

                this.emit('tool_confirm', {
                  ...info,
                  resolve: (decision: ToolDecision) => {
                    cleanup();
                    resolve(decision);
                  },
                });
              });
            },
            onPolicyCheck: callbacks?.onToolPolicy
              ? async (info) => {
                  const decision = await callbacks.onToolPolicy?.(info);
                  return decision || { allowed: true };
                }
              : undefined,
            toolCallId: toolCall.id,
            loopIndex: stepIndex,
            agent: this,
            toolAbortSignal: abortSignal,
          });

          let toolOutput = '';
          let toolSummary = '';
          let errorCode: string | undefined;

          if (toolExecResult.success) {
            toolOutput = toolExecResult.output || '';
            await cleanupWriteFileBufferSession(toolCall, writeBufferSessions, writeFileSessionKey);
          } else {
            if (isWriteFileTool(toolCall)) {
              if (isWriteFileProtocolResponse(toolExecResult.output)) {
                toolOutput = toolExecResult.output;
              } else if (needEnrichWriteFileFailure(toolExecResult.error, toolExecResult.output)) {
                const errorContent =
                  toolExecResult.error?.message ||
                  toolExecResult.output ||
                  new UnknownError().message;
                toolOutput = await buildWriteFileToolErrorPayload(
                  toolCall,
                  errorContent,
                  writeBufferSessions,
                  writeFileSessionKey
                );
              } else {
                toolOutput =
                  toolExecResult.error?.message ||
                  toolExecResult.output ||
                  new UnknownError().message;
              }
            } else {
              toolOutput =
                toolExecResult.error?.message ||
                toolExecResult.output ||
                new UnknownError().message;
            }
            errorCode = this.extractErrorCode(toolExecResult.error) || 'TOOL_EXECUTION_FAILED';
          }

          toolSummary = this.resolveToolResultSummary(toolCall, toolExecResult, toolOutput);

          return {
            success: toolExecResult.success,
            output: toolOutput,
            summary: toolSummary,
            payload: toolExecResult.payload,
            metadata: toolExecResult.metadata,
            errorName: toolExecResult.error?.name,
            errorMessage: toolExecResult.error?.message,
            errorCode,
            recordedAt: Date.now(),
          };
        },
        onError: (error) => {
          this.logError('[Agent] Failed to execute tool with ledger:', error, {
            executionId,
            stepIndex,
            toolCallId: toolCall.id,
          });
        },
      });

      cachedHit = ledgerResult.fromCache;
      toolSucceeded = ledgerResult.record.success;
      toolErrorCode = ledgerResult.record.errorCode;

      const replayResult = this.createToolResultMessageFromLedger(toolCall.id, ledgerResult.record);
      await this.safeCallback(callbacks?.onMessage, replayResult);

      yield {
        type: 'tool_result',
        data: replayResult,
      };

      return replayResult;
    } catch (error) {
      toolErrorCode = this.extractErrorCode(error) || 'TOOL_EXECUTION_FAILED';
      throw error;
    } finally {
      const toolLatencyMs = Date.now() - toolSpan.startedAt;
      await this.emitMetric(callbacks, {
        name: 'agent.tool.duration_ms',
        value: toolLatencyMs,
        unit: 'ms',
        timestamp: Date.now(),
        tags: {
          executionId: executionId || '',
          stepIndex,
          toolCallId: toolCall.id,
          cached: cachedHit ? 'true' : 'false',
          success: toolSucceeded ? 'true' : 'false',
        },
      });
      await this.endSpan(callbacks, toolSpan, {
        executionId,
        stepIndex,
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        latencyMs: toolLatencyMs,
        cached: cachedHit,
        errorCode: toolErrorCode,
      });
      this.logInfo('[Agent] tool.execute', {
        executionId,
        traceId: effectiveTraceId,
        spanId: toolSpan.spanId,
        parentSpanId: toolSpan.parentSpanId,
        stepIndex,
        toolCallId: toolCall.id,
        toolName: toolCall.function.name,
        latencyMs: toolLatencyMs,
        cached: cachedHit,
        errorCode: toolErrorCode,
      });
    }
  }

  private async *processToolCalls(
    toolCalls: ToolCall[],
    messages: Message[],
    stepIndex: number,
    callbacks?: AgentCallbacks,
    abortSignal?: AbortSignal,
    executionId?: string,
    traceId?: string,
    parentSpanId?: string,
    writeBufferSessions: Map<string, WriteBufferRuntime> = new Map()
  ): AsyncGenerator<StreamEvent, Message, unknown> {
    if (this.config.maxConcurrentToolCalls <= 1 || toolCalls.length <= 1) {
      for (const toolCall of toolCalls) {
        this.throwIfAborted(abortSignal);
        yield* this.emitProgress(executionId, stepIndex, 'tool', messages.length);

        const toolGen = this.executeTool(
          toolCall,
          stepIndex,
          callbacks,
          abortSignal,
          executionId,
          traceId,
          parentSpanId,
          writeBufferSessions
        );
        let resultMessage: Message | undefined;
        for (;;) {
          const next = await toolGen.next();
          if (next.done) {
            resultMessage = next.value;
            break;
          }
          yield next.value as StreamEvent;
        }

        if (resultMessage) {
          messages.push(resultMessage);
        }
      }

      const lastMessage = messages[messages.length - 1];
      return lastMessage;
    }

    const plans = toolCalls.map((toolCall) => ({
      toolCall,
      policy: this.resolveToolConcurrencyPolicy(toolCall),
    }));

    for (let i = 0; i < plans.length; i++) {
      this.throwIfAborted(abortSignal);
      yield* this.emitProgress(executionId, stepIndex, 'tool', messages.length);
    }

    const waves = this.buildExecutionWaves(plans);
    const allResults: Array<{ events: StreamEvent[]; message?: Message }> = [];
    for (const wave of waves) {
      this.throwIfAborted(abortSignal);
      if (wave.type === 'exclusive') {
        allResults.push(
          await this.executeToolTask(
            wave.plans[0].toolCall,
            stepIndex,
            callbacks,
            abortSignal,
            executionId,
            traceId,
            parentSpanId,
            writeBufferSessions
          )
        );
        continue;
      }

      const parallelResults = await this.runParallelWave(
        wave.plans,
        stepIndex,
        callbacks,
        abortSignal,
        executionId,
        traceId,
        parentSpanId,
        writeBufferSessions
      );
      allResults.push(...parallelResults);
    }

    for (const taskResult of allResults) {
      for (const event of taskResult.events) {
        yield event;
      }
      if (taskResult.message) {
        messages.push(taskResult.message);
      }
      this.throwIfAborted(abortSignal);
    }

    const lastMessage = messages[messages.length - 1];
    return lastMessage;
  }

  private resolveToolConcurrencyPolicy(toolCall: ToolCall): ToolConcurrencyPolicy {
    if (this.config.toolConcurrencyPolicyResolver) {
      return this.config.toolConcurrencyPolicyResolver(toolCall);
    }

    const manager = this.toolExecutor as ToolManager & {
      getConcurrencyPolicy?: (call: ToolCall) => ToolConcurrencyPolicy;
    };
    if (typeof manager.getConcurrencyPolicy === 'function') {
      return manager.getConcurrencyPolicy(toolCall);
    }

    return { mode: 'exclusive' };
  }

  private buildExecutionWaves(
    plans: Array<{ toolCall: ToolCall; policy: ToolConcurrencyPolicy }>
  ): Array<{
    type: 'exclusive' | 'parallel';
    plans: Array<{ toolCall: ToolCall; policy: ToolConcurrencyPolicy }>;
  }> {
    return buildToolExecutionWaves(plans);
  }

  private async runParallelWave(
    plans: Array<{ toolCall: ToolCall; policy: ToolConcurrencyPolicy }>,
    stepIndex: number,
    callbacks?: AgentCallbacks,
    abortSignal?: AbortSignal,
    executionId?: string,
    traceId?: string,
    parentSpanId?: string,
    writeBufferSessions: Map<string, WriteBufferRuntime> = new Map()
  ): Promise<Array<{ events: StreamEvent[]; message?: Message }>> {
    const tasks = plans.map((plan) => ({
      lockKey: plan.policy.lockKey,
      run: async () =>
        this.executeToolTask(
          plan.toolCall,
          stepIndex,
          callbacks,
          abortSignal,
          executionId,
          traceId,
          parentSpanId,
          writeBufferSessions
        ),
    }));
    return this.runWithConcurrencyAndLock(tasks, this.config.maxConcurrentToolCalls);
  }

  private async executeToolTask(
    toolCall: ToolCall,
    stepIndex: number,
    callbacks?: AgentCallbacks,
    abortSignal?: AbortSignal,
    executionId?: string,
    traceId?: string,
    parentSpanId?: string,
    writeBufferSessions: Map<string, WriteBufferRuntime> = new Map()
  ): Promise<{ events: StreamEvent[]; message?: Message }> {
    const events: StreamEvent[] = [];
    const toolGen = this.executeTool(
      toolCall,
      stepIndex,
      callbacks,
      abortSignal,
      executionId,
      traceId,
      parentSpanId,
      writeBufferSessions
    );
    let resultMessage: Message | undefined;
    for (;;) {
      const next = await toolGen.next();
      if (next.done) {
        resultMessage = next.value;
        break;
      }
      events.push(next.value as StreamEvent);
    }
    return {
      events,
      message: resultMessage,
    };
  }

  private async runWithConcurrencyAndLock<T>(
    tasks: Array<{ lockKey?: string; run: () => Promise<T> }>,
    limit: number
  ): Promise<T[]> {
    return runTasksWithConcurrencyAndLock(tasks, limit);
  }

  private async *yieldCheckpoint(
    executionId: string | undefined,
    stepIndex: number,
    lastMessage: Message | undefined,
    callbacks?: AgentCallbacks
  ): AsyncGenerator<StreamEvent, void, unknown> {
    const checkpoint = createCheckpoint(executionId, stepIndex, lastMessage?.messageId);
    await this.safeCallback(callbacks?.onCheckpoint, checkpoint);

    yield {
      type: 'checkpoint',
      data: checkpoint,
    };
  }

  private *yieldMaxRetriesError(): Generator<StreamEvent> {
    yield* this.yieldErrorEvent(new MaxRetriesError());
  }

  private *emitProgress(
    executionId: string | undefined,
    stepIndex: number,
    currentAction: 'llm' | 'tool',
    messageCount: number
  ): Generator<StreamEvent> {
    yield createProgressEvent(executionId, stepIndex, currentAction, messageCount);
  }

  private *yieldErrorEvent(error: AgentError): Generator<StreamEvent> {
    yield createErrorEvent(error);
  }

  private *yieldDoneEvent(
    stepIndex: number,
    finishReason: 'stop' | 'max_steps' = 'stop'
  ): Generator<StreamEvent> {
    yield createDoneEvent(stepIndex, finishReason);
  }

  private mergeLLMConfig(
    config: AgentInput['config'],
    tools?: AgentInput['tools'],
    abortSignal?: AbortSignal
  ): AgentInput['config'] {
    return mergeLLMRequestConfig(config, tools, abortSignal);
  }

  private resolveLLMTools(inputTools?: Tool[]): Tool[] | undefined {
    if (typeof inputTools !== 'undefined') {
      return inputTools;
    }

    const manager = this.toolExecutor as ToolManager & {
      getTools?: () => Array<{ toToolSchema?: () => unknown }>;
    };
    if (typeof manager.getTools !== 'function') {
      return undefined;
    }

    const schemas: Tool[] = [];
    for (const tool of manager.getTools()) {
      if (typeof tool.toToolSchema !== 'function') {
        continue;
      }
      const schema = tool.toToolSchema();
      schemas.push({
        type: schema.type,
        function: {
          name: schema.function.name,
          description: schema.function.description,
          parameters: (schema.function.parameters as Record<string, unknown> | undefined) || {},
        },
      });
    }

    return schemas.length > 0 ? schemas : undefined;
  }

  private async emitMetric(
    callbacks: AgentCallbacks | undefined,
    metric: Parameters<typeof pushMetric>[1]
  ): Promise<void> {
    await pushMetric(callbacks, metric, this.safeCallback.bind(this));
  }

  private async emitTrace(
    callbacks: AgentCallbacks | undefined,
    event: Parameters<typeof pushTrace>[1]
  ): Promise<void> {
    await pushTrace(callbacks, event, this.safeCallback.bind(this));
  }

  private async startSpan(
    callbacks: AgentCallbacks | undefined,
    traceId: string,
    name: string,
    parentSpanId?: string,
    attributes?: Record<string, unknown>
  ): Promise<SpanRuntime> {
    return beginSpan({
      callbacks,
      traceId,
      name,
      parentSpanId,
      attributes,
      createSpanId: () => generateId('span_'),
      emitTrace: async (cbs, event) => {
        await this.emitTrace(cbs, event);
      },
    });
  }

  private async endSpan(
    callbacks: AgentCallbacks | undefined,
    span: SpanRuntime,
    attributes?: Record<string, unknown>
  ): Promise<void> {
    await finishSpan({
      callbacks,
      span,
      attributes,
      emitTrace: async (cbs, event) => {
        await this.emitTrace(cbs, event);
      },
    });
  }

  private extractErrorCode(error: unknown): string | undefined {
    return parseErrorCode(error);
  }

  private createTimeoutBudgetState(input: AgentInput): TimeoutBudgetState | undefined {
    return createBudgetState({
      inputTimeoutBudgetMs: input.timeoutBudgetMs,
      configTimeoutBudgetMs: this.config.timeoutBudgetMs,
      inputLlmTimeoutRatio: input.llmTimeoutRatio,
      configLlmTimeoutRatio: this.config.llmTimeoutRatio,
    });
  }

  private createExecutionAbortScope(
    inputAbortSignal: AbortSignal | undefined,
    timeoutBudget: TimeoutBudgetState | undefined
  ): AbortScope {
    return createExecutionBudgetScope(inputAbortSignal, timeoutBudget);
  }

  private createStageAbortScope(
    baseSignal: AbortSignal | undefined,
    timeoutBudget: TimeoutBudgetState | undefined,
    stage: TimeoutStage
  ): AbortScope {
    return createStageBudgetScope(baseSignal, timeoutBudget, stage);
  }

  private timeoutBudgetErrorFromSignal(
    signal: AbortSignal | undefined
  ): TimeoutBudgetExceededError | undefined {
    return timeoutErrorFromAbortSignal(signal);
  }

  private normalizeTimeoutBudgetError(
    error: unknown,
    signal: AbortSignal | undefined
  ): TimeoutBudgetExceededError | undefined {
    return normalizeAbortTimeoutBudgetError(error, signal);
  }

  private throwIfAborted(signal?: AbortSignal): void {
    assertNotAborted(signal, ABORTED_MESSAGE);
  }

  private isAbortError(error: unknown): boolean {
    return isAbortErrorByMessage(error, ABORTED_MESSAGE);
  }

  private normalizeError(error: unknown): AgentError {
    return normalizeAgentError(error, ABORTED_MESSAGE);
  }

  private calculateRetryDelay(retryCount: number, error: Error): number {
    return calculateRetryDelayWithBackoff(retryCount, error, this.config.backoffConfig);
  }

  private async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    await sleepWithAbort(ms, signal, ABORTED_MESSAGE);
  }

  private logError(message: string, error: unknown, context?: Record<string, unknown>): void {
    writeErrorLog(this.logger, message, error, context);
  }

  private logInfo(message: string, context?: Record<string, unknown>, data?: unknown): void {
    writeInfoLog(this.logger, message, context, data);
  }

  private logWarn(message: string, context?: Record<string, unknown>, data?: unknown): void {
    writeWarnLog(this.logger, message, context, data);
  }

  private resolveToolResultSummary(
    toolCall: ToolCall,
    toolResult: ToolResult,
    toolOutput: string
  ): string {
    if (hasNonEmptyText(toolResult.summary)) {
      return toolResult.summary;
    }

    const toolName = toolCall.function.name;
    const subject = toolName === 'bash' ? 'Command' : toolName;

    if (toolResult.success) {
      if (hasNonEmptyText(toolOutput)) {
        return `${subject} completed successfully.`;
      }
      return `${subject} completed successfully with no output.`;
    }

    const errorMessage =
      toolResult.error?.message || (hasNonEmptyText(toolOutput) ? toolOutput : undefined);
    if (errorMessage) {
      return `${subject} failed: ${errorMessage}`;
    }
    return `${subject} failed.`;
  }

  private buildToolResultMetadata(
    record: ToolExecutionLedgerRecord
  ): Record<string, unknown> | undefined {
    const error: Record<string, unknown> = {};
    if (record.errorName) {
      error.name = record.errorName;
    }
    if (record.errorMessage) {
      error.message = record.errorMessage;
    }
    if (record.errorCode) {
      error.code = record.errorCode;
    }

    const toolResult: Record<string, unknown> = {
      success: record.success,
      summary: record.summary,
    };
    if (hasNonEmptyText(record.output)) {
      toolResult.output = record.output;
    }
    if (record.payload !== undefined) {
      toolResult.payload = record.payload;
    }
    if (record.metadata && Object.keys(record.metadata).length > 0) {
      toolResult.metadata = record.metadata;
    }
    if (Object.keys(error).length > 0) {
      toolResult.error = error;
    }

    return {
      toolResult,
    };
  }

  private createToolResultMessageFromLedger(
    toolCallId: string,
    record: ToolExecutionLedgerRecord
  ): Message {
    return buildToolResultMessage({
      toolCallId,
      content: hasNonEmptyText(record.output) ? record.output : record.summary,
      metadata: this.buildToolResultMetadata(record),
      createMessageId: () => generateId('msg_'),
    });
  }
}

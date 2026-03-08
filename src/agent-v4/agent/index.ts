import {
  Message,
  AgentInput,
  AgentCallbacks,
  CompactionInfo,
  ExecutionCheckpoint,
  StreamEvent,
  ErrorDecision,
  ToolDecision,
} from '../types';
import { ToolManager } from '../tool/tool-manager';
import {
  calculateBackoff,
  LLMProvider,
  LLMRequestMessage,
  LLMRetryableError,
  Tool,
  ToolCall,
} from '../../providers';
import { EventEmitter } from 'events';
import {
  AgentAbortedError,
  AgentError,
  ConfirmationTimeoutError,
  MaxRetriesError,
  UnknownError,
} from './error';
import type { AgentLogger } from './logger';
import { compact, estimateMessagesTokens } from './compaction';
import { LLMTool, ToolConcurrencyPolicy } from '../tool/types';
import type { BackoffConfig } from '../../providers';
import {
  appendContent,
  appendRawArgs,
  cleanupWriteBufferSessionFiles,
  createWriteBufferSession,
  loadWriteBufferSession,
  type WriteBufferSessionMeta,
} from './write-buffer';

function generateId(prefix: string): string {
  return `${prefix}${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
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
}

const DEFAULT_MAX_RETRY_COUNT = 20;
const DEFAULT_COMPACTION_TRIGGER_RATIO = 0.8;
const DEFAULT_COMPACTION_KEEP_MESSAGES = 20;
const DEFAULT_MAX_CONCURRENT_TOOL_CALLS = 1;
const ABORTED_MESSAGE = 'Operation aborted';
const WRITE_FILE_TOOL_NAME = 'write_file';

interface WriteBufferRuntime {
  session: WriteBufferSessionMeta;
  bufferedContentChars: number;
}

interface WriteFileProtocolPayload {
  ok: boolean;
  code:
    | 'OK'
    | 'WRITE_FILE_PARTIAL_BUFFERED'
    | 'WRITE_FILE_NEED_RESUME'
    | 'WRITE_FILE_FINALIZE_OK'
    | 'WRITE_FILE_CHECKSUM_MISMATCH';
  nextAction: 'resume' | 'finalize' | 'none';
}

export class StatelessAgent extends EventEmitter {
  private llmProvider: LLMProvider;
  private toolExecutor: ToolManager;
  private config: InternalAgentConfig;
  private logger: AgentLogger;
  private writeBufferSessions = new Map<string, WriteBufferRuntime>();
  constructor(llmProvider: LLMProvider, toolExecutor: ToolManager, config: AgentConfig) {
    super();
    this.llmProvider = llmProvider;
    this.toolExecutor = toolExecutor;
    this.logger = config.logger ?? {};
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
    };
  }

  private convertMessageToLLMMessage(message: Message): LLMRequestMessage {
    return {
      role: message.role,
      content: message.content,
      tool_call_id: message.tool_call_id,
      tool_calls: message.tool_calls,
      id: message.id,
      reasoning_content: message.reasoning_content,
    };
  }

  private needsCompaction(messages: Message[], tools?: Tool[]): boolean {
    if (!this.config.enableCompaction) {
      return false;
    }

    const maxTokens = this.llmProvider.getLLMMaxTokens();
    const maxOutputTokens = this.llmProvider.getMaxOutputTokens();
    const usableLimit = Math.max(1, maxTokens - maxOutputTokens);
    const threshold = usableLimit * this.config.compactionTriggerRatio;

    const llmTools = tools as unknown as LLMTool[] | undefined;
    const currentTokens = estimateMessagesTokens(messages, llmTools);

    return currentTokens >= threshold;
  }

  private async compactMessagesIfNeeded(messages: Message[], tools?: Tool[]): Promise<string[]> {
    if (!this.needsCompaction(messages, tools)) {
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
    const { messages: inputMessages, maxSteps = 100, abortSignal } = input;
    const messages = [...inputMessages];

    let stepIndex = 0;
    let retryCount = 0;

    while (stepIndex < maxSteps) {
      if (abortSignal?.aborted) {
        yield* this.yieldErrorEvent(new AgentAbortedError(ABORTED_MESSAGE));
        break;
      }

      if (retryCount >= this.config.maxRetryCount) {
        yield* this.yieldMaxRetriesError();
        break;
      }

      stepIndex++;

      try {
        this.throwIfAborted(abortSignal);
        const messageCountBeforeCompaction = messages.length;
        const removedMessageIds = await this.compactMessagesIfNeeded(messages, input.tools);
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

        yield* this.emitProgress(input.executionId, stepIndex, 'llm', messages.length);

        const llmGen = this.callLLMAndProcessStream(
          messages,
          this.mergeLLMConfig(input.config, abortSignal),
          abortSignal
        );
        let result = await llmGen.next();
        while (!result.done) {
          yield result.value;
          result = await llmGen.next();
        }
        this.throwIfAborted(abortSignal);

        const llmResult = result.value as { assistantMessage: Message; toolCalls: ToolCall[] };
        const assistantMessage = llmResult.assistantMessage;
        const toolCalls = llmResult.toolCalls;

        messages.push(assistantMessage);
        await this.safeCallback(callbacks?.onMessage, assistantMessage);

        if (toolCalls.length > 0) {
          yield* this.emitProgress(input.executionId, stepIndex, 'tool', messages.length);

          const toolGen = this.processToolCalls(
            toolCalls,
            messages,
            stepIndex,
            callbacks,
            abortSignal
          );
          let toolResult = await toolGen.next();
          while (!toolResult.done) {
            yield toolResult.value;
            toolResult = await toolGen.next();
          }

          const lastMessage = toolResult.value as Message | undefined;
          yield* this.yieldCheckpoint(input.executionId, stepIndex, lastMessage, callbacks);
          continue;
        }

        retryCount = 0;
        yield* this.yieldDoneEvent(stepIndex);
        break;
      } catch (error) {
        if (this.isAbortError(error) || abortSignal?.aborted) {
          yield* this.yieldErrorEvent(new AgentAbortedError(ABORTED_MESSAGE));
          break;
        }

        const normalizedError = this.normalizeError(error);
        const decision = await this.safeErrorCallback(callbacks?.onError, normalizedError);
        yield* this.yieldErrorEvent(normalizedError);

        if (!decision?.retry) {
          break;
        }

        retryCount++;
        if (retryCount < this.config.maxRetryCount) {
          const retryDelay = this.calculateRetryDelay(retryCount, error as Error);
          try {
            await this.sleep(retryDelay, abortSignal);
          } catch (sleepError) {
            if (this.isAbortError(sleepError) || abortSignal?.aborted) {
              yield* this.yieldErrorEvent(new AgentAbortedError(ABORTED_MESSAGE));
              break;
            }
            throw sleepError;
          }
        }
      }
    }
  }

  private async safeCallback<T>(
    callback: ((arg: T) => void | Promise<void>) | undefined,
    arg: T
  ): Promise<void> {
    if (!callback) return;
    try {
      await callback(arg);
    } catch (error) {
      this.logError('[Agent] Callback error:', error);
    }
  }

  private async safeErrorCallback(
    callback: ((error: Error) => ErrorDecision | void | Promise<ErrorDecision | void>) | undefined,
    error: Error
  ): Promise<ErrorDecision | undefined> {
    if (!callback) {
      return undefined;
    }
    try {
      const result = await callback(error);
      return result as ErrorDecision | undefined;
    } catch (err) {
      this.logError('[Agent] Error callback error:', err);
      return undefined;
    }
  }

  private async mergeToolCalls(
    existing: ToolCall[],
    newCalls: ToolCall[],
    messageId: string
  ): Promise<ToolCall[]> {
    const result = existing.map((call) => ({ ...call }));

    for (const newCall of newCalls) {
      const existingCall = result.find((c) => c.id === newCall.id);
      if (existingCall) {
        if (!existingCall.function.name && newCall.function.name) {
          existingCall.function.name = newCall.function.name;
        }
        existingCall.function.arguments += newCall.function.arguments;
        await this.bufferWriteFileToolCallChunk(existingCall, newCall.function.arguments, messageId);
      } else {
        result.push({ ...newCall });
        await this.bufferWriteFileToolCallChunk(newCall, newCall.function.arguments, messageId);
      }
    }
    return result;
  }

  private isWriteFileToolCall(toolCall: ToolCall): boolean {
    return toolCall.function.name?.trim() === WRITE_FILE_TOOL_NAME;
  }

  private extractWriteFileContentPrefix(argumentsText: string): string | null {
    const contentMarkerMatch = /"content"\s*:\s*"/.exec(argumentsText);
    if (!contentMarkerMatch || typeof contentMarkerMatch.index !== 'number') {
      return null;
    }

    let cursor = contentMarkerMatch.index + contentMarkerMatch[0].length;
    let output = '';

    while (cursor < argumentsText.length) {
      const ch = argumentsText[cursor];
      if (ch === '"') {
        return output;
      }

      if (ch !== '\\') {
        output += ch;
        cursor += 1;
        continue;
      }

      if (cursor + 1 >= argumentsText.length) {
        return output;
      }

      const esc = argumentsText[cursor + 1];
      if (esc === '"' || esc === '\\' || esc === '/') {
        output += esc;
        cursor += 2;
      } else if (esc === 'b') {
        output += '\b';
        cursor += 2;
      } else if (esc === 'f') {
        output += '\f';
        cursor += 2;
      } else if (esc === 'n') {
        output += '\n';
        cursor += 2;
      } else if (esc === 'r') {
        output += '\r';
        cursor += 2;
      } else if (esc === 't') {
        output += '\t';
        cursor += 2;
      } else if (esc === 'u') {
        const unicodeHex = argumentsText.slice(cursor + 2, cursor + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(unicodeHex)) {
          return output;
        }
        output += String.fromCharCode(parseInt(unicodeHex, 16));
        cursor += 6;
      } else {
        output += esc;
        cursor += 2;
      }
    }

    return output;
  }

  private async bufferWriteFileToolCallChunk(
    toolCall: ToolCall,
    argumentsChunk: string,
    messageId: string
  ): Promise<void> {
    if (!this.isWriteFileToolCall(toolCall)) {
      return;
    }

    try {
      let runtime = this.writeBufferSessions.get(toolCall.id);
      if (!runtime) {
        const session = await createWriteBufferSession({
          messageId,
          toolCallId: toolCall.id,
        });
        runtime = {
          session,
          bufferedContentChars: 0,
        };
        this.writeBufferSessions.set(toolCall.id, runtime);
      }

      if (argumentsChunk) {
        await appendRawArgs(runtime.session, argumentsChunk);
      }

      const decodedContentPrefix = this.extractWriteFileContentPrefix(toolCall.function.arguments);
      if (decodedContentPrefix === null) {
        return;
      }

      if (decodedContentPrefix.length <= runtime.bufferedContentChars) {
        return;
      }

      const contentDelta = decodedContentPrefix.slice(runtime.bufferedContentChars);
      await appendContent(runtime.session, contentDelta);
      runtime.bufferedContentChars = decodedContentPrefix.length;
    } catch (error) {
      this.logError('[Agent] Failed to buffer write_file tool chunk:', error);
    }
  }

  private async enrichWriteFileToolError(toolCall: ToolCall, content: string): Promise<string> {
    if (!this.isWriteFileToolCall(toolCall)) {
      return content;
    }
    const runtime = this.writeBufferSessions.get(toolCall.id);
    if (!runtime) {
      return JSON.stringify({
        ok: false,
        code: 'WRITE_FILE_NEED_RESUME',
        message: content,
        nextAction: 'resume',
      });
    }
    try {
      const meta = await loadWriteBufferSession(runtime.session.metaPath);
      return JSON.stringify({
        ok: false,
        code: 'WRITE_FILE_PARTIAL_BUFFERED',
        message: content,
        buffer: {
          bufferId: meta.bufferId,
          path: meta.targetPath || '',
          bufferedBytes: meta.contentBytes,
          maxChunkBytes: 32768,
        },
        nextAction: 'resume',
      });
    } catch {
      return JSON.stringify({
        ok: false,
        code: 'WRITE_FILE_NEED_RESUME',
        message: content,
        nextAction: 'resume',
      });
    }
  }

  private isWriteFileProtocolOutput(content: string | undefined): content is string {
    if (!content || content.trim().length === 0) {
      return false;
    }
    try {
      const parsed = JSON.parse(content) as Partial<WriteFileProtocolPayload>;
      if (!parsed || typeof parsed !== 'object') {
        return false;
      }
      return (
        typeof parsed.code === 'string' &&
        typeof parsed.ok === 'boolean' &&
        (parsed.nextAction === 'resume' ||
          parsed.nextAction === 'finalize' ||
          parsed.nextAction === 'none')
      );
    } catch {
      return false;
    }
  }

  private shouldEnrichWriteFileFailure(
    error: { name?: string } | undefined,
    output?: string
  ): boolean {
    if (this.isWriteFileProtocolOutput(output)) {
      return false;
    }
    const errorName = error?.name;
    return errorName === 'InvalidArgumentsError' || errorName === 'ToolValidationError';
  }

  private async cleanupWriteFileBufferIfNeeded(toolCall: ToolCall): Promise<void> {
    if (!this.isWriteFileToolCall(toolCall)) {
      return;
    }
    const runtime = this.writeBufferSessions.get(toolCall.id);
    if (!runtime) {
      return;
    }
    this.writeBufferSessions.delete(toolCall.id);
    await cleanupWriteBufferSessionFiles(runtime.session);
  }

  private async *callLLMAndProcessStream(
    messages: Message[],
    config: AgentInput['config'],
    abortSignal?: AbortSignal
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
          assistantMessage.messageId
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
    abortSignal?: AbortSignal
  ): AsyncGenerator<StreamEvent, Message, unknown> {
    this.throwIfAborted(abortSignal);
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

    const toolResult: Message = {
      messageId: generateId('msg_'),
      type: 'tool-result',
      role: 'tool',
      content: '',
      tool_call_id: toolCall.id,
      timestamp: Date.now(),
    };

    if (toolExecResult.success) {
      toolResult.content = toolExecResult.output || '';
      await this.cleanupWriteFileBufferIfNeeded(toolCall);
    } else {
      if (this.isWriteFileToolCall(toolCall)) {
        if (this.isWriteFileProtocolOutput(toolExecResult.output)) {
          toolResult.content = toolExecResult.output;
        } else if (this.shouldEnrichWriteFileFailure(toolExecResult.error, toolExecResult.output)) {
          const errorContent =
            toolExecResult.error?.message || toolExecResult.output || new UnknownError().message;
          toolResult.content = await this.enrichWriteFileToolError(toolCall, errorContent);
        } else {
          const errorContent =
            toolExecResult.error?.message || toolExecResult.output || new UnknownError().message;
          toolResult.content = errorContent;
        }
      } else {
        toolResult.content =
          toolExecResult.error?.message || toolExecResult.output || new UnknownError().message;
      }
    }

    await this.safeCallback(callbacks?.onMessage, toolResult);

    yield {
      type: 'tool_result',
      data: toolResult,
    };

    return toolResult;
  }

  private async *processToolCalls(
    toolCalls: ToolCall[],
    messages: Message[],
    stepIndex: number,
    callbacks?: AgentCallbacks,
    abortSignal?: AbortSignal
  ): AsyncGenerator<StreamEvent, Message, unknown> {
    if (this.config.maxConcurrentToolCalls <= 1 || toolCalls.length <= 1) {
      for (const toolCall of toolCalls) {
        this.throwIfAborted(abortSignal);
        yield {
          type: 'progress',
          data: {
            stepIndex,
            currentAction: 'tool',
            messageCount: messages.length,
          },
        };

        const toolGen = this.executeTool(toolCall, stepIndex, callbacks, abortSignal);
        let toolResult = await toolGen.next();
        while (!toolResult.done) {
          yield toolResult.value;
          toolResult = await toolGen.next();
        }

        const resultMessage = toolResult.value as Message;
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
      yield {
        type: 'progress',
        data: {
          stepIndex,
          currentAction: 'tool',
          messageCount: messages.length,
        },
      };
    }

    const waves = this.buildExecutionWaves(plans);
    const allResults: Array<{ events: StreamEvent[]; message?: Message }> = [];
    for (const wave of waves) {
      this.throwIfAborted(abortSignal);
      if (wave.type === 'exclusive') {
        allResults.push(
          await this.executeToolTask(wave.plans[0].toolCall, stepIndex, callbacks, abortSignal)
        );
        continue;
      }

      const parallelResults = await this.runParallelWave(wave.plans, stepIndex, callbacks, abortSignal);
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
    const waves: Array<{
      type: 'exclusive' | 'parallel';
      plans: Array<{ toolCall: ToolCall; policy: ToolConcurrencyPolicy }>;
    }> = [];
    let currentParallel: Array<{ toolCall: ToolCall; policy: ToolConcurrencyPolicy }> = [];

    const flushParallel = () => {
      if (currentParallel.length === 0) {
        return;
      }
      waves.push({ type: 'parallel', plans: currentParallel });
      currentParallel = [];
    };

    for (const plan of plans) {
      if (plan.policy.mode === 'exclusive') {
        flushParallel();
        waves.push({ type: 'exclusive', plans: [plan] });
      } else {
        currentParallel.push(plan);
      }
    }
    flushParallel();

    return waves;
  }

  private async runParallelWave(
    plans: Array<{ toolCall: ToolCall; policy: ToolConcurrencyPolicy }>,
    stepIndex: number,
    callbacks?: AgentCallbacks,
    abortSignal?: AbortSignal
  ): Promise<Array<{ events: StreamEvent[]; message?: Message }>> {
    const tasks = plans.map((plan) => ({
      lockKey: plan.policy.lockKey,
      run: async () => this.executeToolTask(plan.toolCall, stepIndex, callbacks, abortSignal),
    }));
    return this.runWithConcurrencyAndLock(tasks, this.config.maxConcurrentToolCalls);
  }

  private async executeToolTask(
    toolCall: ToolCall,
    stepIndex: number,
    callbacks?: AgentCallbacks,
    abortSignal?: AbortSignal
  ): Promise<{ events: StreamEvent[]; message?: Message }> {
    const events: StreamEvent[] = [];
    const toolGen = this.executeTool(toolCall, stepIndex, callbacks, abortSignal);
    let toolResult = await toolGen.next();
    while (!toolResult.done) {
      events.push(toolResult.value);
      toolResult = await toolGen.next();
    }
    return {
      events,
      message: toolResult.value as Message | undefined,
    };
  }

  private async runWithConcurrencyAndLock<T>(
    tasks: Array<{ lockKey?: string; run: () => Promise<T> }>,
    limit: number
  ): Promise<T[]> {
    if (tasks.length === 0) {
      return [];
    }

    const results: T[] = new Array(tasks.length);
    const pending = tasks.map((_, index) => index);
    const runningLocks = new Set<string>();
    let activeCount = 0;
    let settled = false;

    return new Promise<T[]>((resolve, reject) => {
      const tryStart = () => {
        while (activeCount < limit && pending.length > 0) {
          const nextPos = pending.findIndex((index) => {
            const lockKey = tasks[index].lockKey;
            return !lockKey || !runningLocks.has(lockKey);
          });
          if (nextPos === -1) {
            break;
          }

          const taskIndex = pending.splice(nextPos, 1)[0];
          const lockKey = tasks[taskIndex].lockKey;
          if (lockKey) {
            runningLocks.add(lockKey);
          }
          activeCount += 1;

          tasks[taskIndex]
            .run()
            .then((value) => {
              results[taskIndex] = value;
            })
            .catch((error) => {
              if (!settled) {
                settled = true;
                reject(error);
              }
            })
            .finally(() => {
              activeCount -= 1;
              if (lockKey) {
                runningLocks.delete(lockKey);
              }

              if (settled) {
                return;
              }
              if (pending.length === 0 && activeCount === 0) {
                settled = true;
                resolve(results);
                return;
              }
              tryStart();
            });
        }

      };

      tryStart();
    });
  }

  private async *yieldCheckpoint(
    executionId: string | undefined,
    stepIndex: number,
    lastMessage: Message | undefined,
    callbacks?: AgentCallbacks
  ): AsyncGenerator<StreamEvent, void, unknown> {
    const checkpoint: ExecutionCheckpoint = {
      executionId: executionId || '',
      stepIndex,
      lastMessageId: lastMessage?.messageId || '',
      lastMessageTime: Date.now(),
      canResume: true,
    };
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
    yield {
      type: 'progress',
      data: {
        executionId,
        stepIndex,
        currentAction,
        messageCount,
      },
    };
  }

  private *yieldErrorEvent(error: AgentError): Generator<StreamEvent> {
    yield {
      type: 'error',
      data: {
        name: error.name,
        code: error.code,
        errorCode: error.errorCode,
        category: error.category,
        retryable: error.retryable,
        httpStatus: error.httpStatus,
        message: error.message,
      },
    };
  }

  private *yieldDoneEvent(stepIndex: number): Generator<StreamEvent> {
    yield {
      type: 'done',
      data: {
        finishReason: 'stop',
        steps: stepIndex,
      },
    };
  }

  private mergeLLMConfig(
    config: AgentInput['config'],
    abortSignal?: AbortSignal
  ): AgentInput['config'] {
    if (!abortSignal) {
      return config;
    }
    return {
      ...(config || {}),
      abortSignal,
    };
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (!signal?.aborted) {
      return;
    }
    const error = new Error(ABORTED_MESSAGE);
    error.name = 'AbortError';
    throw error;
  }

  private isAbortError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }
    const abortError = error as { name?: string; message?: string };
    return abortError.name === 'AbortError' || abortError.message === ABORTED_MESSAGE;
  }

  private normalizeError(error: unknown): AgentError {
    if (error instanceof AgentError) {
      return error;
    }

    if (this.isAbortError(error)) {
      return new AgentAbortedError(ABORTED_MESSAGE);
    }

    if (error instanceof Error) {
      if (error.name === 'ConfirmationTimeoutError' || error.message === 'Confirmation timeout') {
        return new ConfirmationTimeoutError(error.message);
      }
      return new UnknownError(error.message || new UnknownError().message);
    }

    return new UnknownError();
  }

  private calculateRetryDelay(retryCount: number, error: Error): number {
    const retryAfterMs = error instanceof LLMRetryableError ? error.retryAfter : undefined;
    return calculateBackoff(retryCount - 1, retryAfterMs, this.config.backoffConfig);
  }

  private async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    if (ms <= 0) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        clearTimeout(timer);
        const err = new Error(ABORTED_MESSAGE);
        err.name = 'AbortError';
        reject(err);
      };

      const cleanup = () => {
        signal?.removeEventListener('abort', onAbort);
      };

      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, ms);

      if (signal) {
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  }

  private logError(message: string, error: unknown): void {
    this.logger.error?.(message, error);
  }
}

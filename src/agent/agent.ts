/**
 * Agent 核心类
 *
 * 综合了流式处理、状态管理、重试机制、工具调用、压缩等功能
 */

import type { LLMGenerateOptions, LLMRequestMessage, Chunk, Tool } from '../providers';
import {
  LLMError,
  LLMRetryableError,
  isRetryableError,
  isPermanentError,
  isAbortedError,
  calculateBackoff,
} from '../providers';
import type { AgentConfig, AgentStepResult, AgentResult, CompletionResult } from './types';
import type {
  Message,
  ToolResult,
  ToolCall,
  FinishReason,
  AgentLoopState,
  HookContext,
  ToolStreamEvent,
} from '../core/types';
import { AgentAbortedError, AgentMaxRetriesExceededError } from './errors';
import { createInitialState, mergeAgentConfig } from './state';
import { defaultCompletionDetector } from './completion';
import { compact, estimateMessagesTokens } from './compaction';
import {
  createPersistenceState,
  flushPendingMessages,
  getInProgressAssistantMessage,
  persistInProgressAssistantMessage,
  resetStreamPersistence,
  ensureInProgressAssistantMessage,
} from './persistence';
import type { ToolManager } from '../tool';
import { HookManager } from '../hook';
import type { Logger } from '../logger';
import { contentToText } from '../utils';

/**
 * Agent 核心类
 */
export class Agent {
  private config: ReturnType<typeof mergeAgentConfig>;
  private state: AgentLoopState;
  private messages: Message[] = [];
  private steps: AgentStepResult[] = [];
  private abortController?: AbortController;
  private sessionId: string;
  private toolManager: ToolManager;
  private currentTools?: Tool[];
  private hookManager: HookManager;
  private logger?: Logger;
  private persistenceState = createPersistenceState();
  private currentReasoningContent = '';

  constructor(config: AgentConfig) {
    this.config = mergeAgentConfig(config);
    this.state = createInitialState();
    this.sessionId = config.sessionId ?? crypto.randomUUID();
    this.toolManager = config.toolManager!;
    this.logger = config.logger;

    // 初始化 HookManager 并注册 plugins
    this.hookManager = new HookManager();
    if (config.plugins && config.plugins.length > 0) {
      this.hookManager.useMany(config.plugins);
    }
  }

  /**
   * 获取 Hook 上下文
   */
  private getHookContext(): HookContext {
    return {
      loopIndex: this.state.loopIndex,
      stepIndex: this.state.stepIndex,
      sessionId: this.sessionId,
      state: { ...this.state },
    };
  }

  /**
   * 获取会话 ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * 获取当前状态
   */
  getState(): Readonly<AgentLoopState> {
    return { ...this.state };
  }

  /**
   * 获取消息历史
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * 获取 LLM 格式的消息列表
   */
  getLLMMessages(): LLMRequestMessage[] {
    return this.messages.map((m) => {
      // 提取 LLM 需要的字段，忽略 Agent 内部字段
      const { role, content, name, tool_calls, tool_call_id, reasoning_content, id } = m;
      return {
        role,
        content,
        name,
        tool_calls,
        tool_call_id,
        reasoning_content,
        id,
      } as LLMRequestMessage;
    });
  }

  /**
   * 获取步骤结果
   */
  getSteps(): AgentStepResult[] {
    return [...this.steps];
  }

  /**
   * 获取工具管理器
   */
  getToolManager(): ToolManager | undefined {
    return this.toolManager;
  }

  /**
   * 中止 Agent 运行
   */
  abort(): void {
    this.state.aborted = true;
    this.abortController?.abort();
  }

  /**
   * 添加消息到历史
   */
  addMessage(message: Message): void {
    this.messages.push(message);
  }

  /**
   * 从存储恢复消息历史
   */
  async restoreMessages(): Promise<void> {
    if (!this.config.memoryManager) return;

    const contextMessages = this.config.memoryManager.getContextMessages(this.sessionId);
    if (contextMessages.length > 0) {
      this.messages = [...contextMessages];
    }
  }

  /**
   * 保存当前消息历史到存储
   */
  async saveMessages(startIndex = 0): Promise<void> {
    if (!this.config.memoryManager) return;
    if (startIndex < 0 || startIndex >= this.messages.length) {
      return;
    }

    const messagesToSave: Message[] = this.messages.slice(startIndex).map((msg) => ({
      ...msg,
      messageId: msg.messageId ?? crypto.randomUUID(),
    }));

    await this.config.memoryManager.addMessages(this.sessionId, messagesToSave);
  }

  /**
   * 清除当前会话的存储数据
   */
  async clearStorage(): Promise<void> {
    if (!this.config.memoryManager) return;
    await this.config.memoryManager.clearContext(this.sessionId);
  }
  /**
   * 检查是否需要压缩
   */
  private needsCompaction(): boolean {
    if (!this.config.enableCompaction || !this.config.memoryManager) {
      return false;
    }

    const threshold = this.config.compactionThreshold ?? 100000;
    const currentTokens = estimateMessagesTokens(this.messages, this.currentTools);

    return currentTokens > threshold;
  }

  /**
   * 执行压缩
   */
  private async performCompaction(): Promise<void> {
    if (!this.config.memoryManager || !this.config.enableCompaction) {
      return;
    }

    const keepMessagesNum = this.config.compactionKeepMessages ?? 10;
    const tokenCountBefore = estimateMessagesTokens(this.messages, this.currentTools);

    // 调用压缩函数
    const result = await compact(this.messages, {
      provider: this.config.provider,
      keepMessagesNum,
      language: this.config.summaryLanguage ?? 'English',
    });

    // 更新内存中的消息
    this.messages = result.messages;

    // 持久化压缩结果
    await this.config.memoryManager.applyCompaction(this.sessionId, {
      keepLastN: keepMessagesNum,
      summaryMessage: result.summaryMessage,
      removedMessageIds: result.removedMessageIds,
      reason: 'token_limit',
      tokenCountBefore,
      tokenCountAfter: estimateMessagesTokens(result.messages, this.currentTools),
    });
  }

  /**
   * 主运行方法
   */
  async run(
    userMessage: string | LLMRequestMessage,
    options?: LLMGenerateOptions
  ): Promise<AgentResult> {
    // 初始化
    this.state = createInitialState();
    this.steps = [];
    this.abortController = new AbortController();
    await this.applyConfigHooks();

    // 设置初始消息并接入 memory
    const userContent = typeof userMessage === 'string' ? userMessage : userMessage.content;
    const saveFromIndex = await this.prepareMessages(userContent);
    this.persistenceState.persistCursor = saveFromIndex;
    let runError: unknown;
    let runResult: AgentResult | undefined;

    try {
      await flushPendingMessages({
        state: this.persistenceState,
        messagesLength: this.messages.length,
        saveMessages: (startIndex) => this.saveMessages(startIndex),
      });
      this.logger?.info('[Agent] Starting run', { sessionId: this.sessionId });

      // 获取工具 schema（优先使用 toolManager）
      let tools = this.getToolsSchema(options?.tools);

      // 应用 tools hooks
      if (tools && tools.length > 0) {
        tools = await this.hookManager.executeToolsHooks(tools, this.getHookContext());
      }
      this.currentTools = tools;

      // 合并选项
      const mergedOptions: LLMGenerateOptions = {
        ...this.config.generateOptions,
        ...options,
        abortSignal: options?.abortSignal ?? this.abortController.signal,
        tools,
      };

      // 发出循环开始事件（通过 loop hooks）
      await this.hookManager.executeLoopHooks(
        { loopIndex: this.state.loopIndex, steps: 0 },
        this.getHookContext()
      );

      try {
        await this.runLoop(mergedOptions);
      } catch (error) {
        if (error instanceof AgentAbortedError || this.state.aborted) {
          this.logger?.warn('[Agent] Run aborted by user');
          // 发出停止事件
          await this.hookManager.executeStopHooks(
            { reason: 'user_abort', message: 'Agent was aborted by user' },
            this.getHookContext()
          );
        } else {
          throw error;
        }
      }

      // 发出循环完成事件
      await this.hookManager.executeLoopHooks(
        { loopIndex: this.state.loopIndex, steps: this.steps.length },
        this.getHookContext()
      );

      // 构建结果
      const completionResult = await this.evaluateCompletion();

      this.logger?.info('[Agent] Run completed', {
        reason: completionResult.reason,
        loops: this.state.loopIndex,
        steps: this.steps.length,
        totalTokens: this.state.totalUsage.total_tokens,
      });

      // 发出停止事件
      await this.hookManager.executeStopHooks(
        { reason: completionResult.reason, message: completionResult.message },
        this.getHookContext()
      );

      runResult = {
        text: this.state.currentText,
        messages: this.getLLMMessages(),
        steps: this.steps,
        totalUsage: this.state.totalUsage,
        completionReason: completionResult.reason,
        completionMessage: completionResult.message,
        loopCount: this.state.loopIndex,
      };
    } catch (error) {
      runError = error;
    }

    try {
      await flushPendingMessages({
        state: this.persistenceState,
        messagesLength: this.messages.length,
        saveMessages: (startIndex) => this.saveMessages(startIndex),
      });
    } catch (saveError) {
      this.logger?.error('[Agent] Failed to persist messages', saveError, {
        sessionId: this.sessionId,
        saveFromIndex: this.persistenceState.persistCursor,
      });
      if (!runError) {
        throw saveError;
      }
    }

    if (runError) {
      throw runError;
    }
    return runResult as AgentResult;
  }

  /**
   * 获取工具 Schema
   */
  private getToolsSchema(optionsTools?: Tool[]): Tool[] | undefined {
    // 如果传入了 optionsTools，使用它
    if (optionsTools) {
      return optionsTools;
    }

    // 使用 toolManager 的 schema
    const schema = this.toolManager!.toToolsSchema();
    return schema.length > 0 ? schema : undefined;
  }

  // ===========================================================================
  // 核心循环
  // ===========================================================================

  /**
   * 主循环
   */
  private async runLoop(options: LLMGenerateOptions): Promise<void> {
    // 使用状态变量控制循环，避免 while(true)
    const checkContinue = (): boolean => {
      return !this.state.aborted && this.canContinue();
    };

    while (checkContinue()) {
      // 1. 中止检测
      if (this.state.aborted) {
        throw new AgentAbortedError();
      }

      // 2. 完成检测
      const completion = await this.evaluateCompletion();
      if (completion.done) {
        return;
      }

      // 3. 检查是否需要压缩
      if (this.needsCompaction()) {
        this.logger?.info('[Agent] Starting compaction', {
          messageCount: this.messages.length,
          tokenEstimate: estimateMessagesTokens(this.messages, this.currentTools),
        });
        await this.performCompaction();
      }

      // 4. 重试检查和处理
      if (this.state.needsRetry) {
        const canContinue = await this.handleRetry();
        if (!canContinue) {
          return;
        }
      }

      // 5. 循环计数和限制检查
      this.state.loopIndex++;

      // 6. 执行步骤
      try {
        await this.executeStep(options);
        this.state.retryCount = 0;
        this.state.needsRetry = false;
        this.logger?.debug('[Agent] Step completed', {
          loopIndex: this.state.loopIndex,
          stepIndex: this.state.stepIndex,
          toolCalls: this.state.currentToolCalls.length,
        });
      } catch (error) {
        await this.handleLoopError(error as Error);
      }
    }
  }

  /**
   * 执行单步操作
   */
  private async executeStep(options: LLMGenerateOptions): Promise<void> {
    this.state.stepIndex++;
    this.state.currentText = '';
    this.currentReasoningContent = '';
    this.state.currentToolCalls = [];
    this.state.stepUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    resetStreamPersistence(this.persistenceState);

    const rawChunks: Chunk[] = [];
    let finishReason = null;

    try {
      // 转换为 LLM 格式发送给 Provider
      const llmMessages = this.getLLMMessages();
      const stream = this.config.provider.generateStream(llmMessages, options);

      for await (const chunk of stream) {
        if (this.state.aborted) {
          throw new AgentAbortedError();
        }

        rawChunks.push(chunk);
        await this.processStreamChunk(chunk);

        if (chunk.choices?.[0]?.finish_reason) {
          finishReason = chunk.choices[0].finish_reason;
        }
      }

      await this.finalizeStep(rawChunks, finishReason, options);
    } catch (error) {
      this.logger?.error('[Agent] Step error', error);
      throw error;
    }
  }

  /**
   * 处理流式数据块
   */
  private async processStreamChunk(chunk: Chunk): Promise<void> {
    const choice = chunk.choices?.[0];
    if (!choice) return;

    const delta = choice.delta;
    const ctx = this.getHookContext();
    const streamMessage = await ensureInProgressAssistantMessage({
      state: this.persistenceState,
      messages: this.messages,
      memoryManager: this.config.memoryManager,
      sessionId: this.sessionId,
      currentText: this.state.currentText,
      currentReasoningContent: this.currentReasoningContent,
      currentToolCalls: this.state.currentToolCalls,
      stepUsage: this.state.stepUsage,
      flushPending: async () =>
        flushPendingMessages({
          state: this.persistenceState,
          messagesLength: this.messages.length,
          saveMessages: (startIndex) => this.saveMessages(startIndex),
        }),
      logger: this.logger,
      stepIndex: this.state.stepIndex,
    });

    // 处理文本增量
    if (delta.content && typeof delta.content === 'string') {
      this.state.currentText += delta.content;
      await this.hookManager.executeTextDeltaHooks({ text: delta.content }, ctx);
    }

    // 处理推理内容
    if (delta.reasoning_content) {
      this.currentReasoningContent += delta.reasoning_content;
      await this.hookManager.executeTextDeltaHooks(
        { text: delta.reasoning_content, isReasoning: true },
        ctx
      );
    }

    // 处理工具调用
    if (delta.tool_calls) {
      for (const toolCall of delta.tool_calls) {
        await this.handleToolCallDelta(toolCall);
      }
    }

    // 处理 usage 信息
    if (chunk.usage) {
      this.state.stepUsage = { ...chunk.usage };
      this.state.totalUsage.prompt_tokens += chunk.usage.prompt_tokens;
      this.state.totalUsage.completion_tokens += chunk.usage.completion_tokens;
      this.state.totalUsage.total_tokens += chunk.usage.total_tokens;
    }

    if (streamMessage) {
      streamMessage.content = this.state.currentText;
      streamMessage.reasoning_content = this.currentReasoningContent || undefined;
      streamMessage.tool_calls =
        this.state.currentToolCalls.length > 0 ? [...this.state.currentToolCalls] : undefined;
      streamMessage.usage = { ...this.state.stepUsage };
    }

    // 处理错误
    if (chunk.error) {
      this.logger?.error('[Agent] Stream chunk error', chunk.error);
    }

    if (streamMessage) {
      try {
        await persistInProgressAssistantMessage({
          state: this.persistenceState,
          messages: this.messages,
          memoryManager: this.config.memoryManager,
          sessionId: this.sessionId,
        });
      } catch (error) {
        this.logger?.error('[Agent] Failed to persist stream progress', error, {
          sessionId: this.sessionId,
          stepIndex: this.state.stepIndex,
        });
      }
    }
  }

  /**
   * 处理工具调用增量
   */
  private async handleToolCallDelta(toolCall: ToolCall): Promise<void> {
    const index = Number.isFinite(toolCall?.index) ? toolCall.index : 0;
    const incomingId =
      typeof toolCall?.id === 'string' && toolCall.id.trim().length > 0 ? toolCall.id : '';
    const incomingName = typeof toolCall?.function?.name === 'string' ? toolCall.function.name : '';
    const incomingArguments =
      typeof toolCall?.function?.arguments === 'string' ? toolCall.function.arguments : '';

    const existing =
      (incomingId ? this.state.currentToolCalls.find((tc) => tc.id === incomingId) : undefined) ??
      this.state.currentToolCalls.find((tc) => tc.index === index);

    if (!existing) {
      this.state.currentToolCalls.push({
        id: incomingId || `tool_call_${this.state.stepIndex}_${index}`,
        type: toolCall?.type || 'function',
        index,
        function: {
          name: incomingName,
          arguments: incomingArguments,
        },
      });
      return;
    }

    if (incomingId && existing.id !== incomingId) {
      existing.id = incomingId;
    }
    if (incomingName) {
      existing.function.name = existing.function.name || incomingName;
    }
    if (incomingArguments) {
      existing.function.arguments += incomingArguments;
    }
  }

  /**
   * 完成步骤处理
   */
  private async finalizeStep(
    rawChunks: Chunk[],
    finishReason: FinishReason,
    _options: LLMGenerateOptions
  ): Promise<void> {
    const ctx = this.getHookContext();

    // 发送文本完成事件
    if (this.state.currentText) {
      await this.hookManager.executeTextCompleteHooks(this.state.currentText, ctx);
    }

    // 并发执行工具调用
    const toolResults: Array<{ toolCallId: string; result: ToolResult }> = [];

    if (this.state.currentToolCalls.length > 0) {
      this.logger?.info('[Agent] Executing tools', {
        count: this.state.currentToolCalls.length,
        tools: this.state.currentToolCalls.map((tc) => tc.function.name),
      });

      const context = {
        loopIndex: this.state.loopIndex,
        stepIndex: this.state.stepIndex,
        agent: this,
        agentContext: {
          sessionId: this.sessionId,
          loopIndex: this.state.loopIndex,
          stepIndex: this.state.stepIndex,
        },
      };

      // 应用 toolUse hooks
      const processedToolCalls: ToolCall[] = [];
      for (const toolCall of this.state.currentToolCalls) {
        const processed = await this.hookManager.executeToolUseHooks(toolCall, ctx);
        processedToolCalls.push(processed);
      }

      // 使用 toolManager 执行工具
      toolResults.push(
        ...(await this.toolManager!.executeTools(processedToolCalls, context, {
          onToolEvent: async (event) => {
            await this.handleToolStreamEvent(event, ctx);
          },
        }))
      );

      // 应用 toolResult hooks 并发送事件
      for (let i = 0; i < toolResults.length; i++) {
        const { toolCallId, result } = toolResults[i];
        const toolCall = processedToolCalls.find((tc) => tc.id === toolCallId);
        if (toolCall) {
          const processedResult = await this.hookManager.executeToolResultHooks(
            { toolCall, result },
            ctx
          );
          toolResults[i] = { toolCallId, result: processedResult.result };
        }
      }
    }

    // 记录步骤结果
    const stepResult: AgentStepResult = {
      text: this.state.currentText,
      toolCalls: [...this.state.currentToolCalls],
      toolResults,
      finishReason,
      usage: { ...this.state.stepUsage },
      rawChunks,
    };
    this.steps.push(stepResult);

    // 创建或更新 assistant 消息
    let assistantMessage = getInProgressAssistantMessage(this.messages, this.persistenceState);
    if (!assistantMessage) {
      assistantMessage = {
        messageId: crypto.randomUUID(),
        role: 'assistant',
        content: this.state.currentText || '',
        reasoning_content: this.currentReasoningContent || undefined,
        tool_calls:
          this.state.currentToolCalls.length > 0 ? [...this.state.currentToolCalls] : undefined,
        finish_reason: finishReason ?? undefined,
        usage: { ...this.state.stepUsage },
      };
      this.messages.push(assistantMessage);
    } else {
      assistantMessage.content = this.state.currentText || '';
      assistantMessage.reasoning_content = this.currentReasoningContent || undefined;
      assistantMessage.tool_calls =
        this.state.currentToolCalls.length > 0 ? [...this.state.currentToolCalls] : undefined;
      assistantMessage.finish_reason = finishReason ?? undefined;
      assistantMessage.usage = { ...this.state.stepUsage };
    }

    if (this.persistenceState.inProgressAssistantMessageId) {
      try {
        await persistInProgressAssistantMessage({
          state: this.persistenceState,
          messages: this.messages,
          memoryManager: this.config.memoryManager,
          sessionId: this.sessionId,
          force: true,
        });
      } catch (error) {
        this.logger?.error('[Agent] Failed to persist final stream state', error, {
          sessionId: this.sessionId,
          stepIndex: this.state.stepIndex,
        });
      }
    }

    // 添加工具结果消息
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
      this.messages.push(toolMessage);
    }

    // 发送步骤完成事件
    await this.hookManager.executeStepHooks(
      {
        stepIndex: this.state.stepIndex,
        finishReason: finishReason ?? undefined,
        toolCallsCount: this.state.currentToolCalls.length,
      },
      ctx
    );

    // 根据完成原因决定是否继续
    if (finishReason === 'stop' || finishReason === 'length') {
      this.state.resultStatus = 'stop';
    } else if (finishReason === 'tool_calls' && toolResults.length > 0) {
      this.state.resultStatus = 'continue';
    }

    resetStreamPersistence(this.persistenceState);
  }

  /**
   * 评估是否应该完成
   */
  private async evaluateCompletion(): Promise<CompletionResult> {
    // 1. 检查中止
    if (this.state.aborted) {
      return { done: true, reason: 'user_abort', message: 'Agent was aborted by user' };
    }

    // 2. 检查结果状态
    if (this.state.resultStatus === 'stop') {
      return { done: true, reason: 'stop', message: 'Agent completed normally' };
    }

    // 3. 使用自定义完成检测器
    if (this.config.completionDetector) {
      const lastStep = this.steps[this.steps.length - 1];
      const result = await this.config.completionDetector(
        this.state,
        this.getLLMMessages(),
        lastStep
      );
      if (result.done) {
        return result;
      }
    }

    // 4. 默认完成检测
    const defaultResult = defaultCompletionDetector(this.steps[this.steps.length - 1]);
    if (defaultResult.done) {
      return defaultResult;
    }

    // 5. 达到步骤上限（避免误判为 stop）
    if (!this.canContinue()) {
      const reachedStepLimit = this.state.stepIndex >= this.config.maxSteps;
      if (reachedStepLimit) {
        const message = `Reached maxSteps limit (${this.config.maxSteps}) before completion`;
        return { done: true, reason: 'limit_exceeded', message };
      }
    }

    return defaultResult;
  }

  private async handleToolStreamEvent(event: ToolStreamEvent, ctx: HookContext): Promise<void> {
    await this.hookManager.executeToolStreamHooks(event, ctx);

    const logContext: Record<string, unknown> = {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      eventType: event.type,
      sequence: event.sequence,
      timestamp: event.timestamp,
    };
    if (typeof event.content === 'string') {
      logContext['contentLength'] = event.content.length;
      logContext['contentPreview'] =
        event.content.length > 300 ? `${event.content.slice(0, 300)}...` : event.content;
    }
    if (event.data !== undefined) {
      logContext['data'] = event.data;
    }

    if (event.type === 'stderr' || event.type === 'error') {
      this.logger?.warn('[Agent] Tool stream event', logContext);
      return;
    }
    this.logger?.debug('[Agent] Tool stream event', logContext);
  }

  /**
   * 处理循环错误
   */
  private async handleLoopError(error: Error): Promise<void> {
    this.state.lastError = error;

    if (isPermanentError(error)) {
      throw error;
    }

    if (isAbortedError(error) || this.state.aborted) {
      throw new AgentAbortedError();
    }

    if (isRetryableError(error)) {
      this.state.needsRetry = true;
      return;
    }

    if (error instanceof LLMError) {
      this.state.needsRetry = true;
      return;
    }

    throw error;
  }

  /**
   * 处理重试
   */
  private async handleRetry(): Promise<boolean> {
    this.state.retryCount++;

    if (this.state.retryCount > this.config.maxRetries) {
      throw new AgentMaxRetriesExceededError(
        this.state.retryCount,
        this.state.lastError ?? new Error('Unknown error')
      );
    }

    const retryAfterMs =
      this.state.lastError instanceof LLMRetryableError
        ? this.state.lastError.retryAfter
        : undefined;

    const delay = calculateBackoff(
      this.state.retryCount - 1,
      retryAfterMs,
      this.config.backoffConfig
    );

    this.logger?.warn(`[Agent] Retry attempt ${this.state.retryCount} after ${delay}ms`);

    await this.sleep(delay, this.abortController?.signal);

    if (this.state.aborted) {
      throw new AgentAbortedError();
    }

    return true;
  }

  /**
   * 检查是否可以继续
   */
  private canContinue(): boolean {
    return this.state.stepIndex < this.config.maxSteps && !this.state.aborted;
  }

  // ===========================================================================
  // 工具方法
  // ===========================================================================

  /**
   * 构建初始消息
   */
  private async buildInitialMessages(
    userContent: string | LLMRequestMessage['content']
  ): Promise<Message[]> {
    const messages: Message[] = [];
    const ctx = this.getHookContext();

    // 应用 systemPrompt hooks
    if (this.config.systemPrompt) {
      let systemPrompt = this.config.systemPrompt;
      systemPrompt = await this.hookManager.executeSystemPromptHooks(systemPrompt, ctx);
      messages.push({
        messageId: crypto.randomUUID(),
        role: 'system',
        content: systemPrompt,
      });
    }

    messages.push(await this.buildUserMessage(userContent));

    return messages;
  }

  private async buildUserMessage(
    userContent: string | LLMRequestMessage['content']
  ): Promise<Message> {
    const ctx = this.getHookContext();
    let processedUserContent = userContent;
    if (typeof processedUserContent === 'string') {
      processedUserContent = await this.hookManager.executeUserPromptHooks(
        processedUserContent,
        ctx
      );
    }

    return {
      messageId: crypto.randomUUID(),
      role: 'user',
      content: processedUserContent,
    };
  }

  private async applyConfigHooks(): Promise<void> {
    const hookedConfig = await this.hookManager.executeConfigHooks<AgentConfig>(
      this.config as AgentConfig,
      this.getHookContext()
    );
    this.config = mergeAgentConfig(hookedConfig);
    this.toolManager = this.config.toolManager!;
    this.logger = this.config.logger;
    if (this.config.sessionId) {
      this.sessionId = this.config.sessionId;
    }
  }

  private async prepareMessages(
    userContent: string | LLMRequestMessage['content']
  ): Promise<number> {
    const memoryManager = this.config.memoryManager;
    if (!memoryManager) {
      this.messages = await this.buildInitialMessages(userContent);
      return 0;
    }

    await memoryManager.initialize();
    const existingSession = memoryManager.getSession(this.sessionId);

    if (existingSession) {
      await this.restoreMessages();
      if (this.messages.length === 0 && existingSession.systemPrompt) {
        // 已有 session 但 context 为空时，按 session 元信息恢复 system，避免重复写入 system 消息
        this.messages = [
          {
            messageId: crypto.randomUUID(),
            role: 'system',
            content: existingSession.systemPrompt,
          },
        ];
      }

      const saveFromIndex = this.messages.length;
      this.messages.push(await this.buildUserMessage(userContent));
      return saveFromIndex;
    }

    this.messages = await this.buildInitialMessages(userContent);
    await memoryManager.createSession(this.sessionId, this.extractSystemPrompt(this.messages));
    const firstNonSystemIndex = this.messages.findIndex((message) => message.role !== 'system');
    if (firstNonSystemIndex === -1) {
      return this.messages.length;
    }
    return firstNonSystemIndex;
  }

  private extractSystemPrompt(messages: Message[]): string {
    const systemMessage = messages.find((message) => message.role === 'system');
    if (!systemMessage) return '';
    return contentToText(systemMessage.content);
  }

  /**
   * 异步休眠（支持中止）
   */
  private async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);

      if (signal) {
        const onAbort = () => {
          clearTimeout(timer);
          reject(new AgentAbortedError());
        };

        if (signal.aborted) {
          clearTimeout(timer);
          reject(new AgentAbortedError());
        } else {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }
    });
  }
}

/**
 * 创建 Agent 实例
 */
export function createAgent(config: AgentConfig): Agent {
  return new Agent(config);
}

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
import type {
  AgentConfig,
  AgentLoopState,
  AgentEvent,
  AgentStepResult,
  AgentResult,
  CompletionResult,
  ToolResult,
  ToolCall,
  FinishReason,
} from './types';
import type { Message } from './types';
import { AgentLoopExceededError, AgentAbortedError, AgentMaxRetriesExceededError } from './errors';
import { createInitialState, mergeAgentConfig } from './state';
import { defaultCompletionDetector } from './completion';
import { compact, estimateMessagesTokens } from './compaction';
import type { ToolManager } from '../tool';

// =============================================================================
// Agent 类
// =============================================================================

/**
 * Agent 核心类
 */
export class Agent {
  private readonly config: ReturnType<typeof mergeAgentConfig>;
  private state: AgentLoopState;
  private messages: Message[] = [];
  private steps: AgentStepResult[] = [];
  private abortController?: AbortController;
  private sessionId: string;
  private toolManager: ToolManager;
  private currentTools?: Tool[];

  constructor(config: AgentConfig) {
    this.config = mergeAgentConfig(config);
    this.state = createInitialState();
    this.sessionId = config.sessionId ?? crypto.randomUUID();
    this.toolManager = config.toolManager!;
  }

  // ===========================================================================
  // 公共 API
  // ===========================================================================

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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { messageId, type, finish_reason, usage, ...llmMsg } = m;
      return llmMsg as LLMRequestMessage;
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

  // ===========================================================================
  // 消息存储
  // ===========================================================================

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
  async saveMessages(): Promise<void> {
    if (!this.config.memoryManager) return;

    const messagesToSave: Message[] = this.messages.map((msg, index) => ({
      ...msg,
      messageId: msg.messageId ?? crypto.randomUUID(),
      usage: index === this.messages.length - 1 ? this.state.totalUsage : msg.usage,
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

  // ===========================================================================
  // 压缩功能
  // ===========================================================================

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

    // 发出压缩事件
    await this.emitEvent('compaction', {
      messagesBefore: tokenCountBefore,
      messagesAfter: estimateMessagesTokens(this.messages, this.currentTools),
      removedCount: result.removedMessageIds.length,
    });
  }

  // ===========================================================================
  // 主运行方法
  // ===========================================================================

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

    // 设置初始消息
    if (typeof userMessage === 'string') {
      this.messages = this.buildInitialMessages(userMessage);
    } else {
      this.messages = this.buildInitialMessages(userMessage.content);
    }

    // 获取工具 schema（优先使用 toolManager）
    const tools = this.getToolsSchema(options?.tools);
    this.currentTools = tools;

    // 合并选项
    const mergedOptions: LLMGenerateOptions = {
      ...this.config.generateOptions,
      ...options,
      abortSignal: options?.abortSignal ?? this.abortController.signal,
      tools,
    };

    // 发出循环开始事件
    await this.emitEvent('loop-start', { messages: this.getLLMMessages() });

    try {
      await this.runLoop(mergedOptions);
    } catch (error) {
      if (error instanceof AgentAbortedError || this.state.aborted) {
        await this.emitEvent('abort', { reason: 'user_abort' });
      } else {
        throw error;
      }
    }

    // 发出循环完成事件
    await this.emitEvent('loop-complete', {
      steps: this.steps.length,
      usage: this.state.totalUsage,
    });

    // 构建结果
    const completionResult = await this.evaluateCompletion();

    return {
      text: this.state.currentText,
      messages: this.getLLMMessages(),
      steps: this.steps,
      totalUsage: this.state.totalUsage,
      completionReason: completionResult.reason,
      completionMessage: completionResult.message,
      loopCount: this.state.loopIndex,
    };
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
    // eslint-disable-next-line no-constant-condition
    while (true) {
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
        await this.performCompaction();
      }

      // 4. 重试检查和处理
      if (this.state.needsRetry) {
        const shouldContinue = await this.handleRetry();
        if (!shouldContinue) {
          return;
        }
      }

      // 5. 循环计数和限制检查
      this.state.loopIndex++;
      if (!this.canContinue()) {
        throw new AgentLoopExceededError(this.config.maxLoops, this.state.loopIndex);
      }

      // 6. 执行步骤
      try {
        await this.executeStep(options);
        this.state.retryCount = 0;
        this.state.needsRetry = false;
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
    this.state.currentToolCalls = [];
    this.state.stepUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    await this.emitEvent('step-start', { stepIndex: this.state.stepIndex });

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
      await this.emitEvent('error', { error });
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

    // 处理文本增量
    if (delta.content && typeof delta.content === 'string') {
      this.state.currentText += delta.content;
      await this.emitEvent('text-delta', { text: delta.content });
    }

    // 处理推理内容
    if (delta.reasoning_content) {
      await this.emitEvent('text-delta', {
        text: delta.reasoning_content,
        isReasoning: true,
      });
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
      await this.emitEvent('usage', { usage: chunk.usage });
    }

    // 处理错误
    if (chunk.error) {
      await this.emitEvent('error', { error: chunk.error });
    }
  }

  /**
   * 处理工具调用增量
   */
  private async handleToolCallDelta(toolCall: ToolCall): Promise<void> {
    const existing = this.state.currentToolCalls.find((tc) => tc.id === toolCall.id);

    if (!existing) {
      this.state.currentToolCalls.push(toolCall);
      await this.emitEvent('tool-call', { toolCall, index: toolCall.index });
    } else {
      if (toolCall.function.arguments) {
        existing.function.arguments += toolCall.function.arguments;
      }
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
    // 发送文本完成事件
    if (this.state.currentText) {
      await this.emitEvent('text-complete', { text: this.state.currentText });
    }

    // 并发执行工具调用
    const toolResults: Array<{ toolCallId: string; result: ToolResult }> = [];

    if (this.state.currentToolCalls.length > 0) {
      const context = {
        loopIndex: this.state.loopIndex,
        stepIndex: this.state.stepIndex,
        agent: this,
      };

      // 使用 toolManager 执行工具
      toolResults.push(
        ...(await this.toolManager!.executeTools(this.state.currentToolCalls, context))
      );

      // 发送工具结果事件
      for (const { toolCallId, result } of toolResults) {
        const toolCall = this.state.currentToolCalls.find((tc) => tc.id === toolCallId);
        if (toolCall) {
          await this.emitEvent('tool-result', { toolCall, result });
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

    // 创建 assistant 消息
    const assistantMessage: Message = {
      messageId: crypto.randomUUID(),
      role: 'assistant',
      content: this.state.currentText || '',
      tool_calls: this.state.currentToolCalls.length > 0 ? this.state.currentToolCalls : undefined,
      finish_reason: finishReason ?? undefined,
      usage: { ...this.state.stepUsage },
    };
    this.messages.push(assistantMessage);

    // 添加工具结果消息
    for (const { toolCallId, result } of toolResults) {
      const toolMessage: Message = {
        messageId: crypto.randomUUID(),
        role: 'tool',
        content: JSON.stringify(result.data ?? { error: result.error }),
        tool_call_id: toolCallId,
      };
      this.messages.push(toolMessage);
    }

    // 发送步骤完成事件
    await this.emitEvent('step-complete', {
      stepIndex: this.state.stepIndex,
      finishReason,
      toolCallsCount: this.state.currentToolCalls.length,
    });

    // 根据完成原因决定是否继续
    if (finishReason === 'stop' || finishReason === 'length') {
      this.state.resultStatus = 'stop';
    } else if (finishReason === 'tool_calls' && toolResults.length > 0) {
      this.state.resultStatus = 'continue';
    }
  }

  // ===========================================================================
  // 完成检测
  // ===========================================================================

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
    return defaultCompletionDetector(this.steps[this.steps.length - 1]);
  }

  // ===========================================================================
  // 错误处理与重试
  // ===========================================================================

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

    await this.emitEvent('retry', {
      attempt: this.state.retryCount,
      delay,
      error: this.state.lastError,
    });

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
    return (
      this.state.loopIndex < this.config.maxLoops &&
      this.state.stepIndex < this.config.maxSteps &&
      !this.state.aborted
    );
  }

  // ===========================================================================
  // 工具方法
  // ===========================================================================

  /**
   * 构建初始消息
   */
  private buildInitialMessages(userContent: string | LLMRequestMessage['content']): Message[] {
    const messages: Message[] = [];

    if (this.config.systemPrompt) {
      messages.push({
        messageId: crypto.randomUUID(),
        role: 'system',
        content: this.config.systemPrompt,
      });
    }

    messages.push({
      messageId: crypto.randomUUID(),
      role: 'user',
      content: userContent,
    });

    return messages;
  }

  /**
   * 发出事件
   */
  private async emitEvent(type: AgentEvent['type'], data?: unknown): Promise<void> {
    if (!this.config.onEvent) return;

    const event: AgentEvent = {
      type,
      data,
      timestamp: Date.now(),
      loopIndex: this.state.loopIndex,
      stepIndex: this.state.stepIndex,
    };

    try {
      await this.config.onEvent(event);
    } catch (error) {
      if (this.config.debug) {
        console.error('[Agent] Event callback error:', error);
      }
    }
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

// =============================================================================
// 便捷函数
// =============================================================================

/**
 * 创建 Agent 实例
 */
export function createAgent(config: AgentConfig): Agent {
  return new Agent(config);
}

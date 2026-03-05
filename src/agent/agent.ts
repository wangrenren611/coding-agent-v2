/**
 * Agent 核心类
 *
 * 综合了流式处理、状态管理、重试机制、工具调用、压缩等功能
 */

import type { LLMGenerateOptions, LLMRequestMessage, Tool } from '../providers';
import { LLMRetryableError, calculateBackoff } from '../providers';
import type { AgentConfig, AgentStepResult, AgentResult, CompletionResult } from './types';
import type { Message, AgentLoopState, HookContext, ToolStreamEvent } from '../core/types';
import { AgentAbortedError, AgentMaxRetriesExceededError } from './errors';
import { createInitialState, mergeAgentConfig } from './state';
import { defaultCompletionDetector } from './completion';
import { compact, estimateMessagesTokens } from './compaction';
import { classifyLoopError } from './runtime/utils';
import { executeAgentStep } from './runtime/step-runner';
import {
  buildInitialMessages as buildInitialAgentMessages,
  buildUserMessage as buildAgentUserMessage,
  ensureSystemMessageForExistingSession as ensureSystemMessageForExistingSessionUtil,
  prepareMessagesForRun,
} from './runtime/message-builder';
import { createPersistenceState, flushPendingMessages } from './persistence';
import type { ToolManager } from '../tool';
import { HookManager } from '../hook';
import type { Logger } from '../logger';

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
    this.toolManager = this.requireToolManager(config.toolManager);
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
  getToolManager(): ToolManager {
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
      await this.flushPendingMessagesWithRetry('pre_run');
      this.logger?.info('[Agent] Starting run', { sessionId: this.sessionId });

      // 获取工具 schema（优先使用 toolManager）
      const toolsPinned = options?.tools !== undefined;
      const tools = await this.resolveTools(options?.tools);
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
        await this.runLoop(mergedOptions, toolsPinned);
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
      await this.flushPendingMessagesWithRetry('post_run');
    } catch (saveError) {
      this.logger?.error('[Agent] Failed to persist messages', saveError, {
        sessionId: this.sessionId,
        saveFromIndex: this.persistenceState.persistCursor,
      });
      if (!runError) {
        throw saveError;
      }
      this.logger?.error('[Agent] Persistence failed after run error', saveError, {
        sessionId: this.sessionId,
      });
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
    const schema = this.toolManager.toToolsSchema();
    return schema.length > 0 ? schema : undefined;
  }

  private async resolveTools(optionsTools?: Tool[]): Promise<Tool[] | undefined> {
    let tools = this.getToolsSchema(optionsTools);
    if (tools && tools.length > 0) {
      tools = await this.hookManager.executeToolsHooks(tools, this.getHookContext());
    }
    return tools;
  }

  // ===========================================================================
  // 核心循环
  // ===========================================================================

  /**
   * 主循环
   */
  private async runLoop(options: LLMGenerateOptions, toolsPinned: boolean): Promise<void> {
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
        this.state.loopIndex++;
        this.logger?.info('[Agent] Starting compaction', {
          messageCount: this.messages.length,
          tokenEstimate: estimateMessagesTokens(this.messages, this.currentTools),
        });
        await this.performCompaction();
        await this.refreshToolsAfterCompaction(options, toolsPinned);
        continue;
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
    await executeAgentStep(
      {
        state: this.state,
        messages: this.messages,
        steps: this.steps,
        persistenceState: this.persistenceState,
        sessionId: this.sessionId,
        toolManager: this.toolManager,
        hookManager: this.hookManager,
        logger: this.logger,
        config: {
          provider: this.config.provider,
          memoryManager: this.config.memoryManager,
          onToolConfirm: this.config.onToolConfirm,
        },
        getHookContext: () => this.getHookContext(),
        getLLMMessages: () => this.getLLMMessages(),
        saveMessages: (startIndex) => this.saveMessages(startIndex),
        agentRef: this,
        getCurrentReasoningContent: () => this.currentReasoningContent,
        setCurrentReasoningContent: (value) => {
          this.currentReasoningContent = value;
        },
        handleToolStreamEvent: (event, ctx) => this.handleToolStreamEvent(event, ctx),
      },
      options
    );
  }

  /**
   * 评估是否应该完成
   */
  private async evaluateCompletion(): Promise<CompletionResult> {
    const lastStep = this.steps[this.steps.length - 1];

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
      const result = await this.config.completionDetector(
        this.state,
        this.getLLMMessages(),
        lastStep
      );
      if (result.done || !this.config.useDefaultCompletionDetector) {
        return result;
      }
    }

    // 4. 默认完成检测
    const defaultResult = this.config.useDefaultCompletionDetector
      ? defaultCompletionDetector(lastStep)
      : { done: false, reason: 'stop' as const };
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
    const disposition = classifyLoopError(error, this.state.aborted);

    switch (disposition) {
      case 'throw_permanent':
        throw error;
      case 'abort':
        throw new AgentAbortedError();
      case 'retry':
        this.logger?.warn('[Agent] LLM error detected, scheduling retry', {
          loopIndex: this.state.loopIndex,
          stepIndex: this.state.stepIndex,
          errorName: error.name,
          errorMessage: error.message,
        });
        this.state.needsRetry = true;
        return;
      case 'throw_unknown':
      default:
        this.logger?.error('[Agent] Non-retryable loop error', error, {
          loopIndex: this.state.loopIndex,
          stepIndex: this.state.stepIndex,
        });
        throw error;
    }
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
    return buildInitialAgentMessages({
      systemPrompt: this.config.systemPrompt,
      userContent,
      hookManager: this.hookManager,
      getHookContext: () => this.getHookContext(),
      createMessageId: () => crypto.randomUUID(),
    });
  }

  private async buildUserMessage(
    userContent: string | LLMRequestMessage['content']
  ): Promise<Message> {
    return buildAgentUserMessage({
      userContent,
      hookManager: this.hookManager,
      getHookContext: () => this.getHookContext(),
      createMessageId: () => crypto.randomUUID(),
    });
  }

  private async applyConfigHooks(): Promise<void> {
    const hookedConfig = await this.hookManager.executeConfigHooks<AgentConfig>(
      this.config as AgentConfig,
      this.getHookContext()
    );
    this.config = mergeAgentConfig(hookedConfig);
    this.toolManager = this.requireToolManager(this.config.toolManager);
    this.logger = this.config.logger;
    if (this.config.sessionId) {
      this.sessionId = this.config.sessionId;
    }
  }

  private async prepareMessages(
    userContent: string | LLMRequestMessage['content']
  ): Promise<number> {
    const prepared = await prepareMessagesForRun({
      memoryManager: this.config.memoryManager,
      sessionId: this.sessionId,
      userContent,
      buildInitialMessages: (content) => this.buildInitialMessages(content),
      buildUserMessage: (content) => this.buildUserMessage(content),
      restoreMessages: async () => {
        await this.restoreMessages();
        return [...this.messages];
      },
      ensureSystemMessageForExistingSession: (messages, existingSessionPrompt) =>
        this.ensureSystemMessageForExistingSession(messages, existingSessionPrompt),
    });
    this.messages = prepared.messages;
    return prepared.saveFromIndex;
  }

  private async ensureSystemMessageForExistingSession(
    messages: Message[],
    existingSessionPrompt?: string
  ): Promise<Message[]> {
    return ensureSystemMessageForExistingSessionUtil({
      messages,
      existingSessionPrompt,
      systemPrompt: this.config.systemPrompt,
      hookManager: this.hookManager,
      getHookContext: () => this.getHookContext(),
      createMessageId: () => crypto.randomUUID(),
    });
  }

  private requireToolManager(toolManager?: ToolManager): ToolManager {
    if (!toolManager) {
      throw new Error('[Agent] toolManager is required');
    }
    return toolManager;
  }

  private async flushPendingMessagesWithRetry(
    stage: 'pre_run' | 'post_run',
    maxAttempts = 3
  ): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await flushPendingMessages({
          state: this.persistenceState,
          messagesLength: this.messages.length,
          saveMessages: (startIndex) => this.saveMessages(startIndex),
        });
        return;
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts) {
          break;
        }
        const delay = Math.min(100 * Math.pow(2, attempt - 1), 500);
        this.logger?.warn('[Agent] Message persistence failed, retrying', {
          stage,
          attempt,
          nextRetryDelayMs: delay,
          sessionId: this.sessionId,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  private async refreshToolsAfterCompaction(
    options: LLMGenerateOptions,
    toolsPinned: boolean
  ): Promise<void> {
    if (toolsPinned) {
      this.currentTools = options.tools;
      return;
    }

    const refreshedTools = await this.resolveTools();
    this.currentTools = refreshedTools;
    options.tools = refreshedTools;
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

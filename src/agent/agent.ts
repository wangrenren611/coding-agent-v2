/**
 * Agent 核心类
 *
 * 这是整个 Agent 系统的核心实现，负责协调 AI 模型与工具之间的交互。
 *
 * 主要功能模块：
 * 1. **流式处理** - 支持 LLM 响应的流式输出，实时处理文本块
 * 2. **状态管理** - 维护循环计数、步骤索引、token 使用量等运行状态
 * 3. **重试机制** - 内置指数退避重试，处理 LLM API 临时故障
 * 4. **工具调用** - 支持函数调用/工具使用，包含确认机制
 * 5. **消息压缩** - 当上下文超过阈值时自动压缩历史消息
 * 6. **持久化** - 支持会话消息的存储和恢复
 * 7. **Hook 系统** - 提供生命周期钩子，支持插件扩展
 *
 * 典型使用流程：
 * ```typescript
 * const agent = new Agent({
 *   provider: llmProvider,
 *   toolManager: toolManager,
 *   systemPrompt: '你是一个助手'
 * });
 *
 * const result = await agent.run('请帮我分析这段代码');
 * console.log(result.text);
 * ```
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
 *
 * 负责管理 AI Agent 的完整生命周期，包括初始化、运行、状态维护和结果返回。
 * 采用 Agent-Loop 模式，通过多轮对话与工具调用完成任务。
 */
export class Agent {
  /** 合并后的 Agent 配置，包含默认值和用户配置 */
  private config: ReturnType<typeof mergeAgentConfig>;
  /** 当前运行状态，包含循环索引、步骤索引、token 使用量等 */
  private state: AgentLoopState;
  /** 消息历史记录，包含系统消息、用户消息、助手消息和工具调用结果 */
  private messages: Message[] = [];
  /** 已完成的步骤结果列表，每个步骤代表一次 LLM 调用和可能的工具执行 */
  private steps: AgentStepResult[] = [];
  /** AbortController 实例，用于支持取消正在进行的请求 */
  private abortController?: AbortController;
  /** 当前会话的唯一标识符，用于消息持久化和会话恢复 */
  private sessionId: string;
  /** 工具管理器，负责工具的注册、查找和执行 */
  private toolManager: ToolManager;
  /** 当前可用的工具列表（schema 格式），用于 LLM 工具调用 */
  private currentTools?: Tool[];
  /** Hook 管理器，负责执行生命周期钩子和插件逻辑 */
  private hookManager: HookManager;
  /** 可选的日志记录器，用于调试和监控 */
  private logger?: Logger;
  /** 消息持久化状态，追踪待保存的消息索引 */
  private persistenceState = createPersistenceState();
  /** 当前推理内容缓冲区，用于支持 Chain-of-Thought 推理模型 */
  private currentReasoningContent = '';

  /**
   * Agent 构造函数
   *
   * 初始化 Agent 实例，设置配置、状态、工具管理器和 Hook 系统。
   *
   * @param config - Agent 配置对象
   *   - provider: LLM 提供者实例
   *   - toolManager: 工具管理器实例（必需）
   *   - systemPrompt: 系统提示词
   *   - sessionId: 可选的会话 ID，不提供则自动生成
   *   - plugins: 可选的插件数组，用于扩展 Agent 行为
   *   - logger: 可选的日志记录器
   *
   * @example
   * ```typescript
   * const agent = new Agent({
   *   provider: new OpenAIProvider({ apiKey: '...' }),
   *   toolManager: myToolManager,
   *   systemPrompt: '你是一个代码助手',
   *   plugins: [loggingPlugin, rateLimitPlugin]
   * });
   * ```
   */
  constructor(config: AgentConfig) {
    // 合并用户配置与默认配置
    this.config = mergeAgentConfig(config);
    // 初始化运行状态
    this.state = createInitialState();
    // 设置会话 ID（使用提供的或生成新的 UUID）
    this.sessionId = config.sessionId ?? crypto.randomUUID();
    // 验证并设置工具管理器
    this.toolManager = this.requireToolManager(config.toolManager);
    this.logger = config.logger;

    // 初始化 HookManager 并注册插件
    this.hookManager = new HookManager();
    if (config.plugins && config.plugins.length > 0) {
      // 批量注册所有插件
      this.hookManager.useMany(config.plugins);
    }
  }

  /**
   * 获取 Hook 上下文
   *
   * 创建一个包含当前 Agent 状态的上下文对象，传递给 Hook 函数。
   * 这使得插件能够访问和修改 Agent 的运行时状态。
   *
   * @returns Hook 上下文对象，包含：
   *   - loopIndex: 当前循环索引
   *   - stepIndex: 当前步骤索引
   *   - sessionId: 会话 ID
   *   - state: 完整的 Agent 状态副本
   */
  private getHookContext(messageId?: string): HookContext {
    return {
      loopIndex: this.state.loopIndex,
      stepIndex: this.state.stepIndex,
      sessionId: this.sessionId,
      messageId,
      state: { ...this.state },
    };
  }

  /**
   * 获取会话 ID
   *
   * 返回当前 Agent 实例的唯一会话标识符。
   * 会话 ID 用于消息持久化、会话恢复和多会话管理。
   *
   * @returns 会话 ID 字符串（UUID 格式）
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * 获取当前状态
   *
   * 返回 Agent 当前运行状态的只读副本。
   * 状态包含循环计数、步骤索引、token 使用量、错误信息等。
   *
   * @returns Agent 状态对象的副本
   */
  getState(): Readonly<AgentLoopState> {
    return { ...this.state };
  }

  /**
   * 获取消息历史
   *
   * 返回完整的消息历史记录副本。
   * 消息历史包含系统消息、用户消息、助手回复和工具调用结果。
   *
   * @returns 消息数组的副本
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /**
   * 获取 LLM 格式的消息列表
   *
   * 将内部消息格式转换为 LLM API 所需的格式。
   * 此方法会过滤掉 Agent 内部使用的字段，只保留 LLM 需要的字段。
   *
   * 转换规则：
   * - 提取 role、content、name、tool_calls、tool_call_id、reasoning_content、id
   * - 忽略 messageId、timestamp 等 Agent 内部字段
   *
   * @returns 符合 LLM API 格式的消息数组
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
   *
   * 返回所有已完成步骤的结果列表。
   * 每个步骤包含一次 LLM 调用的结果和可能执行的工具调用结果。
   *
   * @returns 步骤结果数组的副本
   */
  getSteps(): AgentStepResult[] {
    return [...this.steps];
  }

  /**
   * 获取工具管理器
   *
   * 返回当前 Agent 使用的工具管理器实例。
   * 可用于动态注册或查询可用工具。
   *
   * @returns ToolManager 实例
   */
  getToolManager(): ToolManager {
    return this.toolManager;
  }

  /**
   * 中止 Agent 运行
   *
   * 触发 Agent 的中止机制，取消正在进行的 LLM 请求和工具执行。
   * 调用后，Agent 会尽快停止并抛出 AgentAbortedError。
   *
   * 使用场景：
   * - 用户主动取消任务
   * - 超时控制
   * - 外部中断信号
   */
  abort(): void {
    // 设置中止标志
    this.state.aborted = true;
    // 触发 AbortController，取消所有依赖它的异步操作
    this.abortController?.abort();
  }

  /**
   * 添加消息到历史
   *
   * 手动向消息历史中添加一条新消息。
   * 通常用于恢复会话或注入额外的上下文消息。
   *
   * @param message - 要添加的消息对象
   */
  addMessage(message: Message): void {
    this.messages.push(message);
  }

  /**
   * 从存储恢复消息历史
   *
   * 如果配置了 memoryManager，从持久化存储中恢复当前会话的消息历史。
   * 这使得 Agent 能够在多次运行之间保持上下文连续性。
   *
   * @returns Promise，恢复完成时 resolve
   */
  async restoreMessages(): Promise<void> {
    if (!this.config.memoryManager) return;

    // 从 memoryManager 获取该会话的历史消息
    const contextMessages = this.config.memoryManager.getContextMessages(this.sessionId);
    if (contextMessages.length > 0) {
      // 用恢复的消息替换当前消息历史
      this.messages = [...contextMessages];
    }
  }

  /**
   * 保存当前消息历史到存储
   *
   * 将消息历史中从指定索引开始的消息持久化到存储。
   * 这允许增量保存，避免重复保存已持久化的消息。
   *
   * @param startIndex - 开始保存的消息索引，默认为 0（保存全部）
   * @returns Promise，保存完成时 resolve
   *
   * @example
   * ```typescript
   * // 只保存新增的消息（从第 5 条开始）
   * await agent.saveMessages(5);
   * ```
   */
  async saveMessages(startIndex = 0): Promise<void> {
    if (!this.config.memoryManager) return;
    // 边界检查
    if (startIndex < 0 || startIndex >= this.messages.length) {
      return;
    }

    // 切片并确保每条消息都有 messageId
    const messagesToSave: Message[] = this.messages.slice(startIndex).map((msg) => ({
      ...msg,
      messageId: msg.messageId ?? crypto.randomUUID(),
    }));

    // 调用 memoryManager 持久化消息
    await this.config.memoryManager.addMessages(this.sessionId, messagesToSave);
  }

  /**
   * 清除当前会话的存储数据
   *
   * 删除持久化存储中与当前会话相关的所有数据。
   * 这会清除消息历史、压缩摘要等所有会话数据。
   *
   * ⚠️ 注意：此操作不可逆
   *
   * @returns Promise，清除完成时 resolve
   */
  async clearStorage(): Promise<void> {
    if (!this.config.memoryManager) return;
    await this.config.memoryManager.clearContext(this.sessionId);
  }
  /**
   * 检查是否需要压缩
   *
   * 评估当前消息历史的 token 数量是否超过压缩阈值。
   * 当启用压缩功能且 token 数超过阈值时，触发消息压缩。
   *
   * 压缩触发条件：
   * 1. enableCompaction 配置为 true
   * 2. 配置了 memoryManager
   * 3. 当前 token 估算值 >= 可用限制 * compactionTriggerRatio（默认 0.9）
   *
   * @returns 如果需要压缩返回 true，否则返回 false
   */
  private needsCompaction(): boolean {
    if (!this.config.enableCompaction || !this.config.memoryManager) {
      return false;
    }

    // 计算可用上下文空间
    const maxTokens = this.config.provider.getLLMMaxTokens();
    const maxOutputTokens = this.config.provider.getMaxOutputTokens();
    const usableLimit = Math.max(1, maxTokens - maxOutputTokens);

    // 计算触发阈值：可用限制 * 触发比例（默认 0.9）
    const triggerRatio = this.config.compactionTriggerRatio ?? 0.9;
    const threshold = usableLimit * triggerRatio;

    // 计算当前 token 估算
    const currentTokens = estimateMessagesTokens(this.messages, this.currentTools);

    // 检查是否需要压缩：当前 token 超过阈值
    return currentTokens >= threshold;
  }

  /**
   * 执行压缩
   *
   * 对消息历史执行压缩操作，将较早的消息替换为 LLM 生成的摘要。
   * 这允许 Agent 在长对话中保持上下文连续性，同时避免超出模型的上下文长度限制。
   *
   * 压缩流程：
   * 1. 估算压缩前的 token 数量
   * 2. 调用 compact 函数生成摘要并截断历史
   * 3. 用压缩结果替换内存中的消息
   * 4. 持久化压缩结果到 memoryManager
   *
   * 压缩策略：
   * - 保留最近 N 条消息（compactionKeepMessages，默认 10）
   * - 将较早的消息总结为一个摘要消息
   * - 摘要语言由 summaryLanguage 配置控制
   *
   * @returns Promise，压缩完成时 resolve
   */
  private async performCompaction(): Promise<void> {
    if (!this.config.memoryManager || !this.config.enableCompaction) {
      return;
    }

    // 获取要保留的消息数量
    const keepMessagesNum = this.config.compactionKeepMessages ?? 10;
    // 记录压缩前的 token 数量
    const tokenCountBefore = estimateMessagesTokens(this.messages, this.currentTools);

    // 调用压缩函数，生成摘要并截断历史
    const result = await compact(this.messages, {
      provider: this.config.provider,
      keepMessagesNum,
      language: this.config.summaryLanguage ?? 'English',
    });

    // 更新内存中的消息为压缩后的结果
    this.messages = result.messages;

    // 持久化压缩结果，记录压缩元数据
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
   *
   * Agent 的核心入口点，接收用户输入并启动 Agent 循环。
   * 此方法协调整个 Agent 的运行流程，包括消息准备、工具解析、循环执行和结果构建。
   *
   * 执行流程：
   * 1. 初始化状态和 AbortController
   * 2. 应用配置钩子（允许插件修改配置）
   * 3. 准备消息（恢复历史 + 添加新消息）
   * 4. 刷新预运行的待持久化消息
   * 5. 解析并准备工具 schema
   * 6. 执行主循环（runLoop）
   * 7. 评估完成状态
   * 8. 刷新运行后的待持久化消息
   * 9. 返回最终结果
   *
   * @param userMessage - 用户输入，可以是字符串或完整的消息对象
   * @param options - 可选的 LLM 生成选项，会与默认配置合并
   * @returns Promise<AgentResult> - 包含最终文本、消息历史、步骤结果等
   *
   * @throws AgentAbortedError - 当用户调用 abort() 时抛出
   * @throws AgentMaxRetriesExceededError - 当重试次数超过限制时抛出
   * @throws Error - 其他运行时错误
   *
   * @example
   * ```typescript
   * // 简单文本输入
   * const result = await agent.run('分析这段代码的问题');
   *
   * // 带选项的完整输入
   * const result = await agent.run(
   *   { role: 'user', content: '请解释这个函数' },
   *   { temperature: 0.7, maxTokens: 1000 }
   * );
   * ```
   */
  async run(
    userMessage: string | LLMRequestMessage,
    options?: LLMGenerateOptions
  ): Promise<AgentResult> {
    // ========== 初始化阶段 ==========
    // 重置运行状态
    this.state = createInitialState();
    this.steps = [];
    this.abortController = new AbortController();
    // 应用配置钩子，允许插件修改配置
    await this.applyConfigHooks();

    // ========== 消息准备阶段 ==========
    // 提取用户消息内容
    const userContent = typeof userMessage === 'string' ? userMessage : userMessage.content;
    // 准备消息（包括恢复历史和添加新消息），返回保存起始索引
    const saveFromIndex = await this.prepareMessages(userContent);
    this.persistenceState.persistCursor = saveFromIndex;
    let runError: unknown;
    let runResult: AgentResult | undefined;

    try {
      // 在运行开始前刷新待持久化的消息
      await this.flushPendingMessagesWithRetry('pre_run');
      this.logger?.info('[Agent] Starting run', { sessionId: this.sessionId });

      // ========== 工具准备阶段 ==========
      // 检查工具是否被固定（用户显式传入 tools 选项）
      const toolsPinned = options?.tools !== undefined;
      // 解析工具 schema（通过 hook 处理后）
      const tools = await this.resolveTools(options?.tools);
      this.currentTools = tools;

      // ========== 选项合并阶段 ==========
      // 合并默认配置和用户传入的选项
      const mergedOptions: LLMGenerateOptions = {
        ...this.config.generateOptions,
        ...options,
        abortSignal: options?.abortSignal ?? this.abortController.signal,
        tools,
      };

      // ========== Hook 执行阶段 ==========
      // 发出循环开始事件（通过 loop hooks）
      await this.hookManager.executeLoopHooks(
        { loopIndex: this.state.loopIndex, steps: 0 },
        this.getHookContext()
      );

      // ========== 主循环执行阶段 ==========
      try {
        await this.runLoop(mergedOptions, toolsPinned);
      } catch (error) {
        // 处理用户中止的特殊情况
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

      // ========== 完成处理阶段 ==========
      // 发出循环完成事件
      await this.hookManager.executeLoopHooks(
        { loopIndex: this.state.loopIndex, steps: this.steps.length },
        this.getHookContext()
      );

      // 评估完成状态
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

      // ========== 结果构建阶段 ==========
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
      // 记录运行错误，稍后处理
      runError = error;
    }

    // ========== 持久化阶段 ==========
    // 尝试刷新运行后的待持久化消息
    try {
      await this.flushPendingMessagesWithRetry('post_run');
    } catch (saveError) {
      this.logger?.error('[Agent] Failed to persist messages', saveError, {
        sessionId: this.sessionId,
        saveFromIndex: this.persistenceState.persistCursor,
      });
      // 如果没有运行错误，则抛出持久化错误
      if (!runError) {
        throw saveError;
      }
      // 如果已有运行错误，只记录持久化错误
      this.logger?.error('[Agent] Persistence failed after run error', saveError, {
        sessionId: this.sessionId,
      });
    }

    // 如果有运行错误，现在抛出
    if (runError) {
      throw runError;
    }
    return runResult as AgentResult;
  }

  /**
   * 获取工具 Schema
   *
   * 获取当前可用的工具 schema 列表。
   * 优先使用调用时传入的工具列表，否则从 toolManager 获取。
   *
   * @param optionsTools - 可选的外部工具列表（通常来自 run() 的 options）
   * @returns 工具 schema 数组，如果没有可用工具则返回 undefined
   */
  private getToolsSchema(optionsTools?: Tool[]): Tool[] | undefined {
    // 如果传入了 optionsTools，使用它（优先级最高）
    if (optionsTools) {
      return optionsTools;
    }

    // 使用 toolManager 的 schema
    const schema = this.toolManager.toToolsSchema();
    return schema.length > 0 ? schema : undefined;
  }

  /**
   * 解析工具
   *
   * 获取工具 schema 并通过 Hook 系统处理。
   * 这允许插件在工具被发送给 LLM 之前修改或过滤工具列表。
   *
   * @param optionsTools - 可选的外部工具列表
   * @returns 经过 Hook 处理后的工具 schema 数组
   */
  private async resolveTools(optionsTools?: Tool[]): Promise<Tool[] | undefined> {
    let tools = this.getToolsSchema(optionsTools);
    if (tools && tools.length > 0) {
      // 执行工具钩子，允许插件修改工具列表
      tools = await this.hookManager.executeToolsHooks(tools, this.getHookContext());
    }
    return tools;
  }

  // ===========================================================================
  // 核心循环
  // ===========================================================================

  /**
   * 主循环
   *
   * Agent 的核心执行循环，持续运行直到任务完成或达到限制。
   * 每次循环迭代可能包含 LLM 调用、工具执行、压缩等操作。
   *
   * 循环流程：
   * 1. **中止检测** - 检查是否收到中止信号
   * 2. **完成检测** - 评估任务是否已完成
   * 3. **压缩检查** - 如果需要，执行消息压缩
   * 4. **重试处理** - 如果上次失败，处理重试逻辑
   * 5. **步骤执行** - 执行一次 Agent 步骤（LLM 调用 + 工具执行）
   *
   * 循环终止条件：
   * - 用户调用 abort()
   * - 完成检测器返回 done=true
   * - 达到 maxSteps 限制
   * - 抛出未处理的错误
   *
   * @param options - LLM 生成选项
   * @param toolsPinned - 工具是否被固定（用户显式传入）
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
        // 压缩后刷新工具列表（除非工具被固定）
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
        // 步骤成功，重置重试状态
        this.state.retryCount = 0;
        this.state.needsRetry = false;
        this.logger?.debug('[Agent] Step completed', {
          loopIndex: this.state.loopIndex,
          stepIndex: this.state.stepIndex,
          toolCalls: this.state.currentToolCalls.length,
        });
      } catch (error) {
        // 处理步骤错误
        await this.handleLoopError(error as Error);
      }
    }
  }

  /**
   * 执行单步操作
   *
   * 执行一次完整的 Agent 步骤，包括：
   * - 调用 LLM 生成响应
   * - 处理流式输出
   * - 执行工具调用（如果有）
   * - 更新状态和消息历史
   *
   * 此方法将实际执行委托给 executeAgentStep 函数，
   * 传递所有必要的上下文和回调函数。
   *
   * @param options - LLM 生成选项
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
        getHookContext: (messageId) => this.getHookContext(messageId),
        getLLMMessages: () => this.getLLMMessages(),
        saveMessages: (startIndex) => this.saveMessages(startIndex),
        agentRef: this,
        // 推理内容访问器（用于支持 Chain-of-Thought 模型）
        getCurrentReasoningContent: () => this.currentReasoningContent,
        setCurrentReasoningContent: (value) => {
          this.currentReasoningContent = value;
        },
        // 工具流事件处理器
        handleToolStreamEvent: (event, ctx) => this.handleToolStreamEvent(event, ctx),
      },
      options
    );
  }

  /**
   * 评估是否应该完成
   *
   * 检查多个条件来判断 Agent 是否应该停止运行。
   * 支持自定义完成检测器和默认检测逻辑的组合使用。
   *
   * 完成检测顺序（优先级从高到低）：
   * 1. **中止检测** - 用户是否调用了 abort()
   * 2. **结果状态** - resultStatus 是否为 'stop'
   * 3. **自定义检测器** - 用户提供的 completionDetector
   * 4. **默认检测器** - 基于 LLM 响应的默认逻辑
   * 5. **步骤限制** - 是否达到 maxSteps 限制
   *
   * @returns CompletionResult 包含：
   *   - done: 是否应该完成
   *   - reason: 完成原因（'user_abort' | 'stop' | 'limit_exceeded' | 其他）
   *   - message: 描述性消息
   */
  private async evaluateCompletion(): Promise<CompletionResult> {
    const lastStep = this.steps[this.steps.length - 1];

    // 1. 检查中止（最高优先级）
    if (this.state.aborted) {
      return { done: true, reason: 'user_abort', message: 'Agent was aborted by user' };
    }

    // 2. 检查结果状态（由步骤执行器设置）
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
      // 如果自定义检测器返回完成，或者禁用了默认检测器，直接返回结果
      if (result.done || !this.config.useDefaultCompletionDetector) {
        return result;
      }
    }

    // 4. 默认完成检测（检查 LLM 响应是否表明完成）
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

  /**
   * 处理工具流事件
   *
   * 处理工具执行过程中产生的流式事件。
   * 这些事件包括工具输出的增量更新、错误、完成等。
   *
   * 事件类型：
   * - 'chunk': 工具输出增量
   * - 'complete': 工具执行完成
   * - 'error': 工具执行错误
   * - 'stderr': 标准错误输出
   * - 'data': 结构化数据输出
   *
   * @param event - 工具流事件对象
   * @param ctx - Hook 上下文
   */
  private async handleToolStreamEvent(event: ToolStreamEvent, ctx: HookContext): Promise<void> {
    // 执行工具流钩子
    await this.hookManager.executeToolStreamHooks(event, ctx);

    // 构建日志上下文
    const logContext: Record<string, unknown> = {
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      eventType: event.type,
      sequence: event.sequence,
      timestamp: event.timestamp,
    };
    if (typeof event.content === 'string') {
      logContext['contentLength'] = event.content.length;
      // 限制预览长度，避免日志过长
      logContext['contentPreview'] =
        event.content.length > 300 ? `${event.content.slice(0, 300)}...` : event.content;
    }
    if (event.data !== undefined) {
      logContext['data'] = event.data;
    }

    // 根据事件类型选择日志级别
    if (event.type === 'stderr' || event.type === 'error') {
      this.logger?.warn('[Agent] Tool stream event', logContext);
      return;
    }
    this.logger?.debug('[Agent] Tool stream event', logContext);
  }

  /**
   * 处理循环错误
   *
   * 根据错误类型决定如何处理循环中发生的错误。
   * 使用 classifyLoopError 函数对错误进行分类。
   *
   * 错误处理策略：
   * - **throw_permanent**: 永久性错误，直接抛出
   * - **abort**: 用户中止，抛出 AgentAbortedError
   * - **retry**: 可重试错误（如 API 限流），设置重试标志
   * - **throw_unknown**: 未知错误，直接抛出
   *
   * @param error - 发生的错误
   */
  private async handleLoopError(error: Error): Promise<void> {
    this.state.lastError = error;
    // 分类错误并获取处理策略
    const disposition = classifyLoopError(error, this.state.aborted);

    switch (disposition) {
      case 'throw_permanent':
        // 永久性错误，直接向上抛出
        throw error;
      case 'abort':
        // 转换为中止错误
        throw new AgentAbortedError();
      case 'retry':
        // 可重试错误，设置重试标志
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
        // 未知错误，记录并抛出
        this.logger?.error('[Agent] Non-retryable loop error', error, {
          loopIndex: this.state.loopIndex,
          stepIndex: this.state.stepIndex,
        });
        throw error;
    }
  }

  /**
   * 处理重试
   *
   * 执行重试逻辑，包括：
   * - 检查重试次数是否超过限制
   * - 计算退避延迟时间
   * - 等待后继续（支持中止）
   *
   * 退避策略：
   * - 如果错误包含 retryAfter，优先使用
   * - 否则使用指数退避（基于 backoffConfig）
   *
   * @returns 是否可以继续重试
   * @throws AgentMaxRetriesExceededError - 超过最大重试次数
   * @throws AgentAbortedError - 重试等待期间被中止
   */
  private async handleRetry(): Promise<boolean> {
    this.state.retryCount++;

    // 检查是否超过最大重试次数
    if (this.state.retryCount > this.config.maxRetries) {
      throw new AgentMaxRetriesExceededError(
        this.state.retryCount,
        this.state.lastError ?? new Error('Unknown error')
      );
    }

    // 获取错误建议的重试等待时间（如果有）
    const retryAfterMs =
      this.state.lastError instanceof LLMRetryableError
        ? this.state.lastError.retryAfter
        : undefined;

    // 计算退避延迟
    const delay = calculateBackoff(
      this.state.retryCount - 1,
      retryAfterMs,
      this.config.backoffConfig
    );

    this.logger?.warn(`[Agent] Retry attempt ${this.state.retryCount} after ${delay}ms`);

    // 等待（支持中止）
    await this.sleep(delay, this.abortController?.signal);

    // 检查是否在等待期间被中止
    if (this.state.aborted) {
      throw new AgentAbortedError();
    }

    return true;
  }

  /**
   * 检查是否可以继续
   *
   * 评估 Agent 是否可以继续执行下一步。
   * 当达到步骤限制或被中止时返回 false。
   *
   * @returns 如果可以继续返回 true，否则返回 false
   */
  private canContinue(): boolean {
    return this.state.stepIndex < this.config.maxSteps && !this.state.aborted;
  }

  // ===========================================================================
  // 工具方法
  // ===========================================================================

  /**
   * 构建初始消息
   *
   * 为新会话创建初始消息序列，包括系统消息和用户消息。
   * 系统消息包含 systemPrompt，用户消息包含用户的输入。
   *
   * @param userContent - 用户消息内容
   * @returns 初始消息数组
   */
  private async buildInitialMessages(
    userContent: string | LLMRequestMessage['content']
  ): Promise<Message[]> {
    return buildInitialAgentMessages({
      systemPrompt: this.config.systemPrompt,
      userContent,
      hookManager: this.hookManager,
      getHookContext: (messageId) => this.getHookContext(messageId),
      createMessageId: () => crypto.randomUUID(),
    });
  }

  /**
   * 构建用户消息
   *
   * 创建单条用户消息，用于追加到现有会话。
   *
   * @param userContent - 用户消息内容
   * @returns 用户消息对象
   */
  private async buildUserMessage(
    userContent: string | LLMRequestMessage['content']
  ): Promise<Message> {
    return buildAgentUserMessage({
      userContent,
      hookManager: this.hookManager,
      getHookContext: (messageId) => this.getHookContext(messageId),
      createMessageId: () => crypto.randomUUID(),
    });
  }

  /**
   * 应用配置钩子
   *
   * 执行配置相关的钩子，允许插件在运行前修改 Agent 配置。
   * 这包括 systemPrompt、工具管理器、日志器等。
   *
   * 常见用途：
   * - 动态修改系统提示词
   * - 注入额外的工具
   * - 调整日志级别
   */
  private async applyConfigHooks(): Promise<void> {
    // 执行配置钩子，获取修改后的配置
    const hookedConfig = await this.hookManager.executeConfigHooks<AgentConfig>(
      this.config as AgentConfig,
      this.getHookContext()
    );
    // 重新合并配置以应用默认值
    this.config = mergeAgentConfig(hookedConfig);
    // 更新工具管理器引用
    this.toolManager = this.requireToolManager(this.config.toolManager);
    this.logger = this.config.logger;
    // 如果钩子修改了 sessionId，更新它
    if (this.config.sessionId) {
      this.sessionId = this.config.sessionId;
    }
  }

  /**
   * 准备消息
   *
   * 在运行开始前准备消息历史。
   * 根据是否有现有会话，执行不同的准备逻辑：
   * - 新会话：构建初始消息（系统 + 用户）
   * - 现有会话：恢复历史 + 添加新用户消息
   *
   * @param userContent - 用户消息内容
   * @returns 消息保存的起始索引
   */
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

  /**
   * 确保现有会话有系统消息
   *
   * 对于已存在的会话，确保系统消息存在且正确。
   * 如果会话中没有系统消息，或者系统提示词已更改，
   * 则添加或更新系统消息。
   *
   * @param messages - 当前消息列表
   * @param existingSessionPrompt - 现有会话的系统提示词（如果有）
   * @returns 更新后的消息列表
   */
  private async ensureSystemMessageForExistingSession(
    messages: Message[],
    existingSessionPrompt?: string
  ): Promise<Message[]> {
    return ensureSystemMessageForExistingSessionUtil({
      messages,
      existingSessionPrompt,
      systemPrompt: this.config.systemPrompt,
      hookManager: this.hookManager,
      getHookContext: (messageId) => this.getHookContext(messageId),
      createMessageId: () => crypto.randomUUID(),
    });
  }

  /**
   * 验证并获取工具管理器
   *
   * 确保工具管理器存在，否则抛出错误。
   * 工具管理器是 Agent 的必需组件。
   *
   * @param toolManager - 可选的工具管理器
   * @returns 工具管理器实例
   * @throws Error - 如果工具管理器不存在
   */
  private requireToolManager(toolManager?: ToolManager): ToolManager {
    if (!toolManager) {
      throw new Error('[Agent] toolManager is required');
    }
    return toolManager;
  }

  /**
   * 带重试的刷新待持久化消息
   *
   * 尝试刷新待持久化的消息，如果失败则自动重试。
   * 使用指数退避策略进行重试。
   *
   * @param stage - 调用阶段（'pre_run' 或 'post_run'）
   * @param maxAttempts - 最大重试次数，默认 3
   * @throws 最后一次失败的错误
   */
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
        // 计算重试延迟（指数退避，上限 500ms）
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

  /**
   * 压缩后刷新工具
   *
   * 在消息压缩后更新工具列表。
   * 如果工具被固定（用户显式传入），则保持不变；
   * 否则重新解析工具以反映任何变化。
   *
   * @param options - LLM 生成选项
   * @param toolsPinned - 工具是否被固定
   */
  private async refreshToolsAfterCompaction(
    options: LLMGenerateOptions,
    toolsPinned: boolean
  ): Promise<void> {
    if (toolsPinned) {
      // 工具被固定，保持不变
      this.currentTools = options.tools;
      return;
    }

    // 重新解析工具
    const refreshedTools = await this.resolveTools();
    this.currentTools = refreshedTools;
    options.tools = refreshedTools;
  }

  /**
   * 异步休眠（支持中止）
   *
   * 返回一个在指定时间后 resolve 的 Promise。
   * 如果提供了 AbortSignal 且在等待期间被触发，则立即 reject。
   *
   * @param ms - 休眠时间（毫秒）
   * @param signal - 可选的中止信号
   * @returns Promise，休眠完成或被中止时 settle
   * @throws AgentAbortedError - 如果在等待期间被中止
   */
  private async sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        clearTimeout(timer);
        reject(new AgentAbortedError());
      };

      const cleanup = () => {
        signal?.removeEventListener('abort', onAbort);
      };

      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, ms);

      if (signal) {
        // 检查是否已经中止
        if (signal.aborted) {
          cleanup();
          clearTimeout(timer);
          reject(new AgentAbortedError());
        } else {
          // 监听中止事件
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }
    });
  }
}

/**
 * 创建 Agent 实例
 *
 * 这是创建 Agent 实例的推荐工厂函数。
 * 它封装了 new Agent() 调用，提供更简洁的 API。
 *
 * @param config - Agent 配置对象
 * @returns 新创建的 Agent 实例
 *
 * @example
 * ```typescript
 * import { createAgent } from './agent';
 *
 * const agent = createAgent({
 *   provider: myLLMProvider,
 *   toolManager: myToolManager,
 *   systemPrompt: '你是一个有帮助的助手',
 *   plugins: [myPlugin],
 * });
 *
 * const result = await agent.run('你好！');
 * console.log(result.text);
 * ```
 */
export function createAgent(config: AgentConfig): Agent {
  return new Agent(config);
}

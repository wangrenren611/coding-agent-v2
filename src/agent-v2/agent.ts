import { HookContext, HookManager, Plugin } from './hook';
import { LLMGenerateOptions, LLMProvider, Chunk } from '../providers';
import { AgentQueryError } from './error';
import { MessageList } from './message-list';
import { createInitialState } from './state';
import { AgentLoopState } from './types';
import { ToolCall } from '../providers';
import { ToolResult } from '../tool';
import { MessageGuard, AssistantMessage } from './message';
import { SessionManager, createSessionManager } from './session-manager';
import { MessageBuffer, createMessageBuffer } from './message-buffer';
import { FileStorage, createFileStorage } from './file-storage';

export class Agent {
  llmProvider: LLMProvider;
  messageList: MessageList;
  hookManager: HookManager;
  sessionId: string;
  state: AgentLoopState;
  private sessionManager: SessionManager;
  private messageBuffer: MessageBuffer;

  constructor({
    systemPrompt,
    llmProvider,
    plugins,
    sessionId,
    storagePath,
    enablePersistence,
    autoSaveInterval,
  }: {
    sessionId: string;
    systemPrompt: string;
    llmProvider: LLMProvider;
    plugins?: Plugin[];
    storagePath?: string;
    enablePersistence?: boolean;
    autoSaveInterval?: number;
  }) {
    this.sessionId = sessionId;
    this.llmProvider = llmProvider;
    this.messageList = new MessageList();
    this.messageList.setSystemMessage(systemPrompt);
    this.hookManager = new HookManager();
    this.state = createInitialState();

    // 初始化持久化组件
    if (enablePersistence !== false) {
      const storage = createFileStorage({ storagePath });
      this.sessionManager = createSessionManager({
        storage,
        autoSaveInterval: autoSaveInterval || 5000,
        autoSaveEnabled: true,
      });

      this.messageBuffer = createMessageBuffer({
        maxBufferSize: 10,
        flushInterval: 1000,
        enabled: true,
      });

      this.messageBuffer.setOnFlush(async (bufferedMessages) => {
        for (const msg of bufferedMessages) {
          if (msg.operation === 'add') {
            await this.sessionManager.addMessage(msg.message);
          } else if (msg.operation === 'update' && msg.updates) {
            await this.sessionManager.updateMessage(msg.message.messageId, msg.updates);
          }
        }
      });

      this.messageBuffer.start();
    } else {
      this.sessionManager = createSessionManager({
        storage: createFileStorage(),
        autoSaveEnabled: false,
      });
      this.messageBuffer = createMessageBuffer({ enabled: false });
    }

    this.hookManager.use({
      name: 'logger',
      step: (step, ctx) => console.log(`Step ${step.stepIndex}`),
      stop: (reason, ctx) => console.log('Agent stopped:', reason.reason),
    });

    if (plugins && plugins.length > 0) {
      this.hookManager.useMany(plugins);
    }
  }

  async initialize(): Promise<void> {
    await this.sessionManager.initialize();

    // 尝试恢复会话或创建新会话
    const existingSession = await this.sessionManager.resumeSession(this.sessionId);

    if (!existingSession) {
      await this.sessionManager.createSession(this.sessionId, this.state);
    }
  }

  /**
   * 获取 Hook 上下文
   *
   * 创建一个包含当前 Agent 状态的上下文对象，传递给 Hook 函数。
   * 这使得插件能够访问和修改 Agent 的运行时状态。
   *
   * @returns Hook 上下文对象，包含：
   *   - stepIndex: 当前步骤索引
   *   - sessionId: 会话 ID
   *   - state: 完整的 Agent 状态副本
   */
  private getHookContext(messageId?: string): HookContext {
    return {
      stepIndex: this.state.stepIndex,
      sessionId: this.sessionId,
      messageId,
      state: { ...this.state },
    };
  }

  async run(query: string, options?: LLMGenerateOptions) {
    if (!query) {
      throw new AgentQueryError();
    }

    // 初始化持久化
    await this.initialize();

    // 添加用户消息
    const userMessage = this.messageList.addUserMessage(query);

    // 持久化用户消息
    await this.messageBuffer.add(userMessage);

    try {
      // 执行主循环
      await this.loop(options);
    } catch (error) {
      this.state.lastError = error as Error;
      this.state.aborted = true;
      throw error;
    } finally {
      // 保存最终快照
      await this.sessionManager.saveSnapshot(this.state);

      // 刷新缓冲区
      await this.messageBuffer.flush();

      // 关闭持久化组件
      await this.messageBuffer.close();
      await this.sessionManager.close();

      // 通知所有插件 Agent 已停止
      this.hookManager.executeStopHooks(
        {
          reason: this.state.aborted ? 'aborted' : this.state.resultStatus,
          message: this.state.lastError?.message,
        },
        this.getHookContext()
      );
    }
  }

  async loop(options?: LLMGenerateOptions) {
    while (true) {
      // ========================================
      // 1. 检查停止条件
      // ========================================
      if (this.shouldStop()) {
        this.state.resultStatus = 'stop';
        break;
      }

      // ========================================
      // 2. 执行单步
      // ========================================
      const stepResult = await this.executeStep(options);

      // TODO: 更新循环级别的状态
      // - 根据 stepResult 判断是否需要继续
      // - 累加 usage 统计

      // ========================================
      // 3. 更新步骤索引
      // ========================================
      this.state.stepIndex++;
    }
  }

  /**
   * 检查是否应该停止循环
   */
  private shouldStop(): boolean {
    // 1. 用户主动中止
    if (this.state.aborted) {
      return true;
    }

    // 2. 已经是 stop 状态
    if (this.state.resultStatus === 'stop') {
      return true;
    }

    // 3. 达到最大步数限制
    if (this.state.stepIndex >= 1000) {
      return true;
    }

    // 4. 如果最后一条消息是工具调用或工具结果，需要继续执行
    const lastMessage = this.messageList.lastMessage;
    if (
      lastMessage &&
      (MessageGuard.isToolCall(lastMessage) || MessageGuard.isToolResult(lastMessage))
    ) {
      return false;
    }

    return false;
  }

  /**
   * 执行单步
   */
  private async executeStep(options?: LLMGenerateOptions): Promise<{
    hasToolCalls: boolean;
    finishReason?: string;
  }> {
    // 重置当前步骤状态
    this.state.stepIndex++;
    this.state.currentText = '';
    this.state.currentToolCalls = [];
    this.state.stepUsage = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    };

    // ========================================
    // 1. 执行 LLM Hooks 获取配置
    // ========================================
    const llmConfig = await this.hookManager.executeLLMConfigHooks(
      { ...options, stream: true },
      this.getHookContext()
    );

    // ========================================
    // 2. 执行 MessageList Hooks
    // ========================================
    this.messageList = await this.hookManager.executeMessageListHooks(
      this.messageList,
      this.getHookContext()
    );

    // ========================================
    // 3. 调用 LLM 生成响应
    // ========================================
    const response = await this.llmProvider.generateStream(
      this.messageList.toLLMRequestMessages(),
      llmConfig
    );

    // ========================================
    // 4. 处理响应流
    // ========================================
    const { finishReason, toolCalls, text, reasoningContent } =
      await this.processResponse(response);

    // ========================================
    // 5. 将助手消息添加到历史
    // ========================================
    // TODO: 将响应添加到 messageList
    // - 提取 text 内容
    // - 提取 reasoningContent（如果存在）
    // - 提取 toolCalls（需要存储为 tool 调用格式）

    // 执行 Step Hook
    this.hookManager.executeStepHooks(
      {
        stepIndex: this.state.stepIndex,
        finishReason,
        toolCallsCount: toolCalls.length,
      },
      this.getHookContext()
    );

    // Step 完成后保存快照（持久化当前状态）
    await this.sessionManager.saveSnapshot(this.state);

    // 处理工具调用
    if (toolCalls.length > 0) {
      await this.processToolCalls(toolCalls);
      return { hasToolCalls: true, finishReason };
    }

    return { hasToolCalls: false, finishReason };
  }

  /**
   * 处理 LLM 响应流
   *
   * 实现思路：
   * 1. 先创建空的助手消息，获取 messageId（防止丢失）
   * 2. 流式处理 chunk，根据 messageId 实时更新消息
   * 3. 完成时更新最终状态
   */
  private async processResponse(response: AsyncGenerator<Chunk>): Promise<{
    text: string;
    toolCalls: ToolCall[];
    finishReason?: string;
    reasoningContent?: string;
  }> {
    let text = '';
    let toolCalls: ToolCall[] = [];
    let finishReason: string | undefined;
    let reasoningContent = '';

    // 1. 创建空的助手消息，获取 messageId（立即存储，防止丢失）
    const assistantMessage = this.messageList.addAssistantMessage({
      content: '',
      tool_calls: [],
    });
    const messageId = assistantMessage.messageId;

    // 持久化新创建的消息
    await this.messageBuffer.add(assistantMessage);

    for await (const chunk of response) {
      const choices = chunk?.choices;
      const finish_reason = choices?.[0]?.finish_reason;
      const delta = choices?.[0]?.delta;

      // 2. 增量处理
      if (delta?.content !== undefined) {
        text += delta.content;
      }

      if (delta?.reasoning_content !== undefined) {
        reasoningContent += delta.reasoning_content;
      }

      // 处理工具调用（需要合并）
      if (delta?.tool_calls) {
        toolCalls = this.mergeToolCalls(toolCalls, delta.tool_calls);
      }

      // 记录完成原因
      if (finish_reason) {
        finishReason = finish_reason;
      }

      // 3. 根据 messageId 实时更新消息（并发安全）
      const hasToolCalls = toolCalls.length > 0;
      const updates = {
        content: text,
        reasoning_content: reasoningContent,
        tool_calls: hasToolCalls ? toolCalls : undefined,
        finish_reason: hasToolCalls ? 'tool_calls' : finishReason || 'stop',
      };

      // 更新内存
      this.messageList.updateMessageById(messageId, updates);

      // 持久化更新
      await this.messageBuffer.update(messageId, updates);

      // TODO: 累加 stepUsage
    }

    // 4. 完成时更新最终状态
    const finalUpdates = {
      content: text,
      reasoning_content: reasoningContent,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      finish_reason: finishReason,
    };

    this.messageList.updateMessageById(messageId, finalUpdates);
    await this.messageBuffer.update(messageId, finalUpdates);

    return { text, toolCalls, finishReason, reasoningContent };
  }

  /**
   * 合并工具调用
   *
   * LLM 可能分多次返回工具调用，需要合并
   */
  private mergeToolCalls(existing: ToolCall[], newCalls: ToolCall[]): ToolCall[] {
    const result = [...existing];

    for (const newCall of newCalls) {
      const existingIndex = result.findIndex((tc) => tc.id === newCall.id);

      if (existingIndex >= 0) {
        // 已存在，追加 arguments
        const existingCall = result[existingIndex];
        const existingArgs =
          typeof existingCall.arguments === 'string'
            ? existingCall.arguments
            : JSON.stringify(existingCall.arguments || {});
        const newArgs =
          typeof newCall.arguments === 'string'
            ? newCall.arguments
            : JSON.stringify(newCall.arguments || {});

        result[existingIndex] = {
          ...existingCall,
          arguments: existingArgs + newArgs,
        };
      } else {
        // 新工具调用
        result.push(newCall);
      }
    }

    return result;
  }

  /**
   * 处理工具调用
   */
  private async processToolCalls(toolCalls: ToolCall[]): Promise<void> {
    // TODO: 遍历工具调用并执行
    for (const toolCall of toolCalls) {
      // ========================================
      // 1. 工具调用前 Hook (ToolUseHook)
      // ========================================
      const modifiedToolCall = await this.hookManager.executeToolUseHooks(
        toolCall,
        this.getHookContext()
      );

      // ========================================
      // 2. 工具确认 Hook (ToolConfirmHook)
      // ========================================
      // TODO: 检查是否需要用户确认
      // - 如果需要确认，调用 ToolConfirmHook
      // - 用户拒绝则跳过执行

      // ========================================
      // 3. 执行工具
      // ========================================
      const result = await this.executeTool(modifiedToolCall);

      // ========================================
      // 4. 工具结果 Hook (ToolResultHook)
      // ========================================
      const modifiedResult = await this.hookManager.executeToolResultHooks(
        { toolCall: modifiedToolCall, result },
        this.getHookContext()
      );

      // ========================================
      // 5. 将工具结果添加到消息历史
      // ========================================
      // TODO: 将工具结果以 assistant message 的 tool_call 形式添加
      // 然后添加 user message 形式的工具结果
    }
  }

  /**
   * 执行单个工具调用
   */
  private async executeTool(toolCall: ToolCall): Promise<ToolResult> {
    // TODO: 实现工具执行
    // 1. 从 toolCall.name 获取工具名称
    // 2. 解析 toolCall.arguments
    // 3. 获取工具实例
    // 4. 创建工具执行上下文 (ToolExecutionContext)
    // 5. 调用工具并获取结果
    // 6. 处理工具流式事件

    return {
      id: toolCall.id || 'unknown',
      result: '',
      isError: false,
    };
  }

  /**
   * 处理错误并决定是否重试
   */
  private async handleError(error: Error): Promise<boolean> {
    // TODO: 实现错误处理逻辑
    // 1. 记录错误到 state.lastError
    // 2. 检查是否超过最大重试次数
    // 3. 如果可以重试，增加 retryCount，返回 true
    // 4. 否则设置 aborted = true，返回 false
    return false;
  }

  /**
   * 重置状态
   */
  private resetState(): void {
    // TODO: 重置状态到初始值
    // 保留 stepIndex（用于跟踪总步数）
    // 重置 currentText, currentToolCalls 等
  }
}

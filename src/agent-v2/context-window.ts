import { Message, MessageGuard, SummaryMessage } from './message';
import { MessageList } from './message-list';

/**
 * 裁剪策略
 */
export enum TrimStrategy {
  /** 裁剪最旧的消息 */
  OLDEST_FIRST = 'oldest_first',
  /** 保留关键消息（工具调用+结果成对保留） */
  KEEP_PAIRED = 'keep_paired',
  /** 智能裁剪（优先保留重要消息） */
  SMART = 'smart',
  /** 总结压缩 */
  SUMMARIZE = 'summarize',
}

/**
 * 消息优先级
 */
export enum MessagePriority {
  /** 低优先级（可优先删除） */
  LOW = 0,
  /** 普通优先级 */
  NORMAL = 1,
  /** 高优先级（尽量保留） */
  HIGH = 2,
  /** 关键消息（不删除） */
  CRITICAL = 3,
}

/**
 * 上下文窗口配置
 */
export interface ContextWindowOptions {
  /** 最大 token 数 */
  maxTokens: number;
  /** 预留给回复的 token 数 */
  reservedTokens: number;
  /** 裁剪策略 */
  trimStrategy: TrimStrategy;
  /** 是否保留系统消息 */
  preserveSystemMessage: boolean;
  /** 是否保留最后一条用户消息 */
  preserveLastUserMessage: boolean;
  /** 是否保留失败的错误消息 */
  preserveErrors: boolean;
  /** 触发总结的消息数量阈值 */
  summarizeThreshold?: number;
}

/**
 * 上下文窗口管理器
 *
 * 功能：
 * - Token 计数
 * - 智能裁剪
 * - 消息优先级评估
 * - 上下文压缩
 */
export class ContextWindowManager {
  private options: ContextWindowOptions;

  /** 总结回调（用于消息压缩） */
  private summarizeCallback?: (messages: Message[]) => Promise<SummaryMessage>;

  constructor(options?: Partial<ContextWindowOptions>) {
    this.options = {
      maxTokens: options?.maxTokens ?? 128000,
      reservedTokens: options?.reservedTokens ?? 4096,
      trimStrategy: options?.trimStrategy ?? TrimStrategy.SMART,
      preserveSystemMessage: options?.preserveSystemMessage ?? true,
      preserveLastUserMessage: options?.preserveLastUserMessage ?? true,
      preserveErrors: options?.preserveErrors ?? true,
      summarizeThreshold: options?.summarizeThreshold ?? 50,
    };
  }

  /**
   * 设置总结回调
   */
  setSummarizeCallback(callback: (messages: Message[]) => Promise<SummaryMessage>): void {
    this.summarizeCallback = callback;
  }

  /**
   * 获取有效上下文窗口大小
   */
  getAvailableTokens(): number {
    return this.options.maxTokens - this.options.reservedTokens;
  }

  /**
   * 检查是否需要裁剪
   */
  needsTrimming(messages: Message[], systemMessage?: Message): boolean {
    const totalTokens = this.countTokens(messages, systemMessage);
    return totalTokens > this.getAvailableTokens();
  }

  /**
   * 计算消息的 token 数量
   */
  countTokens(messages: Message[], systemMessage?: Message): number {
    let count = 0;

    if (systemMessage) {
      count += this.estimateTokens(systemMessage.content);
    }

    for (const msg of messages) {
      count += this.estimateMessageTokens(msg);
    }

    return count;
  }

  /**
   * 估算单条消息的 token 数
   */
  private estimateMessageTokens(msg: Message): number {
    let count = this.estimateTokens(msg.content);

    // 工具调用
    if (MessageGuard.hasToolCalls(msg) && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        count += this.estimateTokens(tc.function.name);
        count += this.estimateTokens(tc.function.arguments);
      }
    }

    // 工具结果
    if (MessageGuard.isToolResult(msg)) {
      count += this.estimateTokens(msg.tool_call_id);
    }

    // 推理内容
    if (MessageGuard.isToolCall(msg) && msg.reasoning_content) {
      count += this.estimateTokens(msg.reasoning_content);
    }

    // 额外开销
    count += 4; // role 等元数据

    return count;
  }

  /**
   * 简单的 token 估算
   * 英文: ~4 字符 = 1 token
   * 中文: ~1.5 字符 = 1 token
   */
  private estimateTokens(text: string): number {
    if (!text) return 0;

    // 检测中文字符比例
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const ratio = chineseChars / text.length;

    // 混合估算
    const englishTokens = Math.ceil(text.length / 4);
    const chineseTokens = Math.ceil(text.length / 1.5);

    return Math.ceil(englishTokens * (1 - ratio) + chineseTokens * ratio);
  }

  /**
   * 裁剪消息以适应上下文窗口
   */
  trim(messages: Message[], systemMessage?: Message): Message[] {
    if (!this.needsTrimming(messages, systemMessage)) {
      return messages;
    }

    switch (this.options.trimStrategy) {
      case TrimStrategy.OLDEST_FIRST:
        return this.trimOldestFirst(messages, systemMessage);

      case TrimStrategy.KEEP_PAIRED:
        return this.trimKeepPaired(messages, systemMessage);

      case TrimStrategy.SMART:
        return this.trimSmart(messages, systemMessage);

      case TrimStrategy.SUMMARIZE:
        return this.trimWithSummarize(messages, systemMessage);

      default:
        return this.trimOldestFirst(messages, systemMessage);
    }
  }

  /**
   * 策略 1: 简单地裁剪最旧的消息
   */
  private trimOldestFirst(messages: Message[], systemMessage?: Message): Message[] {
    const maxTokens = this.getAvailableTokens();
    let systemTokens = systemMessage ? this.estimateTokens(systemMessage.content) : 0;
    let result = [...messages];
    let currentTokens = this.countTokens(messages);

    while (currentTokens + systemTokens > maxTokens && result.length > 1) {
      const removed = result.shift()!;
      currentTokens -= this.estimateMessageTokens(removed);
    }

    return result;
  }

  /**
   * 策略 2: 保持 tool_call 和 tool_result 成对
   */
  private trimKeepPaired(messages: Message[], systemMessage?: Message): Message[] {
    const maxTokens = this.getAvailableTokens();
    let result = [...messages];
    let currentTokens = this.countTokens(messages, systemMessage);

    let i = 0;
    while (currentTokens > maxTokens && i < result.length) {
      const msg = result[i];

      // 如果是 tool_result，检查对应的 tool_call 是否也会被删除
      if (MessageGuard.isToolResult(msg)) {
        const toolCallId = msg.tool_call_id;
        const hasCall = result.some(
          (m) => MessageGuard.isToolCall(m) && m.tool_calls.some((tc) => tc.id === toolCallId)
        );

        if (hasCall) {
          // 可以安全删除
          result.splice(i, 1);
          currentTokens -= this.estimateMessageTokens(msg);
          continue;
        }
      }

      // 如果是 tool_call，也要删除对应的 tool_result
      if (MessageGuard.isToolCall(msg)) {
        const toolCallIds = msg.tool_calls.map((tc) => tc.id);

        // 删除相关的 tool_result
        result = result.filter((m) => {
          if (MessageGuard.isToolResult(m) && toolCallIds.includes(m.tool_call_id)) {
            currentTokens -= this.estimateMessageTokens(m);
            return false;
          }
          return true;
        });
      }

      // 删除当前消息
      result.splice(i, 1);
      currentTokens -= this.estimateMessageTokens(msg);

      // 检查是否需要保留最后一条用户消息
      if (this.options.preserveLastUserMessage && result.length === 1) {
        const last = result[0];
        if (MessageGuard.isUser(last)) {
          break;
        }
      }
    }

    return result;
  }

  /**
   * 策略 3: 智能裁剪（基于优先级）
   */
  private trimSmart(messages: Message[], systemMessage?: Message): Message[] {
    const maxTokens = this.getAvailableTokens();

    // 计算每条消息的优先级
    const prioritized = messages.map((msg) => ({
      message: msg,
      priority: this.evaluatePriority(msg, messages),
    }));

    // 按优先级排序（低优先级先删除）
    prioritized.sort((a, b) => a.priority - b.priority);

    let currentTokens = this.countTokens(messages, systemMessage);
    const toRemove = new Set<string>();

    for (const item of prioritized) {
      if (currentTokens <= maxTokens) break;

      // 跳过关键消息
      if (item.priority === MessagePriority.CRITICAL) continue;

      // 检查保留规则
      if (
        this.options.preserveLastUserMessage &&
        MessageGuard.isUser(item.message) &&
        item.message === messages.filter(MessageGuard.isUser).at(-1)
      ) {
        continue;
      }

      toRemove.add(item.message.messageId);
      currentTokens -= this.estimateMessageTokens(item.message);

      // 如果删除 tool_call，也要删除对应的 tool_result
      if (MessageGuard.isToolCall(item.message)) {
        const toolCallIds = item.message.tool_calls.map((tc) => tc.id);
        for (const msg of messages) {
          if (MessageGuard.isToolResult(msg) && toolCallIds.includes(msg.tool_call_id)) {
            if (!toRemove.has(msg.messageId)) {
              toRemove.add(msg.messageId);
              currentTokens -= this.estimateMessageTokens(msg);
            }
          }
        }
      }
    }

    // 过滤掉要删除的消息，保持原始顺序
    return messages.filter((m) => !toRemove.has(m.messageId));
  }

  /**
   * 策略 4: 使用总结压缩
   */
  private async trimWithSummarize(
    messages: Message[],
    systemMessage?: Message
  ): Promise<Message[]> {
    if (!this.summarizeCallback) {
      // 没有总结回调，降级到智能裁剪
      return this.trimSmart(messages, systemMessage);
    }

    // 检查是否需要总结
    if (messages.length < (this.options.summarizeThreshold ?? 50)) {
      return this.trimSmart(messages, systemMessage);
    }

    // 选择可以总结的消息范围（保留最近的消息）
    const keepCount = Math.floor(messages.length * 0.3); // 保留最近 30%
    const toSummarize = messages.slice(0, -keepCount);
    const toKeep = messages.slice(-keepCount);

    if (toSummarize.length === 0) {
      return toKeep;
    }

    // 调用总结回调
    const summary = await this.summarizeCallback(toSummarize);

    // 返回总结 + 保留的消息
    return [summary, ...toKeep];
  }

  /**
   * 评估消息优先级
   */
  private evaluatePriority(msg: Message, allMessages: Message[]): MessagePriority {
    // 系统消息是关键的
    if (MessageGuard.isSystem(msg)) {
      return MessagePriority.CRITICAL;
    }

    // 包含错误的工具结果是高优先级
    if (MessageGuard.isToolResult(msg) && msg.content.includes('error')) {
      return this.options.preserveErrors ? MessagePriority.HIGH : MessagePriority.LOW;
    }

    // 工具调用和结果是成对的，优先级较高
    if (MessageGuard.isToolCall(msg) || MessageGuard.isToolResult(msg)) {
      return MessagePriority.HIGH;
    }

    // 用户消息是高优先级
    if (MessageGuard.isUser(msg)) {
      return MessagePriority.HIGH;
    }

    // 总结消息是普通的
    if (MessageGuard.isSummary(msg)) {
      return MessagePriority.NORMAL;
    }

    // 普通助手消息
    return MessagePriority.NORMAL;
  }

  /**
   * 验证消息列表的完整性
   * 检查 tool_call 和 tool_result 是否成对
   */
  validate(messages: Message[]): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 收集所有 tool_call_ids
    const toolCallIds = new Set<string>();
    const toolResultIds = new Set<string>();

    for (const msg of messages) {
      if (MessageGuard.isToolCall(msg)) {
        msg.tool_calls.forEach((tc) => toolCallIds.add(tc.id));
      }
      if (MessageGuard.isToolResult(msg)) {
        toolResultIds.add(msg.tool_call_id);
      }
    }

    // 检查孤立的 tool_result
    for (const id of toolResultIds) {
      if (!toolCallIds.has(id)) {
        errors.push(`孤立的工具结果: tool_call_id=${id} 没有对应的工具调用`);
      }
    }

    // 检查未响应的 tool_call
    for (const id of toolCallIds) {
      if (!toolResultIds.has(id)) {
        errors.push(`未响应的工具调用: id=${id} 没有对应的工具结果`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * 获取上下文窗口统计信息
   */
  getStats(
    messages: Message[],
    systemMessage?: Message
  ): {
    totalMessages: number;
    totalTokens: number;
    availableTokens: number;
    utilizationRate: number;
    messagesByRole: Record<string, number>;
  } {
    const totalTokens = this.countTokens(messages, systemMessage);
    const availableTokens = this.getAvailableTokens();

    const messagesByRole: Record<string, number> = {};
    for (const msg of messages) {
      const role = msg.role;
      messagesByRole[role] = (messagesByRole[role] || 0) + 1;
    }

    return {
      totalMessages: messages.length,
      totalTokens,
      availableTokens,
      utilizationRate: totalTokens / this.options.maxTokens,
      messagesByRole,
    };
  }

  /**
   * 更新配置
   */
  updateOptions(options: Partial<ContextWindowOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * 获取当前配置
   */
  getOptions(): Readonly<ContextWindowOptions> {
    return { ...this.options };
  }
}

/**
 * 扩展 MessageList，集成上下文窗口管理
 */
export class MessageListWithContext extends MessageList {
  private contextManager: ContextWindowManager;

  constructor(
    messageListOptions?: ConstructorParameters<typeof MessageList>[0],
    contextOptions?: Partial<ContextWindowOptions>
  ) {
    super(messageListOptions);
    this.contextManager = new ContextWindowManager(contextOptions);
  }

  /**
   * 获取上下文管理器
   */
  get contextWindow(): ContextWindowManager {
    return this.contextManager;
  }

  /**
   * 自动裁剪以适应上下文窗口
   */
  autoTrim(): void {
    const messages = this.messages;
    const systemMessage = this.systemMessage;

    if (this.contextManager.needsTrimming(messages, systemMessage)) {
      const trimmed = this.contextManager.trim(messages, systemMessage);

      // 更新消息列表
      this.clear();
      trimmed.forEach((msg) => this.add(msg));
    }
  }

  /**
   * 获取上下文统计信息
   */
  getContextStats(): ReturnType<ContextWindowManager['getStats']> {
    return this.contextManager.getStats(this.messages, this.systemMessage);
  }

  /**
   * 验证消息完整性
   */
  validateMessages(): ReturnType<ContextWindowManager['validate']> {
    return this.contextManager.validate(this.messages);
  }
}

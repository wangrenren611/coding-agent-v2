import { LLMRequestMessage, ToolCall, Usage } from '../providers';
import {
  Message,
  SystemMessage,
  UserMessage,
  AssistantMessage,
  ToolCallMessage,
  ToolResultMessage,
  SummaryMessage,
  MessageGuard,
  MessageFactory,
} from './message';

/**
 * 消息事件类型
 */
export type MessageEventType = 'add' | 'update' | 'delete';

/**
 * 消息事件回调
 */
export type MessageEventCallback = (event: {
  type: MessageEventType;
  message?: Message;
  messageId?: string;
}) => void;

/**
 * MessageList 配置
 */
export interface MessageListOptions {
  /** 最大消息数量 */
  maxMessages?: number;
  /** 是否启用事件 */
  enableEvents?: boolean;
}

/**
 * 消息列表管理类
 *
 * 功能：
 * - 消息的增删改查
 * - 上下文窗口管理
 * - 导入导出
 * - 事件订阅
 */
export class MessageList {
  private _messages: Message[] = [];
  private _systemMessage?: SystemMessage;
  private _options: MessageListOptions;
  private _eventListeners: Map<MessageEventType, Set<MessageEventCallback>> = new Map();

  private _operationLock: Promise<void> = Promise.resolve();
  private _lockResolver?: () => void;

  constructor(options?: MessageListOptions) {
    this._options = {
      maxMessages: options?.maxMessages ?? 1000,
      enableEvents: options?.enableEvents ?? true,
    };
  }

  private async _acquireLock(): Promise<void> {
    await this._operationLock;
    this._operationLock = new Promise((resolve) => {
      this._lockResolver = resolve;
    });
  }

  private _releaseLock(): void {
    if (this._lockResolver) {
      this._lockResolver();
      this._lockResolver = undefined;
    }
  }

  // ==================== 查询能力 ====================

  /** 获取消息列表（只读） */
  get messages(): Readonly<Message[]> {
    return [...this._messages];
  }

  /** 获取系统消息 */
  get systemMessage(): SystemMessage | undefined {
    return this._systemMessage;
  }

  /** 获取最后一条消息 */
  get lastMessage(): Message | undefined {
    return this._messages.at(-1);
  }

  /** 获取消息数量 */
  get length(): number {
    return this._messages.length;
  }

  /** 是否为空 */
  get isEmpty(): boolean {
    return this._messages.length === 0;
  }

  /**
   * 根据 ID 获取消息
   */
  getById(messageId: string): Message | undefined {
    return this._messages.find((m) => m.messageId === messageId);
  }

  /**
   * 根据索引获取消息
   */
  getAt(index: number): Message | undefined {
    return this._messages[index];
  }

  /**
   * 根据角色获取消息
   */
  getByRole(role: Message['role']): Message[] {
    return this._messages.filter((m) => m.role === role);
  }

  /**
   * 获取用户消息
   */
  getUserMessages(): UserMessage[] {
    return this._messages.filter(MessageGuard.isUser);
  }

  /**
   * 获取助手消息（包括工具调用）
   */
  getAssistantMessages(): (AssistantMessage | ToolCallMessage)[] {
    return this._messages.filter((m) => m.role === 'assistant');
  }

  /**
   * 获取工具调用消息
   */
  getToolCallMessages(): ToolCallMessage[] {
    return this._messages.filter(MessageGuard.isToolCall);
  }

  /**
   * 获取工具结果消息
   */
  getToolResultMessages(): ToolResultMessage[] {
    return this._messages.filter(MessageGuard.isToolResult);
  }

  /**
   * 根据工具调用 ID 获取对应的结果
   */
  getToolResultForCall(toolCallId: string): ToolResultMessage | undefined {
    return this._messages.find(
      (m): m is ToolResultMessage => MessageGuard.isToolResult(m) && m.tool_call_id === toolCallId
    );
  }

  /**
   * 查找消息索引
   */
  indexOf(messageId: string): number {
    return this._messages.findIndex((m) => m.messageId === messageId);
  }

  // ==================== 添加能力 ====================

  /**
   * 设置系统消息
   */
  setSystemMessage(content: string): SystemMessage {
    const message = MessageFactory.createSystemMessage(content);
    this._systemMessage = message;
    this._emit('update', message);
    return message;
  }

  /**
   * 添加消息
   */
  add(message: Message): void {
    this._messages.push(message);
    this._emit('add', message);
  }

  /**
   * 异步添加消息（带锁）
   */
  async addAsync(message: Message): Promise<void> {
    await this._acquireLock();
    try {
      this._messages.push(message);
      this._emit('add', message);
    } finally {
      this._releaseLock();
    }
  }

  /**
   * 更新最后一条消息（增量更新，用于流式输出）
   */
  updateLastMessage(
    updates: Partial<{
      content: string;
      reasoning_content: string;
      tool_calls: ToolCall[];
      finish_reason: string;
      usage: Usage;
    }>
  ): boolean {
    if (this._messages.length === 0) return false;

    const lastIndex = this._messages.length - 1;
    const lastMessage = this._messages[lastIndex];

    const updated = { ...lastMessage, ...updates } as Message;
    this._messages[lastIndex] = updated;
    this._emit('update', updated);

    return true;
  }

  /**
   * 根据 messageId 更新消息（推荐用于并发场景）
   */
  updateMessageById(
    messageId: string,
    updates: Partial<{
      content: string;
      reasoning_content: string;
      tool_calls: ToolCall[];
      finish_reason: string;
      usage: Usage;
    }>
  ): boolean {
    const index = this._messages.findIndex((m) => m.messageId === messageId);
    if (index === -1) return false;

    const message = this._messages[index];
    const updated = { ...message, ...updates } as Message;
    this._messages[index] = updated;
    this._emit('update', updated);

    return true;
  }

  /**
   * 异步根据 messageId 更新消息（带锁）
   */
  async updateMessageByIdAsync(
    messageId: string,
    updates: Partial<{
      content: string;
      reasoning_content: string;
      tool_calls: ToolCall[];
      finish_reason: string;
      usage: Usage;
    }>
  ): Promise<boolean> {
    await this._acquireLock();
    try {
      return this.updateMessageById(messageId, updates);
    } finally {
      this._releaseLock();
    }
  }

  /**
   * 异步更新最后一条消息（带锁）
   */
  async updateLastMessageAsync(
    updates: Partial<{
      content: string;
      reasoning_content: string;
      tool_calls: ToolCall[];
      finish_reason: string;
      usage: Usage;
    }>
  ): Promise<boolean> {
    await this._acquireLock();
    try {
      return this.updateLastMessage(updates);
    } finally {
      this._releaseLock();
    }
  }

  /**
   * 添加用户消息
   */
  addUserMessage(content: string | UserMessage['content']): UserMessage {
    const message = MessageFactory.createUserMessage(content);
    this.add(message);
    return message;
  }

  /**
   * 添加助手消息
   */
  addAssistantMessage(params: {
    content: string;
    tool_calls?: ToolCall[];
    reasoning_content?: string;
    finish_reason?: AssistantMessage['finish_reason'];
    usage?: AssistantMessage['usage'];
  }): AssistantMessage | ToolCallMessage {
    const message = MessageFactory.createAssistantMessage(params);
    this.add(message);
    return message;
  }

  /**
   * 添加工具结果
   */
  addToolResult(toolCallId: string, content: string): ToolResultMessage {
    const message = MessageFactory.createToolResultMessage(toolCallId, content);
    this.add(message);
    return message;
  }

  /**
   * 添加总结消息
   */
  addSummary(content: string, summarizedMessages: string[]): SummaryMessage {
    const message = MessageFactory.createSummaryMessage(content, summarizedMessages);
    this.add(message);
    return message;
  }

  // ==================== 修改/删除能力 ====================

  /**
   * 更新消息
   */
  update(messageId: string, updates: Partial<Omit<Message, 'messageId' | 'role'>>): boolean {
    const index = this.indexOf(messageId);
    if (index === -1) return false;

    const message = this._messages[index];
    this._messages[index] = { ...message, ...updates } as Message;
    this._emit('update', this._messages[index]);
    return true;
  }

  /**
   * 删除消息
   */
  delete(messageId: string): boolean {
    const index = this.indexOf(messageId);
    if (index === -1) return false;

    this._messages.splice(index, 1);
    this._emit('delete', undefined, messageId);
    return true;
  }

  /**
   * 清空所有消息（保留系统消息）
   */
  clear(): void {
    const removed = [...this._messages];
    this._messages = [];
    removed.forEach((m) => this._emit('delete', undefined, m.messageId));
  }

  /**
   * 清空所有消息（包括系统消息）
   */
  clearAll(): void {
    this._systemMessage = undefined;
    this.clear();
  }

  /**
   * 保留最后 N 条消息
   */
  truncate(keepLast: number): void {
    if (this._messages.length <= keepLast) return;

    const removed = this._messages.splice(0, this._messages.length - keepLast);
    removed.forEach((m) => this._emit('delete', undefined, m.messageId));
  }

  // ==================== 上下文管理 ====================

  /**
   * 获取估算的 token 数量（简单估算）
   */
  getTokenCount(): number {
    let count = 0;

    if (this._systemMessage) {
      count += this._estimateTokens(this._systemMessage.content);
    }

    for (const msg of this._messages) {
      count += this._estimateTokens(msg.content as string);
      if (MessageGuard.hasToolCalls(msg) && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          count += this._estimateTokens(JSON.stringify(tc));
        }
      }
    }

    return count;
  }

  /**
   * 简单的 token 估算（4 字符约等于 1 token）
   */
  private _estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * 裁剪以适应最大 token 限制
   * @param maxTokens 最大 token 数
   * @param preserveSystem 是否保留系统消息
   */
  trimToFit(maxTokens: number): void {
    let currentTokens = this.getTokenCount();

    if (currentTokens <= maxTokens) return;

    // 从最旧的消息开始删除（但保持 tool_call 和 tool_result 成对）
    while (currentTokens > maxTokens && this._messages.length > 1) {
      const removed = this._messages.shift()!;
      currentTokens -= this._estimateTokens(removed.content as string);
      this._emit('delete', undefined, removed.messageId);

      // 如果删除的是 tool_call，也要删除对应的 tool_result
      if (MessageGuard.isToolCall(removed)) {
        const toolCallIds = removed.tool_calls.map((tc) => tc.id);
        this._messages = this._messages.filter((msg) => {
          if (MessageGuard.isToolResult(msg) && toolCallIds.includes(msg.tool_call_id)) {
            currentTokens -= this._estimateTokens(msg.content);
            this._emit('delete', undefined, msg.messageId);
            return false;
          }
          return true;
        });
      }
    }
  }

  // ==================== 导入/导出 ====================

  /**
   * 转换为 JSON
   */
  toJSON(): { systemMessage?: SystemMessage; messages: Message[] } {
    return {
      systemMessage: this._systemMessage,
      messages: this._messages,
    };
  }

  /**
   * 从 JSON 创建
   */
  static fromJSON(json: { systemMessage?: SystemMessage; messages: Message[] }): MessageList {
    const list = new MessageList();
    list._systemMessage = json.systemMessage;
    list._messages = json.messages;
    return list;
  }

  /**
   * 转换为 LLM 请求格式
   */
  toLLMRequestMessages(): LLMRequestMessage[] {
    const result: LLMRequestMessage[] = [];

    // 添加系统消息
    if (this._systemMessage) {
      result.push({
        role: 'system',
        content: this._systemMessage.content,
      });
    }

    // 添加其他消息
    for (const msg of this._messages) {
      result.push(this._messageToLLMRequest(msg));
    }

    return result;
  }

  /**
   * 单条消息转换为 LLM 请求格式
   */
  private _messageToLLMRequest(msg: Message): LLMRequestMessage {
    const result: any = {
      role: msg.role,
      content: msg.content,
    };

    if (MessageGuard.hasToolCalls(msg)) {
      result.tool_calls = msg.tool_calls;
    }

    if (MessageGuard.isToolResult(msg)) {
      result.tool_call_id = msg.tool_call_id;
    }

    return result;
  }

  // ==================== 事件系统 ====================

  /**
   * 订阅事件
   */
  on(event: MessageEventType, callback: MessageEventCallback): () => void {
    if (!this._options.enableEvents) {
      return () => {};
    }

    if (!this._eventListeners.has(event)) {
      this._eventListeners.set(event, new Set());
    }

    this._eventListeners.get(event)!.add(callback);

    // 返回取消订阅函数
    return () => {
      this._eventListeners.get(event)?.delete(callback);
    };
  }

  /**
   * 触发事件
   */
  private _emit(type: MessageEventType, message?: Message, messageId?: string): void {
    if (!this._options.enableEvents) return;

    const listeners = this._eventListeners.get(type);
    if (!listeners) return;

    const event = { type, message, messageId };
    listeners.forEach((cb) => cb(event));
  }

  /**
   * 遍历消息
   */
  forEach(callback: (message: Message, index: number) => void): void {
    this._messages.forEach(callback);
  }

  /**
   * 过滤消息
   */
  filter(predicate: (message: Message, index: number) => boolean): Message[] {
    return this._messages.filter(predicate);
  }

  /**
   * 映射消息
   */
  map<T>(callback: (message: Message, index: number) => T): T[] {
    return this._messages.map(callback);
  }

  /**
   * 查找消息
   */
  find(predicate: (message: Message, index: number) => boolean): Message | undefined {
    return this._messages.find(predicate);
  }

  /**
   * 检查是否包含某消息
   */
  has(messageId: string): boolean {
    return this.indexOf(messageId) !== -1;
  }

  /**
   *最后一条消息
   */
  getLastMessage(): Message | undefined {
    return this._messages[this._messages.length - 1];
  }
}

/**
 * 消息缓冲区
 *
 * 批量累积消息，定时/定量触发持久化
 * 平衡实时性和性能
 */

import type { Message } from './message';

export interface MessageBufferOptions {
  maxBufferSize?: number;
  flushInterval?: number;
  enabled?: boolean;
}

export interface BufferedMessage {
  message: Message;
  timestamp: number;
  operation: 'add' | 'update';
  updates?: Partial<Message>;
}

export class MessageBuffer {
  private buffer: BufferedMessage[] = [];
  private maxBufferSize: number;
  private flushInterval: number;
  private enabled: boolean;
  private flushTimer?: NodeJS.Timeout;
  private onFlush?: (messages: BufferedMessage[]) => Promise<void>;

  constructor(options?: MessageBufferOptions) {
    this.maxBufferSize = options?.maxBufferSize ?? 10;
    this.flushInterval = options?.flushInterval ?? 1000;
    this.enabled = options?.enabled ?? true;
  }

  setOnFlush(callback: (messages: BufferedMessage[]) => Promise<void>): void {
    this.onFlush = callback;
  }

  start(): void {
    if (!this.enabled || this.flushTimer) return;

    this.flushTimer = setInterval(async () => {
      await this.flush();
    }, this.flushInterval);
  }

  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  async add(message: Message): Promise<void> {
    if (!this.enabled) return;

    this.buffer.push({
      message,
      timestamp: Date.now(),
      operation: 'add',
    });

    if (this.buffer.length >= this.maxBufferSize) {
      await this.flush();
    }
  }

  async update(messageId: string, updates: Partial<Message>): Promise<void> {
    if (!this.enabled) return;

    const existing = this.buffer.find(
      (b) => b.operation === 'update' && b.message.messageId === messageId
    );

    if (existing) {
      existing.message = { ...existing.message, ...updates } as Message;
      existing.timestamp = Date.now();
    } else {
      this.buffer.push({
        message: { messageId } as Message,
        timestamp: Date.now(),
        operation: 'update',
        updates,
      });
    }

    if (this.buffer.length >= this.maxBufferSize) {
      await this.flush();
    }
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0 || !this.onFlush) return;

    const messages = [...this.buffer];
    this.buffer = [];

    try {
      await this.onFlush(messages);
    } catch (error) {
      console.error('[MessageBuffer] Flush failed:', error);
      this.buffer = [...messages, ...this.buffer];
    }
  }

  size(): number {
    return this.buffer.length;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  async close(): Promise<void> {
    this.stop();
    await this.flush();
  }
}

export function createMessageBuffer(options?: MessageBufferOptions): MessageBuffer {
  return new MessageBuffer(options);
}

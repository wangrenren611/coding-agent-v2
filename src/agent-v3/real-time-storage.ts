/**
 * 实时存储服务
 * 参考: ENTERPRISE_REALTIME.md
 */

import { Message } from './types';

/**
 * Redis 客户端接口
 */
export interface RedisClient {
  rpush(key: string, value: string): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  expire(key: string, seconds: number): Promise<void>;
  hset(key: string, data: Record<string, string>, options?: { EX?: number }): Promise<void>;
  hgetall(key: string): Promise<Record<string, string>>;
  del(key: string): Promise<void>;
}

/**
 * Kafka 客户端接口
 */
export interface KafkaClient {
  send(options: { topic: string; messages: Array<{ key?: string; value: string }> }): Promise<void>;
}

/**
 * 实时存储服务
 * 负责消息的实时存储 (Redis) 和异步持久化 (Kafka)
 */
export class RealTimeStorage {
  constructor(
    private redis: RedisClient,
    private kafka: KafkaClient
  ) {}

  /**
   * 保存消息到 Redis 并发送到 Kafka
   */
  async saveMessage(conversationId: string, message: Message): Promise<void> {
    // 1. 实时写入 Redis
    const key = `conversation:${conversationId}:messages`;
    await this.redis.rpush(key, JSON.stringify(message));
    await this.redis.expire(key, 1800); // 30 分钟过期

    // 2. 发送到 Kafka (异步持久化)
    await this.kafka.send({
      topic: 'messages',
      messages: [
        {
          key: conversationId,
          value: JSON.stringify({
            event: 'message_created',
            conversationId,
            message,
          }),
        },
      ],
    });
  }

  /**
   * 获取会话的所有消息
   */
  async getMessages(conversationId: string): Promise<Message[]> {
    const key = `conversation:${conversationId}:messages`;
    const messages = await this.redis.lrange(key, 0, -1);
    return messages.map((msg) => JSON.parse(msg));
  }

  /**
   * 获取最后 N 条消息
   */
  async getLastMessages(conversationId: string, count: number): Promise<Message[]> {
    const key = `conversation:${conversationId}:messages`;
    const messages = await this.redis.lrange(key, -count, -1);
    return messages.map((msg) => JSON.parse(msg));
  }
}

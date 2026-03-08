/**
 * 上下文服务
 * 参考: ENTERPRISE_REALTIME.md
 */

import { ConversationContext, Message } from './types';
import { RedisClient } from './real-time-storage';

/**
 * ClickHouse 客户端接口
 */
export interface ClickHouseClient {
  query(sql: string): Promise<any[]>;
  execute(sql: string): Promise<void>;
}

/**
 * 上下文服务
 * 负责加载和管理会话上下文
 */
export class ContextService {
  constructor(
    private redis: RedisClient,
    private clickhouse: ClickHouseClient
  ) {}
  
  /**
   * 加载上下文
   * 优先从 Redis 缓存获取，缓存不存在从 ClickHouse 加载
   */
  async load(conversationId: string): Promise<ConversationContext> {
    const cacheKey = `conversation:${conversationId}:context`;
    
    // 1. 先从 Redis 缓存获取
    // TODO: 使用 GET
    const cached = null; // await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
    
    // 2. 缓存不存在，从 ClickHouse 加载
    // TODO: 查询消息
    const messages: Message[] = [];
    
    // TODO: 查询会话配置
    const systemPrompt = '';
    const tools = [];
    
    const context: ConversationContext = {
      messages,
      systemPrompt,
      tools
    };
    
    // 3. 写入缓存
    // TODO: 使用 SET EX
    // await this.redis.set(cacheKey, JSON.stringify(context), { EX: 300 });
    
    return context;
  }
  
  /**
   * 保存上下文到缓存
   */
  async save(conversationId: string, context: ConversationContext): Promise<void> {
    const cacheKey = `conversation:${conversationId}:context`;
    // TODO: 使用 SET EX
    throw new Error('Not implemented');
  }
  
  /**
   * 清除上下文缓存
   */
  async invalidate(conversationId: string): Promise<void> {
    const cacheKey = `conversation:${conversationId}:context`;
    // TODO: 使用 DEL
    throw new Error('Not implemented');
  }
}

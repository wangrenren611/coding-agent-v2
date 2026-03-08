/**
 * 检查点服务
 * 参考: ENTERPRISE_REALTIME.md
 */

import { ExecutionCheckpoint } from './types';
import { RedisClient } from './real-time-storage';

/**
 * 检查点服务
 * 负责保存和恢复执行检查点
 */
export class CheckpointService {
  constructor(private redis: RedisClient) {}
  
  /**
   * 保存检查点
   * 只存储执行位置，不重复存储消息
   */
  async saveCheckpoint(checkpoint: ExecutionCheckpoint): Promise<void> {
    const key = `execution:${checkpoint.executionId}:checkpoint`;
    
    await this.redis.hset(key, {
      stepIndex: checkpoint.stepIndex.toString(),
      lastMessageId: checkpoint.lastMessageId,
      lastMessageTime: checkpoint.lastMessageTime.toString(),
      canResume: checkpoint.canResume ? '1' : '0'
    }, { EX: 86400 }); // 24 小时过期
  }
  
  /**
   * 获取最新检查点
   */
  async getLatestCheckpoint(executionId: string): Promise<ExecutionCheckpoint | null> {
    const key = `execution:${executionId}:checkpoint`;
    const data = await this.redis.hgetall(key);
    
    if (!data || Object.keys(data).length === 0) {
      return null;
    }
    
    return {
      executionId,
      stepIndex: parseInt(data.stepIndex),
      lastMessageId: data.lastMessageId,
      lastMessageTime: parseInt(data.lastMessageTime),
      canResume: data.canResume === '1'
    };
  }
  
  /**
   * 删除检查点
   */
  async deleteCheckpoint(executionId: string): Promise<void> {
    const key = `execution:${executionId}:checkpoint`;
    await this.redis.del(key);
  }
}

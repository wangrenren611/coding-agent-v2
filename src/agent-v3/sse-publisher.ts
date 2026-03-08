/**
 * SSE 推送服务
 * 参考: ENTERPRISE_REALTIME.md
 */

import { StreamEvent } from './types';

/**
 * SSE 连接接口
 */
export interface SSEConnection {
  id: string;
  executionId: string;
  send(event: StreamEvent): void;
  close(): void;
}

/**
 * SSE 推送服务
 * 负责实时推送事件给客户端
 */
export class SSEPublisher {
  private connections: Map<string, SSEConnection[]> = new Map();
  
  /**
   * 订阅执行
   */
  subscribe(executionId: string, connection: SSEConnection): void {
    const connections = this.connections.get(executionId) || [];
    connections.push(connection);
    this.connections.set(executionId, connections);
  }
  
  /**
   * 取消订阅
   */
  unsubscribe(executionId: string, connectionId: string): void {
    const connections = this.connections.get(executionId) || [];
    const filtered = connections.filter(c => c.id !== connectionId);
    this.connections.set(executionId, filtered);
  }
  
  /**
   * 发布事件
   */
  publish(executionId: string, event: StreamEvent): void {
    const connections = this.connections.get(executionId) || [];
    
    for (const connection of connections) {
      try {
        connection.send(event);
      } catch (error) {
        console.error(`[SSE] Send error:`, error);
        // 移除失败的连接
        this.unsubscribe(executionId, connection.id);
      }
    }
  }
  
  /**
   * 广播消息给所有订阅者
   */
  broadcast(event: StreamEvent): void {
    for (const [executionId, connections] of this.connections) {
      for (const connection of connections) {
        try {
          connection.send(event);
        } catch (error) {
          this.unsubscribe(executionId, connection.id);
        }
      }
    }
  }
  
  /**
   * 获取订阅数量
   */
  getSubscriberCount(executionId: string): number {
    return (this.connections.get(executionId) || []).length;
  }
}

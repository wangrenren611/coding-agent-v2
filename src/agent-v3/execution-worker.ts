/**
 * 后台执行工作者
 * 参考: ENTERPRISE_REALTIME.md
 */

import { Task, Message, ExecutionCheckpoint, ExecutionProgress } from './types';
import { StatelessAgent } from './agent';
import { TaskQueue } from './task-queue';
import { ExecutionService } from './execution-service';
import { RealTimeStorage } from './real-time-storage';
import { CheckpointService } from './checkpoint-service';
import { ContextService } from './context-service';
import { SSEPublisher } from './sse-publisher';

/**
 * 后台执行工作者
 * 负责从队列消费任务并执行 Agent
 */
export class ExecutionWorker {
  private workerId: string;
  
  constructor(
    private queue: TaskQueue,
    private agent: StatelessAgent,
    private executionService: ExecutionService,
    private messageStorage: RealTimeStorage,
    private checkpointService: CheckpointService,
    private contextService: ContextService,
    private ssePublisher: SSEPublisher
  ) {
    this.workerId = `worker_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * 启动 Worker
   */
  async start(): Promise<void> {
    console.log(`[Worker ${this.workerId}] Starting...`);
    
    while (true) {
      try {
        // 从队列获取任务 (阻塞等待)
        const task = await this.queue.brpop(0);
        
        if (task) {
          console.log(`[Worker ${this.workerId}] Received task: ${task.executionId}`);
          await this.processTask(task);
        }
      } catch (error) {
        console.error(`[Worker ${this.workerId}] Error:`, error);
        await this.sleep(1000);
      }
    }
  }
  
  /**
   * 处理单个任务
   */
  private async processTask(task: Task): Promise<void> {
    const { executionId, conversationId, message } = task;
    
    // 1. 尝试获取锁
    const lockAcquired = await this.executionService.acquireLock(executionId, this.workerId);
    if (!lockAcquired) {
      console.log(`[Worker ${this.workerId}] Task ${executionId} is being processed by another worker`);
      return;
    }
    
    try {
      // 2. 更新状态为 RUNNING
      await this.executionService.updateStatus(executionId, 'RUNNING');
      
      // 3. 检查是否有未完成的检查点
      const checkpoint = await this.checkpointService.getLatestCheckpoint(executionId);
      
      let messages: Message[] = [];
      let startStep = 1;
      
      if (checkpoint && checkpoint.canResume) {
        // 恢复执行
        // TODO: 获取检查点后的消息
      } else {
        // 全新执行
        const context = await this.contextService.load(conversationId);
        
        const userMessage: Message = {
          messageId: `msg_${Date.now()}`,
          role: 'user',
          content: message.content,
          timestamp: Date.now()
        };
        
        messages = [...context.messages, userMessage];
        await this.messageStorage.save(conversationId, userMessage);
      }
      
      // 4. 加载上下文
      const context = await this.contextService.load(conversationId);
      
      // 5. 构造 Agent 输入
      const input = {
        executionId,
        conversationId,
        messages,
        systemPrompt: context.systemPrompt,
        tools: context.tools,
        startStep,
        callbacks: {
          onMessage: async (msg: Message) => {
            await this.messageStorage.save(conversationId, msg);
            this.ssePublisher.publish(executionId, { type: 'message', data: msg });
          },
          onCheckpoint: async (cp: ExecutionCheckpoint) => {
            await this.checkpointService.saveCheckpoint(cp);
            await this.executionService.updateProgress(executionId, {
              stepIndex: cp.stepIndex,
              messageCount: messages.length
            });
          },
          onProgress: async (progress: ExecutionProgress) => {
            this.ssePublisher.publish(executionId, { type: 'progress', data: progress });
          },
          onError: async (error: Error) => {
            await this.checkpointService.saveCheckpoint({
              executionId,
              stepIndex: 0,
              lastMessageId: '',
              lastMessageTime: Date.now(),
              canResume: false
            });
            await this.executionService.updateStatus(executionId, 'FAILED', { error: error.message });
            this.ssePublisher.publish(executionId, { type: 'error', data: { message: error.message } });
          }
        }
      };
      
      // 6. 执行 Agent
      const result = await this.agent.run(input);
      
      // 7. 执行完成
      const finalMessage = result.messages[result.messages.length - 1];
      await this.executionService.updateStatus(executionId, 'COMPLETED', {
        result: finalMessage?.content,
        steps: result.steps
      });
      
      this.ssePublisher.publish(executionId, {
        type: 'done',
        data: { result: finalMessage?.content, steps: result.steps }
      });
      
      console.log(`[Worker ${this.workerId}] Task completed: ${executionId}`);
      
    } catch (error) {
      console.error(`[Worker ${this.workerId}] Task failed: ${executionId}`, error);
      await this.executionService.updateStatus(executionId, 'FAILED', {
        error: (error as Error).message
      });
    } finally {
      await this.executionService.releaseLock(executionId);
    }
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

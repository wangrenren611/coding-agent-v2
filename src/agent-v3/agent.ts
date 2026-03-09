/**
 * 无状态 Agent 核心实现
 * 参考: ENTERPRISE_REALTIME.md
 */

import {
  Message,
  ToolCall,
  AgentInput,
  AgentOutput,
  AgentCallbacks,
  LLMConfig,
  LLMProvider,
  ExecutionCheckpoint,
  ExecutionProgress,
  StreamEvent,
} from './types';
import { ToolExecutor } from './tool-executor';

/**
 * 生成唯一 ID
 */
function generateId(prefix: string): string {
  return `${prefix}${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 无状态 Agent
 * 不存储任何会话状态，所有状态通过输入输出传递
 */
export class StatelessAgent {
  private llmProvider: LLMProvider;
  private toolExecutor: ToolExecutor;

  constructor(llmProvider: LLMProvider, toolExecutor: ToolExecutor) {
    this.llmProvider = llmProvider;
    this.toolExecutor = toolExecutor;
  }

  /**
   * 非流式执行
   */
  async run(input: AgentInput, callbacks?: AgentCallbacks): Promise<AgentOutput> {
    let { messages, maxSteps = 100, startStep = 1 } = input;

    let stepIndex = startStep - 1;
    let finishReason: 'stop' | 'max_steps' | 'error' = 'stop';

    while (stepIndex < maxSteps) {
      stepIndex++;

      try {
        // 回调: 进度
        callbacks?.onProgress?.({
          executionId: input.executionId,
          stepIndex,
          currentAction: 'llm',
          messageCount: messages.length,
        });

        // 1. 调用 LLM
        const response = await this.llmProvider.generate(messages, input.config);

        // 2. 添加助手消息
        const assistantMessage = response.message;
        messages.push(assistantMessage);

        // 回调: 新消息
        await this.safeCallback(callbacks?.onMessage, assistantMessage);

        // 3. 处理工具调用
        if (response.toolCalls && response.toolCalls.length > 0) {
          // 回调: 进度
          callbacks?.onProgress?.({
            executionId: input.executionId,
            stepIndex,
            currentAction: 'tool',
            messageCount: messages.length,
          });

          // 4. 执行工具调用
          for (const toolCall of response.toolCalls) {
            const toolResult = await this.toolExecutor.execute(toolCall);
            messages.push(toolResult);

            // 回调: 工具结果
            await this.safeCallback(callbacks?.onMessage, toolResult);
          }

          // 回调: 检查点
          const lastMessage = messages[messages.length - 1];
          const checkpoint: ExecutionCheckpoint = {
            executionId: input.executionId,
            stepIndex,
            lastMessageId: lastMessage?.messageId || '',
            lastMessageTime: Date.now(),
            canResume: true,
          };
          await this.safeCallback(callbacks?.onCheckpoint, checkpoint);

          continue;
        }

        finishReason = 'stop';
        break;
      } catch (error) {
        await this.safeCallback(callbacks?.onError, error as Error);

        if (this.isRetryableError(error)) {
          continue;
        }

        finishReason = 'error';
        break;
      }
    }

    if (stepIndex >= maxSteps) {
      finishReason = 'max_steps';
    }

    return {
      messages,
      finishReason,
      steps: stepIndex - startStep + 1,
    };
  }

  /**
   * 流式执行
   * 适用于需要实时显示每个 chunk 的场景
   */
  async *runStream(
    input: AgentInput,
    callbacks?: AgentCallbacks
  ): AsyncGenerator<StreamEvent, any, unknown> {
    let { messages, maxSteps = 100, startStep = 1 } = input;

    let stepIndex = startStep - 1;

    while (stepIndex < maxSteps) {
      stepIndex++;

      try {
        // 回调: 进度
        yield {
          type: 'progress',
          data: {
            executionId: input.executionId,
            stepIndex,
            currentAction: 'llm',
            messageCount: messages.length,
          },
        };

        // 1. 流式调用 LLM
        const stream = this.llmProvider.generateStream(messages, input.config);

        // 构建助手消息
        const assistantMessage: Message = {
          messageId: generateId('msg_'),
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
        };

        let toolCalls: ToolCall[] = [];

        // 2. 处理流式响应
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;

          // 更新 content
          if (delta?.content) {
            assistantMessage.content += delta.content;

            yield {
              type: 'chunk',
              data: {
                messageId: assistantMessage.messageId,
                content: delta.content,
                delta: true,
              },
            };
          }

          // 更新 tool_calls
          if (delta?.tool_calls) {
            toolCalls = this.mergeToolCalls(toolCalls, delta.tool_calls);

            yield {
              type: 'tool_call',
              data: {
                messageId: assistantMessage.messageId,
                toolCalls,
              },
            };
          }

          if (chunk.choices[0]?.finish_reason) {
            break;
          }
        }

        // 3. 完成消息构建
        assistantMessage.tool_calls = toolCalls.length > 0 ? toolCalls : undefined;
        messages.push(assistantMessage);

        // 回调: 新消息
        await this.safeCallback(callbacks?.onMessage, assistantMessage);

        // 4. 处理工具调用
        if (toolCalls.length > 0) {
          for (const toolCall of toolCalls) {
            yield {
              type: 'progress',
              data: {
                stepIndex,
                currentAction: 'tool',
                messageCount: messages.length,
              },
            };

            const toolResult = await this.toolExecutor.execute(toolCall);
            messages.push(toolResult);

            await this.safeCallback(callbacks?.onMessage, toolResult);

            yield {
              type: 'tool_result',
              data: toolResult,
            };
          }

          // 回调: 检查点
          const lastMessage = messages[messages.length - 1];
          const checkpoint: ExecutionCheckpoint = {
            executionId: input.executionId,
            stepIndex,
            lastMessageId: lastMessage?.messageId || '',
            lastMessageTime: Date.now(),
            canResume: true,
          };
          await this.safeCallback(callbacks?.onCheckpoint, checkpoint);

          yield {
            type: 'checkpoint',
            data: checkpoint,
          };

          continue;
        }

        yield {
          type: 'done',
          data: {
            finishReason: 'stop',
            steps: stepIndex - startStep + 1,
          },
        };

        break;
      } catch (error) {
        await this.safeCallback(callbacks?.onError, error as Error);

        yield {
          type: 'error',
          data: { message: (error as Error).message },
        };

        break;
      }
    }
  }

  private async safeCallback<T>(
    callback: ((arg: T) => void | Promise<void>) | undefined,
    arg: T
  ): Promise<void> {
    if (!callback) return;
    try {
      await callback(arg);
    } catch (error) {
      console.error('[Agent] Callback error:', error);
    }
  }

  private isRetryableError(error: any): boolean {
    const retryableCodes = ['RATE_LIMIT', 'TIMEOUT', 'NETWORK_ERROR'];
    return error?.code && retryableCodes.includes(error.code);
  }

  private mergeToolCalls(existing: ToolCall[], newCalls: ToolCall[]): ToolCall[] {
    for (const newCall of newCalls) {
      const existingCall = existing.find((c) => c.id === newCall.id);
      if (existingCall) {
        existingCall.arguments += newCall.arguments;
      } else {
        existing.push({ ...newCall });
      }
    }
    return existing;
  }
}
